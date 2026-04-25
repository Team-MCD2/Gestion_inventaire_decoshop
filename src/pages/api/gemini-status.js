export const prerender = false;
import { hasServerKey as hasGeminiKey, resolveModel } from '../../lib/gemini.js';
import { hasVisionKey } from '../../lib/vision.js';

export async function GET() {
  return new Response(
    JSON.stringify({
      // legacy field (kept for backwards compat with the client)
      serverKey: hasGeminiKey(),
      // new fields
      geminiKey: hasGeminiKey(),
      visionKey: hasVisionKey(),
      model: resolveModel(),
    }),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
  );
}
