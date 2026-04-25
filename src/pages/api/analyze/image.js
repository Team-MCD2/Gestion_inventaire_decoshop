export const prerender = false;
import { analyzeImageHybrid } from '../../../lib/analyze.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function POST({ request }) {
  try {
    const { image, model } = await request.json();
    const geminiKey = request.headers.get('x-gemini-key') || '';
    const visionKey = request.headers.get('x-vision-key') || '';
    if (!image) return json({ error: 'Champ "image" manquant (data URL)' }, 400);
    const { merged, sources } = await analyzeImageHybrid({
      base64DataUrl: image, geminiKey, visionKey, model,
    });
    return json({ result: merged, sources });
  } catch (e) {
    return json({ error: e.message || 'Erreur analyse image' }, 500);
  }
}
