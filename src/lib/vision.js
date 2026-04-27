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
  };
}

// ---- Field extractors ----------------------------------------------------
const EAN_REGEX = /\b(\d{8}|\d{12,14})\b/;

// dimension patterns: "120 x 60", "L120 x l60 x H75", "Ø30 cm"
const DIM_REGEX = /\b\d{1,4}(?:[.,]\d+)?\s*(?:cm|mm|m)?\s*[x×]\s*\d{1,4}(?:[.,]\d+)?\s*(?:cm|mm|m)?(?:\s*[x×]\s*\d{1,4}(?:[.,]\d+)?\s*(?:cm|mm|m)?)?\b/i;
const DIAM_REGEX = /[Ø∅⌀]\s*\d{1,4}(?:[.,]\d+)?\s*(?:cm|mm|m)?/;

// price patterns: "12,99 €", "12.99€", "EUR 12.99"
const PRICE_REGEX = /(\d+(?:[.,]\d{1,2}))\s*(?:€|EUR\b)|(?:€|EUR)\s*(\d+(?:[.,]\d{1,2}))/i;

export function extractFromVision(v) {
  const out = {
    marque: '',
    code_barres: '',
    taille: '',
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

  // Catégorie fallback : meilleur label "physique" (en évitant les abstractions)
  if (v.labels?.length) {
    const best = v.labels.find((l) => l.score >= 0.7) || v.labels[0];
    if (best) out.fallbackCategorie = best.name;
  }

  return out;
}
