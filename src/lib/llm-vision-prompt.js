// Shared prompt + JSON schema for image analysis. Used by every LLM provider
// (Gemini, Groq Llama Vision, Mistral Pixtral) so they all return the SAME
// structure and can be swapped transparently in the fallback chain.

// Categories list — must stay aligned with the MCD article schema.
export const CATEGORIES = [
  'Mobilier', 'Luminaire', 'Textile', 'Décoration murale',
  'Vaisselle', 'Électroménager', 'Jardin', 'Rangement',
  'Jouet', 'Électronique', 'Autre',
];

// Strict prompt used as a LAST-RESORT fallback when public barcode databases
// (Open Food Facts & co.) don't know the code. The wording explicitly tells
// the LLM NOT to guess if it doesn't recognize the code — better to return
// empty fields than to hallucinate a plausible product.
export function buildBarcodePrompt(code) {
  return `Tu es un expert produit avec une connaissance des codes EAN/UPC/GTIN.
On a scanné le code-barres: "${code}".

RÈGLES CRITIQUES:
- Si tu ne reconnais pas ce code-barres avec une CERTITUDE forte, renvoie des CHAÎNES VIDES et 0 pour les nombres.
- Ne devine JAMAIS un produit qui te semble "plausible" — la précision compte plus que la complétude.
- Conserve TOUJOURS code_barres = "${code}" tel quel.

Si tu reconnais avec certitude, renvoie un JSON conforme:
- categorie: parmi (${CATEGORIES.join(', ')})
- marque, couleur, description (français, concis)
- taille (ex: "90x190" pour literie, "L120 x H75 cm" pour mobilier, "" si inconnu)
- prix_vente: prix de vente public estimé EUR (0 si inconnu)

Réponds uniquement en JSON conforme au schéma, sans commentaire ni markdown.`;
}

// Human-readable French prompt — same for every provider.
export const IMAGE_PROMPT = `Tu es un expert en inventaire pour un magasin de décoration (DECO SHOP).
Analyse la photo fournie et renvoie un JSON strict conforme au schéma:
- categorie: parmi (${CATEGORIES.join(', ')})
- marque: nom de la marque visible ou reconnaissable ("" si inconnue)
- couleur: nom de la couleur principale en français (ex: "Bleu nuit", "Bordeaux", "Bois clair", "" si non identifiable)
- description: description courte et précise en français (1 à 2 phrases : matériaux, style, usage)
- code_barres: code-barres EAN/UPC/GTIN visible sur l'étiquette (uniquement chiffres, "" si absent)
- taille: dimensions ou taille (ex: "L120 x l60 x H75 cm", "Ø30 cm", ou pour la literie "90x190", "140x190"), "" si inconnu
- prix_vente: prix de vente public conseillé estimé en EUR (nombre ; 0 si inconnu)

Réponds STRICTEMENT en JSON conforme au schéma, sans commentaire ni markdown.`;

// JSON Schema in OpenAI-compatible format (used by Groq + Mistral).
export const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    categorie:    { type: 'string' },
    marque:       { type: 'string' },
    couleur:      { type: 'string' },
    description:  { type: 'string' },
    code_barres:  { type: 'string' },
    taille:       { type: 'string' },
    prix_vente:   { type: 'number' },
  },
  required: [
    'categorie','marque','couleur','description','code_barres','taille','prix_vente',
  ],
  additionalProperties: false,
};

// Empty result with all fields, used as a safe default when an LLM omits fields.
export function emptyArticleResult() {
  return {
    categorie: '', marque: '', couleur: '', description: '',
    code_barres: '', taille: '',
    prix_vente: 0,
  };
}

// Normalize an LLM response: ensure every required field exists and prices are numbers.
export function normalizeArticleResult(raw) {
  const def = emptyArticleResult();
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    categorie:    String(r.categorie    ?? def.categorie),
    marque:       String(r.marque       ?? def.marque),
    couleur:      String(r.couleur      ?? def.couleur),
    description:  String(r.description  ?? def.description),
    code_barres:  String(r.code_barres  ?? def.code_barres),
    taille:       String(r.taille       ?? def.taille),
    prix_vente:   Number(r.prix_vente)  || 0,
  };
}
