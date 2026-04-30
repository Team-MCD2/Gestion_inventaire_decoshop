export const prerender = false;

import { getStatsBundle } from '../../lib/db.js';

// GET /api/stats?top=10
//
// Endpoint optimisé pour la page d'accueil et la page /statistiques :
// renvoie les agrégats (KPIs, par catégorie, top N par valeur) en
// téléchargeant uniquement les colonnes utiles côté Supabase. Aucune
// `photo_url` n'est rapatriée pour les agrégats : seules les photos des
// top N sont incluses (via une requête .in() ciblée).
//
// Voir src/lib/db.js#getStatsBundle pour le détail.
export async function GET({ url }) {
  const topRaw = Number(url.searchParams.get('top'));
  const topLimit = Number.isFinite(topRaw) && topRaw >= 0 ? Math.min(topRaw, 50) : 10;

  try {
    const bundle = await getStatsBundle({ topLimit });
    return new Response(JSON.stringify(bundle), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // Cache court côté navigateur : permet une navigation rapide entre
        // / et /statistiques sans relancer la requête. SWR : si le cache
        // est expiré (>30s), on ressert l'ancienne version pendant qu'on
        // refetch en arrière-plan, jusqu'à 60s.
        'Cache-Control': 'private, max-age=30, stale-while-revalidate=60',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
}
