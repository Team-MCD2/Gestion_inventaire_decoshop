// Mistral vision provider — Pixtral 12B / Pixtral Large via OpenAI-compatible API.
// Free tier (April 2026): 1 billion tokens/month, but only 2 req/min cap.
// Use it as a LAST-RESORT fallback because of the strict RPM limit.
// Get a key: https://console.mistral.ai/api-keys (no credit card required)

import { IMAGE_PROMPT, normalizeArticleResult } from './llm-vision-prompt.js';

const DEFAULT_MODEL = 'pixtral-12b-latest';
const MAX_INDEXED_KEYS = 10;
const COOLDOWN_QUOTA_MS = 60 * 1000;
const COOLDOWN_INVALID_MS = 60 * 60 * 1000;
const ENDPOINT = 'https://api.mistral.ai/v1/chat/completions';

let keyCursor = 0;
const keyCooldowns = new Map();

function readEnv(name) {
  try {
    const v = import.meta.env?.[name];
    if (v !== undefined && v !== null && v !== '') return String(v);
  } catch {}
  const p = process.env?.[name];
  return p !== undefined && p !== null ? String(p) : '';
}

function readApiKeys() {
  const keys = [];
  const main = readEnv('MISTRAL_API_KEY').trim();
  if (main) keys.push(main);
  for (let i = 1; i <= MAX_INDEXED_KEYS; i++) {
    const k = readEnv(`MISTRAL_API_KEY_${i}`).trim();
    if (k) keys.push(k);
  }
  return [...new Set(keys)];
}

export function hasMistralKey() {
  return readApiKeys().length > 0;
}

export function getMistralKeyCount() {
  return readApiKeys().length;
}

export function resolveMistralModel(overrideModel) {
  return (overrideModel || readEnv('MISTRAL_MODEL') || DEFAULT_MODEL).trim();
}

function maskKey(k) {
  if (!k) return '(empty)';
  if (k.length <= 10) return '****';
  return `${k.slice(0, 4)}…${k.slice(-4)}`;
}

function isQuotaError(status, msg = '') {
  return status === 429 || /quota|rate.?limit|too many/i.test(msg);
}
function isInvalidKeyError(status, msg = '') {
  return (status === 401 || status === 403) && /invalid|unauthorized|disabled|api.?key/i.test(msg);
}

async function callMistralOnce({ messages, apiKey, model }) {
  const body = {
    model,
    messages,
    response_format: { type: 'json_object' },
    temperature: 0.2,
    max_tokens: 1024,
  };
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let parsed = null;
    try { parsed = await res.json(); } catch {}
    const msg = parsed?.message || parsed?.error?.message || `Mistral erreur ${res.status}`;
    const err = new Error(`Mistral: ${String(msg).slice(0, 200)}`);
    err.status = res.status;
    err.providerMessage = String(msg);
    throw err;
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (!text) throw new Error('Réponse Mistral vide.');
  try { return JSON.parse(text); }
  catch { throw new Error('Réponse Mistral non-JSON : ' + text.slice(0, 200)); }
}

async function callMistral({ messages, model }) {
  const keys = readApiKeys();
  if (keys.length === 0) throw new Error('Aucune clé Mistral configurée.');
  const total = keys.length;
  const now = Date.now();
  const order = [];
  for (let i = 0; i < total; i++) order.push(keys[(keyCursor + i) % total]);

  let lastError = null;
  let attempted = 0;
  for (const key of order) {
    const cd = keyCooldowns.get(key);
    if (cd && cd > now) continue;
    attempted++;
    try {
      const result = await callMistralOnce({ messages, apiKey: key, model });
      keyCursor = keys.indexOf(key);
      keyCooldowns.delete(key);
      return result;
    } catch (e) {
      lastError = e;
      const status = e.status;
      const msg = e.providerMessage || e.message || '';
      if (isQuotaError(status, msg)) {
        keyCooldowns.set(key, Date.now() + COOLDOWN_QUOTA_MS);
        keyCursor = (keys.indexOf(key) + 1) % total;
        if (total > 1) console.warn(`[mistral] key ${maskKey(key)} rate-limited, falling back`);
        continue;
      }
      if (isInvalidKeyError(status, msg)) {
        keyCooldowns.set(key, Date.now() + COOLDOWN_INVALID_MS);
        keyCursor = (keys.indexOf(key) + 1) % total;
        console.warn(`[mistral] key ${maskKey(key)} invalid, skipping for 1h`);
        continue;
      }
      throw e;
    }
  }
  if (attempted === 0) {
    const sorted = [...keys].sort((a, b) => (keyCooldowns.get(a) || 0) - (keyCooldowns.get(b) || 0));
    for (const key of sorted) {
      try {
        const result = await callMistralOnce({ messages, apiKey: key, model });
        keyCursor = keys.indexOf(key);
        keyCooldowns.delete(key);
        return result;
      } catch (e) { lastError = e; }
    }
  }
  throw lastError || new Error('Toutes les clés Mistral sont indisponibles.');
}

export async function analyzeImageMistral({ base64DataUrl, model } = {}) {
  if (!/^data:image\/[a-zA-Z+.-]+;base64,.+$/.test(base64DataUrl || '')) {
    throw new Error('Image invalide (attendu data:image/...;base64,...)');
  }
  const messages = [
    {
      role: 'user',
      content: [
        { type: 'text', text: IMAGE_PROMPT },
        { type: 'image_url', image_url: base64DataUrl },
      ],
    },
  ];
  const raw = await callMistral({ messages, model: resolveMistralModel(model) });
  return normalizeArticleResult(raw);
}
