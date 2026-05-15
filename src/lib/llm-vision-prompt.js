// Marché de Mo' — Prompt + JSON schema partagés pour l'analyse d'image.
// Utilisé par TOUS les providers LLM vision (Gemini, Groq Llama Vision,
// Mistral Pixtral) pour qu'ils renvoient la MÊME structure et soient
// interchangeables dans la chaîne de fallback.
//
// Aligné sur le MCD article grocery (cf. supabase/schema.sql §1).

import { RAYON_SLUGS, RAYONS } from './rayons.js';

// Liste des slugs autorisés en sortie LLM — partagée avec le schéma JSON.
// On donne aussi le libellé humain au LLM pour qu'il choisisse en
// connaissance de cause.
const RAYONS_FOR_PROMPT = RAYONS.map((r) => `${r.slug} (${r.label})`).join(', ');

/**
 * Prompt code-barres (fallback de dernière chance après Open Food Facts &
 * consorts). Wording strict : le LLM ne devine PAS s'il n'est pas certain —
 * mieux vaut renvoyer des champs vides qu'un produit halluciné.
 *
 * @param {string} code
 * @returns {string}
 */
export function buildBarcodePrompt(code) {
  return `Tu es un expert produit pour un supermarché épicerie du monde,
avec une connaissance des codes EAN/UPC/GTIN alimentaires et non-alimentaires.
On a scanné le code-barres : "${code}".

RÈGLES CRITIQUES :
- Si tu ne reconnais pas ce code-barres avec une CERTITUDE forte, renvoie des
  CHAÎNES VIDES et 0 pour les nombres.
- Ne devine JAMAIS un produit qui te semble "plausible" — la précision compte
  plus que la complétude.
- Conserve TOUJOURS code_barres = "${code}" tel quel.

Si tu reconnais avec certitude, renvoie un JSON conforme :
- rayon : choisir parmi ces slugs uniquement (${RAYON_SLUGS.join(', ')})
- nom_produit : nom commercial court (ex: "Banane plantain mûre", "Lait UHT demi-écrémé")
- marque : marque commerciale ou "" si générique / sans marque
- format : format/poids/contenance (ex: "500g", "1L", "12 unités", "200ml")
- description : description courte en français (1 phrase factuelle)
- prix_vente : prix de vente public estimé EUR (0 si inconnu)

Réponds uniquement en JSON conforme au schéma, sans commentaire ni markdown.`;
}

/**
 * Prompt image (analyse photo / vidéo) — appelé quand un employé filme un
 * article ou importe une photo depuis sa galerie. On demande au LLM d'extraire
 * un maximum d'infos lisibles sur l'emballage.
 */
export const IMAGE_PROMPT = `Tu es un expert en inventaire pour un supermarché épicerie du monde
(Marché de Mo'). Le supermarché vend des produits du monde entier : Afrique,
Asie, Méditerranée, Amérique Latine, Balkans, Turquie, boucherie halal,
fruits & légumes, surgelés et épicerie courante.

Analyse la photo fournie et renvoie un JSON strict conforme au schéma :

- rayon : choisis le slug le plus pertinent parmi cette liste fermée :
    ${RAYONS_FOR_PROMPT}
- nom_produit : nom commercial court et précis (ex: "Banane plantain mûre",
  "Lait de coco Aroy-D", "Couscous moyen Tipiaco"), "" si illisible
- marque : nom de la marque visible ou reconnaissable ("" si générique /
  produit en vrac / marque distributeur sans nom propre)
- format : poids / volume / nombre d'unités visible sur l'étiquette
  (ex: "500g", "1L", "12 unités", "200ml", "5kg"), "" si pas visible
- code_barres : code-barres EAN/UPC/GTIN visible sur l'étiquette
  (uniquement chiffres, "" si absent / illisible)
- description : description courte en français (1 phrase factuelle :
  origine du produit, particularité, label bio/halal/sans gluten si mentionné)
- prix_vente : prix de vente public estimé en EUR (nombre ; 0 si inconnu)

Réponds STRICTEMENT en JSON conforme au schéma, sans commentaire ni markdown.`;

// JSON Schema au format OpenAI-compatible (utilisé par Groq + Mistral).
export const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    rayon:        { type: 'string' },
    nom_produit:  { type: 'string' },
    marque:       { type: 'string' },
    format:       { type: 'string' },
    code_barres:  { type: 'string' },
    description:  { type: 'string' },
    prix_vente:   { type: 'number' },
  },
  required: [
    'rayon', 'nom_produit', 'marque', 'format', 'code_barres', 'description', 'prix_vente',
  ],
  additionalProperties: false,
};

// Résultat vide avec tous les champs, utilisé comme valeur par défaut quand un
// LLM omet des champs.
export function emptyArticleResult() {
  return {
    rayon: '',
    nom_produit: '',
    marque: '',
    format: '',
    code_barres: '',
    description: '',
    prix_vente: 0,
  };
}

/**
 * Normalise une réponse LLM : s'assure que chaque champ requis existe, que
 * les prix sont des nombres et que le rayon est dans la liste autorisée
 * (sinon on le vide pour éviter de polluer la DB avec des slugs inventés).
 *
 * @param {any} raw
 */
export function normalizeArticleResult(raw) {
  const def = emptyArticleResult();
  const r = raw && typeof raw === 'object' ? raw : {};
  const rayon = String(r.rayon ?? def.rayon).trim();
  return {
    rayon:        RAYON_SLUGS.includes(rayon) ? rayon : '',
    nom_produit:  String(r.nom_produit  ?? def.nom_produit),
    marque:       String(r.marque       ?? def.marque),
    format:       String(r.format       ?? def.format),
    code_barres:  String(r.code_barres  ?? def.code_barres),
    description:  String(r.description  ?? def.description),
    prix_vente:   Number(r.prix_vente)  || 0,
  };
}
