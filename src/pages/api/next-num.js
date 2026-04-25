export const prerender = false;
import { nextNumArticle } from '../../lib/db.js';

export async function GET() {
  try {
    return new Response(JSON.stringify({ num: await nextNumArticle() }), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
