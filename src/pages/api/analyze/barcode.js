export const prerender = false;
import { analyzeBarcode } from '../../../lib/gemini.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function POST({ request }) {
  try {
    const { barcode, model } = await request.json();
    const apiKey = request.headers.get('x-gemini-key') || '';
    if (!barcode) return json({ error: 'Champ "barcode" manquant' }, 400);
    const result = await analyzeBarcode({ barcode, apiKey, model });
    return json({ result });
  } catch (e) {
    return json({ error: e.message || 'Erreur analyse code-barres' }, 500);
  }
}
