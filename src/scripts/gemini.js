// AI client — calls the server-side proxy /api/analyze/*
// Keys are managed entirely server-side (env vars on Vercel).

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await res.json() : { error: await res.text() };
  if (!res.ok) throw new Error(data.error || `Erreur analyse (${res.status})`);
  return data;
}

export async function analyzeImage(base64DataUrl) {
  const data = await postJson('/api/analyze/image', { image: base64DataUrl });
  if (typeof window !== 'undefined') window.__lastAnalyzeSources = data.sources || null;
  return data.result;
}

// Returns { result, source, notice } so the caller can decide whether the
// barcode was resolved from a public DB (Open Food Facts etc.) or unknown.
export async function analyzeBarcode(barcode) {
  const data = await postJson('/api/analyze/barcode', { barcode });
  return {
    result: data.result,
    source: data.source || null,
    notice: data.notice || null,
  };
}
