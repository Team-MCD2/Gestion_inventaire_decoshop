// Orchestrator: runs Vision (OCR/logo) in parallel with a vision LLM, then merges.
// The vision LLM is selected via a fallback chain — Gemini → Groq → Mistral.
// We try the next provider only when the previous one is fully exhausted (all
// keys cooldowned or quota errors). Other errors (image rejected, malformed
// JSON…) propagate immediately since they would happen on every provider too.
import {
  analyzeImage as geminiAnalyzeImage,
  analyzeBarcode as geminiAnalyzeBarcode,
  hasServerKey as hasGeminiServerKey,
} from './gemini.js';
import { analyzeImageGroq,    analyzeBarcodeGroq,    hasGroqKey }    from './groq.js';
import { analyzeImageMistral, analyzeBarcodeMistral, hasMistralKey } from './mistral.js';
import { visionAnnotate, extractFromVision, hasVisionKey } from './vision.js';

const LOGO_OVERRIDE_THRESHOLD = 0.7;

// Errors that mean "this provider is exhausted, try the next one"
function isExhaustionError(e) {
  const msg = (e && (e.message || String(e))) || '';
  return /quota|rate.?limit|toutes les cl(é|e)s|aucune cl(é|e)/i.test(msg)
      || e?.status === 429
      || (e?.status === 403 && /quota|disabled|invalid/i.test(msg));
}

// Try each available LLM in order; return on first success, fall through on
// quota/exhaustion errors only. Returns { result, source } or throws the last error.
async function tryVisionLLMs({ base64DataUrl, geminiKey, model }) {
  const chain = [];
  if (geminiKey || hasGeminiServerKey()) {
    chain.push({ name: 'gemini', fn: () => geminiAnalyzeImage({ base64DataUrl, apiKey: geminiKey, model }) });
  }
  if (hasGroqKey()) {
    chain.push({ name: 'groq', fn: () => analyzeImageGroq({ base64DataUrl }) });
  }
  if (hasMistralKey()) {
    chain.push({ name: 'mistral', fn: () => analyzeImageMistral({ base64DataUrl }) });
  }
  if (chain.length === 0) {
    throw new Error('Aucun fournisseur LLM vision configuré (Gemini / Groq / Mistral).');
  }

  let lastError = null;
  for (let i = 0; i < chain.length; i++) {
    const { name, fn } = chain[i];
    const isLast = i === chain.length - 1;
    try {
      const result = await fn();
      return { result, source: name };
    } catch (e) {
      lastError = e;
      if (isLast) throw e;
      if (isExhaustionError(e)) {
        console.warn(`[vision-chain] ${name} exhausted (${e.message || e}), falling back to ${chain[i + 1].name}`);
      } else {
        // Non-quota error on an earlier provider — also try next, but this
        // could be a real defect (image too large, blocked content...).
        console.warn(`[vision-chain] ${name} failed (${e.message || e}), falling back to ${chain[i + 1].name}`);
      }
    }
  }
  throw lastError || new Error('Tous les fournisseurs LLM vision ont échoué.');
}

function emptyToNull(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  if (typeof v === 'number' && (!Number.isFinite(v) || v === 0)) return null;
  return v;
}

/**
 * Hybrid image analysis.
 * Runs the vision LLM chain (Gemini -> Groq -> Mistral) and Cloud Vision in
 * parallel, then merges. Returns { merged, sources } where:
 *   merged is a normalized article (categorie, marque, modele, description,
 *     code_barres, couleur, ref_couleur, taille, taille_canape,
 *     prix_achat, prix_vente).
 *   sources.llmProvider tells which LLM produced the result ('gemini'|'groq'|'mistral').
 */
export async function analyzeImageHybrid({ base64DataUrl, geminiKey, visionKey, model }) {
  const useLLM = !!(geminiKey || hasGeminiServerKey() || hasGroqKey() || hasMistralKey());
  const useVision = !!(visionKey || hasVisionKey());

  if (!useLLM && !useVision) {
    throw new Error("Aucun service IA configuré (LLM vision ou Cloud Vision).");
  }

  const tasks = [];
  let llmResult = null;
  let llmSource = null;
  let visionResult = null;
  let llmError = null;
  let visionError = null;

  if (useLLM) {
    tasks.push(
      tryVisionLLMs({ base64DataUrl, geminiKey, model })
        .then(({ result, source }) => { llmResult = result; llmSource = source; })
        .catch((e) => { llmError = e.message || String(e); })
    );
  }
  if (useVision) {
    tasks.push(
      visionAnnotate(base64DataUrl, { apiKey: visionKey })
        .then((r) => { visionResult = r; })
        .catch((e) => { visionError = e.message || String(e); })
    );
  }

  await Promise.all(tasks);

  if (!llmResult && !visionResult) {
    const parts = [];
    if (llmError) parts.push(llmError);
    if (visionError) parts.push(visionError);
    throw new Error(parts.join(' • ') || 'Aucun résultat IA');
  }

  // Start with the LLM's structured result (or empty defaults if Vision-only).
  // Field names aligned on MCD (cf. mcd_mld.md §2 articles)
  const merged = {
    categorie:     llmResult?.categorie     ?? '',
    marque:        llmResult?.marque        ?? '',
    modele:        llmResult?.modele        ?? '',
    description:   llmResult?.description   ?? '',
    code_barres:   llmResult?.code_barres   ?? '',
    couleur:       llmResult?.couleur       ?? '',
    ref_couleur:   llmResult?.ref_couleur   ?? '',
    taille:        llmResult?.taille        ?? '',
    taille_canape: llmResult?.taille_canape ?? '',
    prix_achat:    Number(llmResult?.prix_achat) || 0,
    prix_vente:    Number(llmResult?.prix_vente) || 0,
  };

  let visionExtract = null;
  if (visionResult) {
    visionExtract = extractFromVision(visionResult);

    // marque : logo haute confiance écrase le LLM ; sinon remplit si le LLM est vide
    if (visionExtract.marque) {
      if (visionExtract.logoConfidence >= LOGO_OVERRIDE_THRESHOLD) {
        merged.marque = visionExtract.marque;
      } else if (!emptyToNull(merged.marque)) {
        merged.marque = visionExtract.marque;
      }
    }

    // code_barres : OCR EAN/UPC est très fiable → écrase sauf si le LLM a déjà un code numérique
    if (visionExtract.code_barres) {
      const llmCodeIsNumeric = /^\d{8,14}$/.test(merged.code_barres || '');
      if (!llmCodeIsNumeric) merged.code_barres = visionExtract.code_barres;
    }

    // taille : OCR plus fiable que LLM-estimation → écrase si trouvé
    if (visionExtract.taille) merged.taille = visionExtract.taille;

    // prix_vente : OCR du prix sur l'étiquette = prix réel → écrase l'estimation
    if (visionExtract.detectedPrice > 0) merged.prix_vente = visionExtract.detectedPrice;

    // couleur : le LLM est souvent plus nuancé ("Bois clair") → ne remplit que si vide
    if (visionExtract.couleur && !emptyToNull(merged.couleur)) {
      merged.couleur = visionExtract.couleur;
    }

    // categorie : LLM d'abord (mappe sur notre liste fermée), Vision en fallback
    if (visionExtract.fallbackCategorie && !emptyToNull(merged.categorie)) {
      merged.categorie = visionExtract.fallbackCategorie;
    }
  }

  return {
    merged,
    sources: {
      llm: llmResult,
      llmProvider: llmSource, // 'gemini' | 'groq' | 'mistral'
      vision: visionResult,
      visionExtract,
      errors: {
        llm: llmError,
        vision: visionError,
      },
    },
  };
}

/**
 * Barcode LLM fallback chain — used ONLY by /api/analyze/barcode AFTER public
 * databases (Open Food Facts & co.) returned nothing. Tries Gemini → Groq →
 * Mistral with a STRICT prompt that tells the LLM not to guess. The result
 * may still be empty (good — means no provider knew the code).
 *
 * Returns { result, source } where source is the provider that responded
 * (even with empty fields). Throws only if every provider fails technically
 * (quota, network, etc.) — not when they answer "I don't know".
 *
 * The caller is responsible for warning the user that this result is a
 * "suggestion" to be verified, since LLMs can still hallucinate.
 */
export async function tryBarcodeLLMs({ barcode }) {
  const code = String(barcode || '').trim();
  if (!code) throw new Error('Code-barres manquant');

  const chain = [];
  if (hasGeminiServerKey()) chain.push({ name: 'gemini',  fn: () => geminiAnalyzeBarcode({ barcode: code }) });
  if (hasGroqKey())         chain.push({ name: 'groq',    fn: () => analyzeBarcodeGroq({ barcode: code }) });
  if (hasMistralKey())      chain.push({ name: 'mistral', fn: () => analyzeBarcodeMistral({ barcode: code }) });

  if (chain.length === 0) {
    throw new Error('Aucun fournisseur LLM configuré pour le fallback code-barres.');
  }

  let lastError = null;
  for (let i = 0; i < chain.length; i++) {
    const { name, fn } = chain[i];
    const isLast = i === chain.length - 1;
    try {
      const result = await fn();
      return { result, source: name };
    } catch (e) {
      lastError = e;
      if (isLast) throw e;
      console.warn(`[barcode-llm] ${name} ${isExhaustionError(e) ? 'exhausted' : 'failed'} (${e.message || e}), falling back to ${chain[i + 1].name}`);
    }
  }
  throw lastError || new Error('Tous les fournisseurs LLM ont échoué pour ce code-barres.');
}
