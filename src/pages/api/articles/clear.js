export const prerender = false;
import { clearAllArticles } from '../../../lib/db.js';

export async function POST() {
  try {
    const count = clearAllArticles();
    return new Response(JSON.stringify({ count }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
