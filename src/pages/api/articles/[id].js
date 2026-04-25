export const prerender = false;
import { updateArticle, deleteArticle, getArticle } from '../../../lib/db.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export async function GET({ params }) {
  const article = getArticle(params.id);
  if (!article) return json({ error: 'Article introuvable' }, 404);
  return json({ article });
}

export async function PUT({ params, request }) {
  try {
    const data = await request.json();
    const article = updateArticle(params.id, data);
    if (!article) return json({ error: 'Article introuvable' }, 404);
    return json({ article });
  } catch (e) {
    return json({ error: e.message }, 400);
  }
}

export async function DELETE({ params }) {
  const ok = deleteArticle(params.id);
  return json({ ok }, ok ? 200 : 404);
}
