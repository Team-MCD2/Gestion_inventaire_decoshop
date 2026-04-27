// Shared prompt + JSON schema for image analysis. Used by every LLM provider
// (Gemini, Groq Llama Vision, Mistral Pixtral) so they all return the SAME
// structure and can be swapped transparently in the fallback chain.

// Categories list — must stay aligned with the MCD article schema.
export const CATEGORIES = [
  'Mobilier', 'Luminaire', 'Textile', 'Décoration murale',
  'Vaisselle', 'Électroménager', 'Jardin', 'Rangement',
  'Jouet', 'Électronique', 'Autre',
];

export const SOFA_SIZES = ['1 place', '2 places', '3 places', 'Angle', 'Méridienne'];

// Human-readable French prompt — same for every provider.
export const IMAGE_PROMPT = `Tu es un expert en inventaire pour un magasin de décoration (DECO SHOP).
Analyse la photo fournie et renvoie un JSON strict conforme au schéma:
- categorie: parmi (${CATEGORIES.join(', ')})
- marque: nom de la marque visible ou reconnaissable ("" si inconnue)
- modele: nom/référence du modèle ("" si inconnu)
- description: description courte et précise en français (1 à 2 phrases : matériaux, style, usage)
- code_barres: code-barres EAN/UPC/GTIN visible sur l'étiquette (uniquement chiffres, "" si absent)
- couleur: nom de la couleur principale en français (ex: "Bleu nuit", "Bordeaux", "Bois clair")
- ref_couleur: référence numérique de la couleur si imprimée sur l'étiquette (ex: "020", "035"), "" si absente
- taille: dimensions ou taille (ex: "L120 x l60 x H75 cm", "Ø30 cm", ou pour la literie "90x190", "140x190"), "" si inconnu
- taille_canape: pour un canapé uniquement, parmi (${SOFA_SIZES.join(', ')}), sinon ""
- prix_achat: prix d'achat grossiste estimé en EUR (nombre ; 0 si inconnu)
- prix_vente: prix de vente public conseillé estimé en EUR (nombre ; 0 si inconnu)

Réponds STRICTEMENT en JSON conforme au schéma, sans commentaire ni markdown.`;

// JSON Schema in OpenAI-compatible format (used by Groq + Mistral).
export const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    categorie:    { type: 'string' },
    marque:       { type: 'string' },
    modele:       { type: 'string' },
    description:  { type: 'string' },
    code_barres:  { type: 'string' },
    couleur:      { type: 'string' },
    ref_couleur:  { type: 'string' },
    taille:       { type: 'string' },
    taille_canape:{ type: 'string' },
    prix_achat:   { type: 'number' },
    prix_vente:   { type: 'number' },
  },
  required: [
    'categorie','marque','modele','description','code_barres',
    'couleur','ref_couleur','taille','taille_canape','prix_achat','prix_vente',
  ],
  additionalProperties: false,
};

// Empty result with all fields, used as a safe default when an LLM omits fields.
export function emptyArticleResult() {
  return {
    categorie: '', marque: '', modele: '', description: '',
    code_barres: '', couleur: '', ref_couleur: '',
    taille: '', taille_canape: '',
    prix_achat: 0, prix_vente: 0,
  };
}

// Normalize an LLM response: ensure every required field exists and prices are numbers.
export function normalizeArticleResult(raw) {
  const def = emptyArticleResult();
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    categorie:    String(r.categorie    ?? def.categorie),
    marque:       String(r.marque       ?? def.marque),
    modele:       String(r.modele       ?? def.modele),
    description:  String(r.description  ?? def.description),
    code_barres:  String(r.code_barres  ?? def.code_barres),
    couleur:      String(r.couleur      ?? def.couleur),
    ref_couleur:  String(r.ref_couleur  ?? def.ref_couleur),
    taille:       String(r.taille       ?? def.taille),
    taille_canape:String(r.taille_canape?? def.taille_canape),
    prix_achat:   Number(r.prix_achat) || 0,
    prix_vente:   Number(r.prix_vente)  || 0,
  };
}
