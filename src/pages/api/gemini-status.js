export const prerender = false;
import { hasServerKey as hasGeminiKey, getKeyCount as getGeminiKeyCount, resolveModel as resolveGeminiModel } from '../../lib/gemini.js';
import { hasGroqKey,    getGroqKeyCount,    resolveGroqModel    } from '../../lib/groq.js';
import { hasMistralKey, getMistralKeyCount, resolveMistralModel } from '../../lib/mistral.js';
import { hasVisionKey } from '../../lib/vision.js';

export async function GET() {
  return new Response(
    JSON.stringify({
      // legacy field (kept for backwards compat with the client)
      serverKey: hasGeminiKey(),
      // primary LLM
      geminiKey: hasGeminiKey(),
      geminiKeyCount: getGeminiKeyCount(),
      geminiModel: resolveGeminiModel(),
      // fallback LLMs
      groqKey: hasGroqKey(),
      groqKeyCount: getGroqKeyCount(),
      groqModel: resolveGroqModel(),
      mistralKey: hasMistralKey(),
      mistralKeyCount: getMistralKeyCount(),
      mistralModel: resolveMistralModel(),
      // OCR / logo / colors
      visionKey: hasVisionKey(),
      // Aliases retained for client compatibility
      model: resolveGeminiModel(),
    }),
    { headers: { 'Content-Type': 'application/json; charset=utf-8' } }
  );
}
