export const prerender = false;
import { lookupBarcode } from '../../../lib/barcode-lookup.js';

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

export async function POST({ request }) {
  try {
    const { barcode } = await request.json();
    if (!barcode) return json({ error: 'Champ "barcode" manquant' }, 400);

    const lookup = await lookupBarcode(barcode);

    if (lookup.found) {
      // Real product data from a public EAN/UPC database — no hallucination.
      return json({
        result: lookup.result,
        source: lookup.source,
        notice: null,
      });
    }

    // Code unknown: return only the barcode value, ask the user to fill in.
    // We DELIBERATELY do not fall back to an LLM here — Gemini cannot resolve
    // EAN/UPC codes reliably and would invent plausible but wrong products.
    const reasonText =
      lookup.reason === 'invalid_checksum'
        ? 'Code-barres invalide (somme de contrôle incorrecte). Vérifiez le scan ou saisissez-le manuellement.'
        : lookup.reason === 'rate_limited'
        ? 'Bases publiques temporairement indisponibles (limite de requêtes atteinte). Réessayez dans 1 minute, ou complétez manuellement.'
        : 'Produit introuvable dans les bases publiques (Open Food Facts / Beauty Facts / Products Facts). Complétez les champs manuellement.';

    return json({
      result: emptyArticle(lookup.code_barres),
      source: lookup.reason,
      notice: reasonText,
    });
  } catch (e) {
    return json({ error: e.message || 'Erreur analyse code-barres' }, 500);
  }
}
