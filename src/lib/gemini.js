// Server-side Gemini helper — called by /api/analyze/* routes
// Supports an API key pool (GEMINI_API_KEY + GEMINI_API_KEY_1..20) with
// STICKY FALLBACK: we keep using the same key for every request as long as
// it works. We only switch to the next key when the current one returns a
// quota error (429) or invalid-key error (403). Per-key cooldowns prevent
// retrying a key we just exhausted.
import { IMAGE_PROMPT, buildBarcodePrompt, normalizeArticleResult } from './llm-vision-prompt.js';

const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_INDEXED_KEYS = 20;
const COOLDOWN_QUOTA_MS = 60 * 1000;          // 1 min after a 429
const COOLDOWN_INVALID_MS = 60 * 60 * 1000;   // 1 h after a 403/invalid

// Module-level state — survives across requests in the same Node instance.
// Resets on cold start (Vercel serverless), which is fine: cooldowns are advisory.
let keyCursor = 0;
const keyCooldowns = new Map(); // apiKey -> epoch ms when usable again

// Astro/Vite expose .env via import.meta.env. Fallback to process.env for build/runtime.
function readEnv(name) {
  try {
    const v = import.meta.env?.[name];
    if (v !== undefined && v !== null && v !== '') return String(v);
  } catch {}
  const p = process.env?.[name];
  return p !== undefined && p !== null ? String(p) : '';
}

// Read all configured keys from the environment, in priority order, deduped.
// Order: GEMINI_API_KEY (legacy) -> GEMINI_API_KEY_1 -> ... -> GEMINI_API_KEY_20
function readApiKeys() {
  const keys = [];
  const main = readEnv('GEMINI_API_KEY').trim();
  if (main) keys.push(main);
  for (let i = 1; i <= MAX_INDEXED_KEYS; i++) {
    const k = readEnv(`GEMINI_API_KEY_${i}`).trim();
    if (k) keys.push(k);
  }
  return [...new Set(keys)];
}

export function getKeyCount() {
  return readApiKeys().length;
}

// Aligned on the MCD article schema (cf. mcd_mld.md §2)
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    categorie:    { type: 'STRING' },
    marque:       { type: 'STRING' },
    modele:       { type: 'STRING' },
    description:  { type: 'STRING' },
    code_barres:  { type: 'STRING' },
    taille:       { type: 'STRING' },
    prix_vente:   { type: 'NUMBER' },
  },
};

export function hasServerKey() {
  return readApiKeys().length > 0;
}

// Returns the list of keys to try (in order). If a per-request override key
// is provided (e.g. from a browser header), it is used exclusively without rotation.
export function resolveKeys(overrideKey) {
  const k = (overrideKey || '').trim();
  if (k) return [k];
  const keys = readApiKeys();
  if (!keys.length) {
    throw new Error("Aucune clé Gemini configurée. Ajoutez GEMINI_API_KEY ou GEMINI_API_KEY_1..20 dans .env");
  }
  return keys;
}

// Backwards-compatible single-key resolver (kept for any external caller).
export function resolveKey(overrideKey) {
  return resolveKeys(overrideKey)[0];
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
    return "Clé Gemini invalide ou non autorisée. Vérifiez la clé dans .env.";
  }
  if (status === 429 || /quota|RESOURCE_EXHAUSTED/i.test(msg)) {
    return "Quota Gemini dépassé sur toutes les clés. Attendez quelques minutes ou ajoutez d'autres clés.";
  }
  if (status === 400 && /SAFETY|blocked/i.test(msg)) {
    return "Image bloquée par les filtres de sécurité Gemini.";
  }
  return msg ? `Gemini: ${msg.slice(0, 200)}` : `Gemini erreur ${status}`;
}

function isQuotaError(status, msg = '') {
  return status === 429 || /quota|RESOURCE_EXHAUSTED|rate.?limit/i.test(msg);
}
function isInvalidKeyError(status, msg = '') {
  return (status === 403 || status === 400)
    && /API_KEY_INVALID|API key not valid|leaked|disabled|permission/i.test(msg);
}

// Mask a key for logs: show only first 4 + last 4 chars.
function maskKey(k) {
  if (!k) return '(empty)';
  if (k.length <= 10) return '****';
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

// Single attempt against one key. Throws an Error annotated with `.status`
// and `.geminiMessage` so the caller can decide whether to rotate.
async function callGeminiOnce({ parts, apiKey, model }) {
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
    const err = new Error(friendlyGeminiError(res.status, parsed));
    err.status = res.status;
    err.geminiMessage = parsed?.error?.message || '';
    throw err;
  }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Réponse Gemini vide ou bloquée.');
  try { return JSON.parse(text); }
  catch { throw new Error('Réponse Gemini non-JSON : ' + text.slice(0, 200)); }
}

// Sticky-fallback rotation: every request starts on the current "active" key
// (keyCursor). We only move to the next key when the active one fails with a
// quota or invalid-key error. Once we settle on a working key, the cursor
// stays there for all subsequent requests. Other errors (image rejected,
// network, malformed response) are not retried — they would fail on every
// key anyway.
async function callGemini({ parts, apiKeys, model }) {
  const total = apiKeys.length;
  if (total === 0) throw new Error("Aucune clé Gemini disponible.");
  const now = Date.now();

  // Build try-order starting at the active cursor (sticky key first).
  const order = [];
  for (let i = 0; i < total; i++) {
    order.push(apiKeys[(keyCursor + i) % total]);
  }

  let lastError = null;
  let attempted = 0;
  for (const key of order) {
    const cd = keyCooldowns.get(key);
    if (cd && cd > now) continue; // skip — still cooling down
    attempted++;
    try {
      const result = await callGeminiOnce({ parts, apiKey: key, model });
      // Success: stick on this key for the next request too.
      keyCursor = apiKeys.indexOf(key);
      keyCooldowns.delete(key); // mark recovered
      return result;
    } catch (e) {
      lastError = e;
      const status = e.status;
      const msg = e.geminiMessage || e.message || '';
      if (isQuotaError(status, msg)) {
        keyCooldowns.set(key, Date.now() + COOLDOWN_QUOTA_MS);
        // Move sticky pointer to the next key so future requests
        // start there directly instead of retrying the limited key.
        keyCursor = (apiKeys.indexOf(key) + 1) % total;
        if (total > 1) console.warn(`[gemini] key ${maskKey(key)} rate-limited, falling back to next key`);
        continue;
      }
      if (isInvalidKeyError(status, msg)) {
        keyCooldowns.set(key, Date.now() + COOLDOWN_INVALID_MS);
        keyCursor = (apiKeys.indexOf(key) + 1) % total;
        console.warn(`[gemini] key ${maskKey(key)} invalid/disabled, falling back (skipping for 1h)`);
        continue;
      }
      // Non-rotatable error — surface immediately.
      throw e;
    }
  }

  // Every key was either in cooldown or just got rate-limited.
  // As a last resort, retry the cooled-down keys ordered by soonest expiry.
  if (attempted === 0) {
    const sorted = [...apiKeys].sort(
      (a, b) => (keyCooldowns.get(a) || 0) - (keyCooldowns.get(b) || 0)
    );
    for (const key of sorted) {
      try {
        const result = await callGeminiOnce({ parts, apiKey: key, model });
        keyCursor = apiKeys.indexOf(key);
        keyCooldowns.delete(key);
        return result;
      } catch (e) { lastError = e; }
    }
  }

  throw lastError || new Error('Toutes les clés Gemini sont indisponibles. Réessayez plus tard.');
}

export async function analyzeImage({ base64DataUrl, apiKey, model }) {
  const match = /^data:(image\/[a-zA-Z+.-]+);base64,(.+)$/.exec(base64DataUrl || '');
  if (!match) throw new Error('Image invalide (attendu data:image/...;base64,...)');
  const mimeType = match[1];
  const data = match[2];

  // Use the shared image prompt (single source of truth across providers)
  const raw = await callGemini({
    parts: [
      { text: IMAGE_PROMPT },
      { inline_data: { mime_type: mimeType, data } },
    ],
    apiKeys: resolveKeys(apiKey),
    model: resolveModel(model),
  });
  return normalizeArticleResult(raw);
}

export async function analyzeBarcode({ barcode, apiKey, model }) {
  const code = String(barcode || '').trim();
  if (!code) throw new Error('Code-barres manquant');
  const raw = await callGemini({
    parts: [{ text: buildBarcodePrompt(code) }],
    apiKeys: resolveKeys(apiKey),
    model: resolveModel(model),
  });
  // Always preserve the scanned code, even if Gemini omitted/changed it
  const normalized = normalizeArticleResult(raw);
  normalized.code_barres = code;
  return normalized;
}
