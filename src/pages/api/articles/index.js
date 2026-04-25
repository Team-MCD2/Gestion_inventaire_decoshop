export const prerender = false;
import { listArticles, createArticle } from '../../../lib/db.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function GET() {
  try {
    return json({ articles: await listArticles() });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export async function POST({ request }) {
  try {
    const data = await request.json();
    const article = await createArticle(data);
    return json({ article }, 201);
  } catch (e) {
    const msg = /UNIQUE.*num_article/i.test(e.message)
      ? `Le numéro d'article existe déjà.`
      : e.message;
    return json({ error: msg }, 400);
  }
}
