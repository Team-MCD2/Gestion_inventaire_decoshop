// AI client — calls the server-side proxy /api/analyze/*
// Keys live in .env server-side (Gemini + optional Cloud Vision).
// Users can override either with personal keys via Settings.
import { getState } from './state.js';

let serverStatusCache = null;
// shape: { geminiKey: bool, visionKey: bool, model: string, serverKey: bool /* legacy */ }

export async function getServerStatus(force = false) {
  if (serverStatusCache && !force) return serverStatusCache;
  try {
    const res = await fetch('/api/gemini-status');
    if (!res.ok) throw new Error('status');
    serverStatusCache = await res.json();
  } catch {
    serverStatusCache = { geminiKey: false, visionKey: false, serverKey: false, model: 'gemini-2.5-flash' };
  }
  return serverStatusCache;
}

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const s = getState().settings;
  const gKey = (s.geminiApiKey || '').trim();
  const vKey = (s.googleVisionApiKey || '').trim();
  if (gKey) headers['x-gemini-key'] = gKey;
  if (vKey) headers['x-vision-key'] = vKey;
  return headers;
}

async function postAnalyze(path, body) {
  const status = await getServerStatus();
  const s = getState().settings;
  const userGemini = (s.geminiApiKey || '').trim();
  if (!status.geminiKey && !userGemini) {
    throw new Error("Aucune clé Gemini configurée (serveur ou navigateur). Ouvrez « Paramètres ».");
  }
  const res = await fetch(path, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ ...body, model: s.model || undefined }),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : { error: await res.text() };
  if (!res.ok) throw new Error(data.error || `Erreur analyse (${res.status})`);
  // Return only the merged result; sources kept under window.__lastAnalyzeSources for debug
  if (typeof window !== 'undefined') window.__lastAnalyzeSources = data.sources || null;
  return data.result;
}

export async function analyzeImage(base64DataUrl) {
  return postAnalyze('/api/analyze/image', { image: base64DataUrl });
}

export async function analyzeBarcode(barcode) {
  return postAnalyze('/api/analyze/barcode', { barcode });
}
