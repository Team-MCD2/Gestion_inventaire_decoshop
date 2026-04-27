export const prerender = false;
import { lookupBarcode } from '../../../lib/barcode-lookup.js';
import { tryBarcodeLLMs } from '../../../lib/analyze.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// Empty article skeleton — used when the barcode is unknown so the frontend
// only sets the code_barres field and leaves everything else for the user.
function emptyArticle(code) {
  return {
    code_barres: String(code || '').trim(),
    description: '', marque: '', modele: '', categorie: '',
    couleur: '', ref_couleur: '', taille: '', taille_canape: '',
    photo_url: '', prix_achat: 0, prix_vente: 0,
  };
}

// An LLM "result" is considered usable only if it contains at least a
// description OR a brand. Otherwise it's the LLM correctly admitting it
// doesn't know the code — we keep the manual-entry path.
function hasUsableLLMData(r) {
  return !!(r && ((r.description && r.description.trim()) || (r.marque && r.marque.trim())));
}

export async function POST({ request }) {
  try {
    const { barcode } = await request.json();
    if (!barcode) return json({ error: 'Champ "barcode" manquant' }, 400);

    // Step 1 — Public databases (Open Food Facts, Beauty, Products, Pet Food,
    // Open Library, UPCitemDB). These are the source of truth: zero hallucination.
    const lookup = await lookupBarcode(barcode);

    if (lookup.found) {
      return json({
        result: lookup.result,
        source: lookup.source,            // 'openfoodfacts' | 'openlibrary' | …
        confidence: 'high',
        notice: null,
      });
    }

    // Hard fail (invalid checksum) — don't bother the LLM, the scan is broken
    if (lookup.reason === 'invalid_checksum') {
      return json({
        result: emptyArticle(lookup.code_barres),
        source: lookup.reason,
        confidence: 'none',
        notice: 'Code-barres invalide (somme de contrôle incorrecte). Vérifiez le scan ou saisissez-le manuellement.',
      });
    }

    // Step 2 — LLM fallback. Strict prompt: the LLM is told to return empty
    // fields if it doesn't recognize the code. We still warn the user that
    // any non-empty result must be verified.
    let llmResult = null;
    let llmSource = null;
    let llmError = null;
    try {
      const r = await tryBarcodeLLMs({ barcode });
      llmResult = r.result;
      llmSource = r.source;
    } catch (e) {
      llmError = e.message || String(e);
      console.warn('[barcode] LLM fallback failed:', llmError);
    }

    if (llmResult && hasUsableLLMData(llmResult)) {
      // Augment with photo_url field expected by the form (LLMs don't supply images)
      const result = { ...emptyArticle(barcode), ...llmResult, photo_url: '' };
      return json({
        result,
        source: `llm:${llmSource}`,       // 'llm:gemini' | 'llm:groq' | 'llm:mistral'
        confidence: 'low',
        notice: `Produit non trouvé dans les bases publiques. Suggestion par IA (${llmSource}) — VÉRIFIEZ les informations avant validation.`,
      });
    }

    // Step 3 — Truly unknown. Return the bare code so the user can fill in.
    const reasonText = lookup.reason === 'rate_limited'
      ? 'Bases publiques temporairement indisponibles (limite de requêtes atteinte). Réessayez dans 1 minute, ou complétez manuellement.'
      : llmError
        ? `Produit introuvable dans les bases publiques, et fallback IA indisponible (${llmError}). Complétez manuellement.`
        : 'Produit introuvable (bases publiques + IA). Complétez les champs manuellement.';

    return json({
      result: emptyArticle(lookup.code_barres),
      source: lookup.reason,
      confidence: 'none',
      notice: reasonText,
    });
  } catch (e) {
    return json({ error: e.message || 'Erreur analyse code-barres' }, 500);
  }
}
