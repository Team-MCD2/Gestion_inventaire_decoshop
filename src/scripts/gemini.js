// AI client — calls the server-side proxy /api/analyze/*
// Keys are managed entirely server-side (env vars on Vercel).

async function postAnalyze(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : { error: await res.text() };
  if (!res.ok) throw new Error(data.error || `Erreur analyse (${res.status})`);
  // Stash raw sources for debug (window.__lastAnalyzeSources)
  if (typeof window !== 'undefined') window.__lastAnalyzeSources = data.sources || null;
  return data.result;
}

export async function analyzeImage(base64DataUrl) {
  return postAnalyze('/api/analyze/image', { image: base64DataUrl });
}

export async function analyzeBarcode(barcode) {
  return postAnalyze('/api/analyze/barcode', { barcode });
}
