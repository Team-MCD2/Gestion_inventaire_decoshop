// Orchestrator: runs Gemini + Vision in parallel and merges into a single article
import { analyzeImage as geminiAnalyzeImage, hasServerKey as hasGeminiServerKey } from './gemini.js';
import { visionAnnotate, extractFromVision, hasVisionKey } from './vision.js';

const LOGO_OVERRIDE_THRESHOLD = 0.7;

function emptyToNull(v) {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' && v.trim() === '') return null;
  if (typeof v === 'number' && (!Number.isFinite(v) || v === 0)) return null;
  return v;
}

/**
 * Hybrid image analysis.
 * Calls Gemini and Vision in parallel (whichever is available). Merges results.
 * Returns { merged, sources: { gemini, vision, errors } } where merged has the
 * same shape as the Gemini output (categorie, marque, modele, description,
 * reference, couleur, dimension, prix_achat, prix_vente).
 */
export async function analyzeImageHybrid({ base64DataUrl, geminiKey, visionKey, model }) {
  const useGemini = !!(geminiKey || hasGeminiServerKey());
  const useVision = !!(visionKey || hasVisionKey());

  if (!useGemini && !useVision) {
    throw new Error("Aucun service IA configuré (Gemini ou Cloud Vision).");
  }

  const tasks = [];
  let geminiResult = null;
  let visionResult = null;
  let geminiError = null;
  let visionError = null;

  if (useGemini) {
    tasks.push(
      geminiAnalyzeImage({ base64DataUrl, apiKey: geminiKey, model })
        .then((r) => { geminiResult = r; })
        .catch((e) => { geminiError = e.message || String(e); })
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

  if (!geminiResult && !visionResult) {
    // Both failed — friendly errors are already prefixed by their helpers
    const parts = [];
    if (geminiError) parts.push(geminiError);
    if (visionError) parts.push(visionError);
    throw new Error(parts.join(' • ') || 'Aucun résultat IA');
  }

  // Start with Gemini's structured result (or empty defaults if Vision-only)
  // Field names aligned on MCD (cf. mcd_mld.md §2 articles)
  const merged = {
    categorie:     geminiResult?.categorie     ?? '',
    marque:        geminiResult?.marque        ?? '',
    modele:        geminiResult?.modele        ?? '',
    description:   geminiResult?.description   ?? '',
    code_barres:   geminiResult?.code_barres   ?? '',
    couleur:       geminiResult?.couleur       ?? '',
    ref_couleur:   geminiResult?.ref_couleur   ?? '',
    taille:        geminiResult?.taille        ?? '',
    taille_canape: geminiResult?.taille_canape ?? '',
    prix_achat:    Number(geminiResult?.prix_achat) || 0,
    prix_vente:    Number(geminiResult?.prix_vente) || 0,
  };

  let visionExtract = null;
  if (visionResult) {
    visionExtract = extractFromVision(visionResult);

    // marque : logo haute confiance écrase Gemini ; sinon remplit si Gemini est vide
    if (visionExtract.marque) {
      if (visionExtract.logoConfidence >= LOGO_OVERRIDE_THRESHOLD) {
        merged.marque = visionExtract.marque;
      } else if (!emptyToNull(merged.marque)) {
        merged.marque = visionExtract.marque;
      }
    }

    // code_barres : OCR EAN/UPC est très fiable → écrase sauf si Gemini a déjà un code numérique
    if (visionExtract.code_barres) {
      const geminiCodeIsNumeric = /^\d{8,14}$/.test(merged.code_barres || '');
      if (!geminiCodeIsNumeric) merged.code_barres = visionExtract.code_barres;
    }

    // taille : OCR plus fiable que Gemini-estimation → écrase si trouvé
    if (visionExtract.taille) merged.taille = visionExtract.taille;

    // prix_vente : OCR du prix sur l'étiquette = prix réel → écrase l'estimation
    if (visionExtract.detectedPrice > 0) merged.prix_vente = visionExtract.detectedPrice;

    // couleur : Gemini souvent plus nuancé ("Bois clair") → ne remplit que si vide
    if (visionExtract.couleur && !emptyToNull(merged.couleur)) {
      merged.couleur = visionExtract.couleur;
    }

    // categorie : Gemini d'abord (mappe sur notre liste fermée), Vision en fallback
    if (visionExtract.fallbackCategorie && !emptyToNull(merged.categorie)) {
      merged.categorie = visionExtract.fallbackCategorie;
    }
  }

  return {
    merged,
    sources: {
      gemini: geminiResult,
      vision: visionResult,
      visionExtract,
      errors: {
        gemini: geminiError,
        vision: visionError,
      },
    },
  };
}
