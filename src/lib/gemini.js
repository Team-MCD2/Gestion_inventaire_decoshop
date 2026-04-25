// Server-side Gemini helper — called by /api/analyze/* routes
const DEFAULT_MODEL = 'gemini-2.5-flash';

// Astro/Vite expose .env via import.meta.env. Fallback to process.env for build/runtime.
function readEnv(name) {
  try {
    const v = import.meta.env?.[name];
    if (v !== undefined && v !== null && v !== '') return String(v);
  } catch {}
  const p = process.env?.[name];
  return p !== undefined && p !== null ? String(p) : '';
}

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    categorie: { type: 'STRING' },
    marque: { type: 'STRING' },
    modele: { type: 'STRING' },
    description: { type: 'STRING' },
    reference: { type: 'STRING' },
    couleur: { type: 'STRING' },
    dimension: { type: 'STRING' },
    prix_achat: { type: 'NUMBER' },
    prix_vente: { type: 'NUMBER' },
  },
};

export function hasServerKey() {
  return !!readEnv('GEMINI_API_KEY').trim();
}

export function resolveKey(overrideKey) {
  const k = (overrideKey || '').trim();
  if (k) return k;
  const envKey = readEnv('GEMINI_API_KEY').trim();
  if (envKey) return envKey;
  throw new Error("Aucune clé Gemini configurée (ni serveur ni navigateur).");
}

export function resolveModel(overrideModel) {
  return (overrideModel || readEnv('GEMINI_MODEL') || DEFAULT_MODEL).trim();
}

function friendlyGeminiError(status, body) {
  const msg = body?.error?.message || '';
  if (/leaked|reported as leaked/i.test(msg)) {
    return "Clé Gemini révoquée par Google (signalée comme exposée). Créez-en une nouvelle sur aistudio.google.com/app/apikey.";
  }
  if (status === 403 || /API_KEY_INVALID|API key not valid/i.test(msg)) {
    return "Clé Gemini invalide ou non autorisée. Vérifiez la clé dans .env ou Paramètres.";
  }
  if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(msg)) {
    return "Quota Gemini dépassé. Attendez quelques minutes ou changez de clé.";
  }
  if (status === 400 && /SAFETY|blocked/i.test(msg)) {
    return "Image bloquée par les filtres de sécurité Gemini.";
  }
  return msg ? `Gemini: ${msg.slice(0, 200)}` : `Gemini erreur ${status}`;
}

async function callGemini({ parts, apiKey, model }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      temperature: 0.2,
    },
  };
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let parsed = null;
    try { parsed = await res.json(); } catch {}
    throw new Error(friendlyGeminiError(res.status, parsed));
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Réponse Gemini vide ou bloquée.');
  try { return JSON.parse(text); }
  catch { throw new Error('Réponse Gemini non-JSON : ' + text.slice(0, 200)); }
}

export async function analyzeImage({ base64DataUrl, apiKey, model }) {
  const match = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/.exec(base64DataUrl || '');
  if (!match) throw new Error('Image invalide (attendu data:image/...;base64,...)');
  const mimeType = match[1];
  const data = match[2];

  const prompt = `Tu es un expert en inventaire pour un magasin de décoration (DECO SHOP).
Analyse la photo fournie et renvoie un JSON strict conforme au schéma:
- categorie: parmi (Mobilier, Luminaire, Textile, Décoration murale, Vaisselle, Électroménager, Jardin, Rangement, Jouet, Électronique, Autre)
- marque: nom de la marque visible ou reconnaissable ("" si inconnue)
- modele: nom/référence du modèle ("" si inconnu)
- description: description courte et précise en français (1 à 2 phrases : matériaux, style, usage)
- reference: code produit / référence interne si visible sur l'étiquette ("" si absent)
- couleur: couleur(s) principale(s) de l'article (ex: "Noir", "Blanc/Bois", "Rouge")
- dimension: dimensions si visibles ou estimables (ex: "L120 x l60 x H75 cm" ou "Ø30 cm"), sinon ""
- prix_achat: prix d'achat grossiste estimé en EUR (nombre ; 0 si inconnu)
- prix_vente: prix de vente public conseillé estimé en EUR (nombre ; 0 si inconnu)

Réponds STRICTEMENT en JSON conforme au schéma, sans commentaire ni markdown.`;

  return callGemini({
    parts: [
      { text: prompt },
      { inline_data: { mime_type: mimeType, data } },
    ],
    apiKey: resolveKey(apiKey),
    model: resolveModel(model),
  });
}

export async function analyzeBarcode({ barcode, apiKey, model }) {
  const code = String(barcode || '').trim();
  if (!code) throw new Error('Code-barres manquant');
  const prompt = `Tu es un expert produit avec une connaissance des codes EAN/UPC/GTIN.
On a scanné le code-barres: "${code}".
Identifie le produit au mieux de ta connaissance et renvoie un JSON strict:
- categorie: (Mobilier, Luminaire, Textile, Décoration murale, Vaisselle, Électroménager, Jardin, Rangement, Jouet, Électronique, Autre)
- marque, modele, description (français, concis)
- reference: "${code}" (garde le code-barres comme référence)
- couleur, dimension (si connues)
- prix_achat: prix d'achat estimé EUR (0 si inconnu)
- prix_vente: prix de vente public estimé EUR (0 si inconnu)

Si le produit est totalement inconnu, renvoie chaînes vides et 0 pour les nombres,
mais CONSERVE reference = "${code}".
Réponds uniquement en JSON conforme au schéma.`;

  return callGemini({
    parts: [{ text: prompt }],
    apiKey: resolveKey(apiKey),
    model: resolveModel(model),
  });
}
