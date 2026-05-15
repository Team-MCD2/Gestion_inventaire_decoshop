// Server-side Google Cloud Vision helper
// Uses simple API key auth (REST endpoint), no service account needed.
//
// Marché de Mo' grocery — extracts EAN, format (poids/volume), DLC, prix et
// devine le rayon depuis les labels OCR (cf. extractFromVision en bas).
import { guessRayonFromText } from './rayons.js';

function readEnv(name) {
  try {
    const v = import.meta.env?.[name];
    if (v !== undefined && v !== null && v !== '') return String(v);
  } catch {}
  const p = process.env?.[name];
  return p !== undefined && p !== null ? String(p) : '';
}

export function hasVisionKey() {
  return !!readEnv('GOOGLE_VISION_API_KEY').trim();
}

function resolveVisionKey(overrideKey) {
  const k = (overrideKey || '').trim();
  if (k) return k;
  const env = readEnv('GOOGLE_VISION_API_KEY').trim();
  if (env) return env;
  throw new Error('Aucune clé Google Cloud Vision configurée.');
}

function friendlyVisionError(status, body) {
  const msg = body?.error?.message || '';
  if (/billing/i.test(msg)) {
    return "Cloud Vision : facturation non activée sur le projet GCP. Activez-la sur console.cloud.google.com/billing (gratuit jusqu'à 1000 req/mois).";
  }
  if (status === 403 && /API has not been used|Vision API.*disabled/i.test(msg)) {
    return "Cloud Vision API désactivée sur ce projet. Activez-la dans GCP Console > APIs & Services > Library.";
  }
  if (status === 403 || /API_KEY_INVALID|API key not valid/i.test(msg)) {
    return "Clé Cloud Vision invalide ou non autorisée. Vérifiez la clé et ses restrictions.";
  }
  if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(msg)) {
    return "Quota Cloud Vision dépassé.";
  }
  return msg ? `Vision: ${msg.slice(0, 200)}` : `Vision erreur ${status}`;
}

// ---- Vision REST call ----------------------------------------------------
export async function visionAnnotate(base64DataUrl, { apiKey } = {}) {
  const key = resolveVisionKey(apiKey);
  const match = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/.exec(base64DataUrl || '');
  if (!match) throw new Error('Image invalide pour Vision (attendu data:image/...;base64,...)');
  const content = match[2];

  const url = `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`;
  const body = {
    requests: [{
      image: { content },
      features: [
        { type: 'LOGO_DETECTION',         maxResults: 3 },
        { type: 'LABEL_DETECTION',        maxResults: 8 },
        { type: 'OBJECT_LOCALIZATION',    maxResults: 5 },
        { type: 'TEXT_DETECTION' },
        { type: 'IMAGE_PROPERTIES' },
      ],
      imageContext: { languageHints: ['fr', 'en'] },
    }],
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000), // Abort after 15s
  });
  if (!res.ok) {
    let parsed = null;
    try { parsed = await res.json(); } catch {}
    throw new Error(friendlyVisionError(res.status, parsed));
  }
  const json = await res.json();
  const r = json.responses?.[0] || {};
  if (r.error) throw new Error(friendlyVisionError(r.error.code || 500, { error: r.error }));

  return {
    logos: (r.logoAnnotations || []).map((l) => ({ name: l.description, score: l.score || 0 })),
    labels: (r.labelAnnotations || []).map((l) => ({ name: l.description, score: l.score || 0 })),
    objects: (r.localizedObjectAnnotations || []).map((o) => ({ name: o.name, score: o.score || 0 })),
    text: r.fullTextAnnotation?.text || r.textAnnotations?.[0]?.description || '',
    colors: (r.imagePropertiesAnnotation?.dominantColors?.colors || []).slice(0, 3).map((c) => ({
      r: Math.round(c.color?.red || 0),
      g: Math.round(c.color?.green || 0),
      b: Math.round(c.color?.blue || 0),
      score: c.score || 0,
      pixelFraction: c.pixelFraction || 0,
    })),
  };
}

// ---- Field extractors ----------------------------------------------------
// EAN-8 / UPC-A / EAN-13 / GTIN-14
const EAN_REGEX = /\b(\d{8}|\d{12,14})\b/;

// Format/poids/volume grocery — couvre la majorité des emballages :
//   "500g", "1.5 kg", "1L", "200 ml", "12 unités", "6 x 33cl", "70 cl",
//   "1,5 L", "350 g e", "Net wt 500g"
const FORMAT_REGEX_LIST = [
  /\b\d{1,4}(?:[.,]\d+)?\s*(?:x|×)\s*\d{1,4}(?:[.,]\d+)?\s*(?:g|kg|ml|cl|l|L)\b/i,         // "6 x 33cl"
  /\b\d{1,4}(?:[.,]\d+)?\s*(?:kg|g|mg)\b(?!\w)/i,                                          // "500g" / "1,5 kg"
  /\b\d{1,4}(?:[.,]\d+)?\s*(?:L|ml|cl|dl)\b(?!\w)/i,                                       // "1L" / "200 ml"
  /\b\d{1,4}\s*(?:unit[ée]s?|pi[èe]ces?|pcs|pack|bouteilles?|sachets?)\b/i,                // "12 unités"
];

// price patterns: "12,99 €", "12.99€", "EUR 12.99"
const PRICE_REGEX = /(\d+(?:[.,]\d{1,2}))\s*(?:€|EUR\b)|(?:€|EUR)\s*(\d+(?:[.,]\d{1,2}))/i;

// Note : on n'extrait plus la couleur dominante (champ obsolète depuis le
// passage au grocery — cf. supabase/schema.sql). Le helper rgbToFrenchColor
// a été retiré ; l'analyse d'image se concentre sur les champs métier
// utiles aux équipes magasin (EAN, format, DLC, prix, marque, rayon).

// DLC patterns — détecte la date sur l'étiquette ("À consommer avant le 12/06/2026")
// Formats acceptés : DD/MM/YYYY · DD.MM.YYYY · DD-MM-YYYY · DD/MM/YY
const DLC_PHRASE_REGEX = /(?:à\s*consommer\s*(?:avant|jusqu['’]au)\s*(?:le)?|DLC|DDM|date\s*limite|best\s*before|exp\.?|expire)\s*[: ]*\s*(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})/i;
const DATE_FALLBACK_REGEX = /\b(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})\b/;

/**
 * Parse une date FR (JJ/MM/AAAA ou JJ/MM/AA) en chaîne ISO YYYY-MM-DD.
 * Retourne '' si la date est invalide ou dans le passé lointain.
 */
function parseFrenchDate(raw) {
  const m = String(raw || '').match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!m) return '';
  let [, d, mo, y] = m;
  y = String(y);
  if (y.length === 2) y = (Number(y) >= 70 ? '19' : '20') + y;
  const day = Number(d), month = Number(mo), year = Number(y);
  if (!day || !month || !year || month < 1 || month > 12 || day < 1 || day > 31) return '';
  // Bornes raisonnables pour une DLC (entre aujourd'hui - 1 an et + 5 ans).
  const dateObj = new Date(year, month - 1, day);
  const now = new Date();
  const minDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const maxDate = new Date(now.getFullYear() + 5, now.getMonth(), now.getDate());
  if (dateObj < minDate || dateObj > maxDate) return '';
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

/**
 * Extrait les champs métier depuis une réponse Cloud Vision.
 *
 * Retour : un objet aligné sur le schéma grocery (rayon, format, dlc, etc.).
 * Pour la rétro-compatibilité avec lib/analyze.js, on expose AUSSI les anciens
 * noms (taille, fallbackCategorie) en alias en lecture seule — mais le nouveau
 * code doit consommer format / fallbackRayon.
 *
 * @param {ReturnType<typeof visionAnnotate> extends Promise<infer T> ? T : any} v
 */
export function extractFromVision(v) {
  /** @type {{
   *   marque: string, code_barres: string, format: string, dlc: string,
   *   detectedPrice: number, fallbackRayon: string, logoConfidence: number,
   *   taille?: string, fallbackCategorie?: string,
   * }} */
  const out = {
    marque: '',
    code_barres: '',
    format: '',
    dlc: '',
    detectedPrice: 0,
    fallbackRayon: '',
    logoConfidence: 0,
  };
  if (!v) return out;

  // Logo → marque
  if (v.logos?.length) {
    out.marque = v.logos[0].name || '';
    out.logoConfidence = v.logos[0].score || 0;
  }

  // OCR
  const text = v.text || '';
  const eanMatch = text.match(EAN_REGEX);
  if (eanMatch) out.code_barres = eanMatch[1];

  // Format (poids/volume/unités) — premier pattern qui matche gagne
  for (const re of FORMAT_REGEX_LIST) {
    const m = text.match(re);
    if (m) {
      out.format = m[0].replace(/\s+/g, ' ').trim();
      break;
    }
  }

  // Prix étiquette
  const priceMatch = text.match(PRICE_REGEX);
  if (priceMatch) {
    const raw = (priceMatch[1] || priceMatch[2] || '').replace(',', '.');
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n < 100000) out.detectedPrice = n;
  }

  // DLC : on essaie d'abord une phrase explicite ("À consommer avant le X")
  // puis une date isolée en fallback (moins fiable mais utile sur les étiquettes
  // courtes type pâtes / conserves).
  const phraseMatch = text.match(DLC_PHRASE_REGEX);
  if (phraseMatch) out.dlc = parseFrenchDate(phraseMatch[1]);
  if (!out.dlc) {
    const fallbackMatch = text.match(DATE_FALLBACK_REGEX);
    if (fallbackMatch) out.dlc = parseFrenchDate(fallbackMatch[1]);
  }

  // Rayon : on combine les labels + l'OCR + le nom du logo pour deviner le
  // rayon grocery via guessRayonFromText (lib/rayons.js).
  const corpus = [
    text,
    out.marque,
    ...(v.labels || []).map((l) => l.name),
    ...(v.objects || []).map((o) => o.name),
  ].filter(Boolean).join(' ');
  out.fallbackRayon = guessRayonFromText(corpus);

  // Aliases pour la rétro-compatibilité de lib/analyze.js (lecture seule).
  out.taille = out.format;
  out.fallbackCategorie = out.fallbackRayon;

  return out;
}
