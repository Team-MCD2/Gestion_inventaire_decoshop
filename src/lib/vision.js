// Server-side Google Cloud Vision helper
// Uses simple API key auth (REST endpoint), no service account needed

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
const EAN_REGEX = /\b(\d{8}|\d{12,14})\b/;

// dimension patterns: "120 x 60", "L120 x l60 x H75", "Ø30 cm"
const DIM_REGEX = /\b\d{1,4}(?:[.,]\d+)?\s*(?:cm|mm|m)?\s*[x×]\s*\d{1,4}(?:[.,]\d+)?\s*(?:cm|mm|m)?(?:\s*[x×]\s*\d{1,4}(?:[.,]\d+)?\s*(?:cm|mm|m)?)?\b/i;
const DIAM_REGEX = /[Ø∅⌀]\s*\d{1,4}(?:[.,]\d+)?\s*(?:cm|mm|m)?/;

// price patterns: "12,99 €", "12.99€", "EUR 12.99"
const PRICE_REGEX = /(\d+(?:[.,]\d{1,2}))\s*(?:€|EUR\b)|(?:€|EUR)\s*(\d+(?:[.,]\d{1,2}))/i;

// Convert an RGB color (0-255 each) to a coarse French color name. Used to
// fill the 'couleur' field from Cloud Vision's dominant-color analysis.
function rgbToFrenchColor({ r, g, b }) {
  if (r == null) return '';
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  // Achromatic (gray axis)
  if (delta < 25) {
    if (max < 50)  return 'Noir';
    if (max < 100) return 'Gris foncé';
    if (max < 180) return 'Gris';
    if (max < 230) return 'Gris clair';
    return 'Blanc';
  }

  // HSL conversion for hue
  const r1 = r / 255, g1 = g / 255, b1 = b / 255;
  const mx = Math.max(r1, g1, b1), mn = Math.min(r1, g1, b1);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let h = 0;
  if (d > 0) {
    if (mx === r1) h = ((g1 - b1) / d) % 6;
    else if (mx === g1) h = (b1 - r1) / d + 2;
    else h = (r1 - g1) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  if (s < 0.15) return l < 0.4 ? 'Gris foncé' : (l > 0.7 ? 'Gris clair' : 'Gris');

  // Brown : low lightness, low-medium saturation, hue 15-50
  if (h >= 15 && h <= 50 && l < 0.45 && s < 0.7) return 'Marron';
  // Beige : high lightness, low-medium saturation, hue 30-60
  if (h >= 30 && h <= 60 && l > 0.7 && s < 0.5) return 'Beige';

  if (h < 15 || h >= 345) return 'Rouge';
  if (h < 35)  return 'Orange';
  if (h < 65)  return 'Jaune';
  if (h < 165) return 'Vert';
  if (h < 200) return 'Cyan';
  if (h < 260) return 'Bleu';
  if (h < 310) return 'Violet';
  return 'Rose';
}

export function extractFromVision(v) {
  const out = {
    marque: '',
    code_barres: '',
    taille: '',
    couleur: '',
    detectedPrice: 0,
    fallbackCategorie: '',
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

  const dimMatch = text.match(DIM_REGEX);
  if (dimMatch) out.taille = dimMatch[0].replace(/\s+/g, ' ').trim();
  else {
    const diamMatch = text.match(DIAM_REGEX);
    if (diamMatch) out.taille = diamMatch[0].replace(/\s+/g, ' ').trim();
  }

  const priceMatch = text.match(PRICE_REGEX);
  if (priceMatch) {
    const raw = (priceMatch[1] || priceMatch[2] || '').replace(',', '.');
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n < 100000) out.detectedPrice = n;
  }

  // Couleur dominante (premier cluster, le plus représentatif)
  if (v.colors?.length) out.couleur = rgbToFrenchColor(v.colors[0]);

  // Catégorie fallback : meilleur label "physique" (en évitant les abstractions)
  if (v.labels?.length) {
    const best = v.labels.find((l) => l.score >= 0.7) || v.labels[0];
    if (best) out.fallbackCategorie = best.name;
  }

  return out;
}
