export const prerender = false;
import { listArticles } from '../../../lib/db.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// GET /api/articles/search?q=DECO-251234-000123
// Looks up an article by its numero_article first, then by code_barres.
// Returns the matching article (decorated with `statut`) or null.
//
// We deliberately list+filter in JS rather than adding a dedicated supabase
// query: the inventory is small (a few thousand rows max) and this keeps the
// db.js contract minimal. If volume grows, switch to a server-side .or() query.
export async function GET({ url }) {
  const q = String(url.searchParams.get('q') || '').trim();
  if (!q) return json({ error: 'Paramètre `q` requis' }, 400);

  try {
    const articles = await listArticles();
    const norm = q.toLowerCase();
    // Exact match priority, then prefix on numero_article
    const exact = articles.find(
      (a) => a.numero_article === q || a.code_barres === q
    );
    if (exact) return json({ found: true, article: exact, match: 'exact' });

    const partial = articles.find(
      (a) =>
        (a.numero_article || '').toLowerCase().includes(norm) ||
        (a.code_barres   || '').toLowerCase() === norm
    );
    if (partial) return json({ found: true, article: partial, match: 'partial' });

    return json({ found: false, article: null });
  } catch (err) {
    return json({ error: err.message || 'Erreur de recherche' }, 500);
  }
}
