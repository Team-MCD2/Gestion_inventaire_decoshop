// Supabase Postgres data layer.
// Replaces the previous libsql/Turso implementation. The exported API
// (listArticles, getArticle, nextNumArticle, createArticle, updateArticle,
// deleteArticle, clearAllArticles, computeStatut) is unchanged so the API
// routes (src/pages/api/...) and the client need no modification.
//
// We always run server-side (Astro SSR / Vercel functions) and use the
// SERVICE_ROLE key which bypasses RLS. Never expose this key to the browser.
//
// Schema lives in supabase/schema.sql — run it once in the Supabase SQL editor.
import { createClient } from '@supabase/supabase-js';

const TABLE = 'articles';
const DEFAULT_SEUIL = Number(readEnv('DEFAULT_SEUIL') || '5');

// --- Env helpers ---------------------------------------------------------
function readEnv(name) {
  try {
    const v = import.meta.env?.[name];
    if (v !== undefined && v !== null && v !== '') return String(v);
  } catch { /* not in import.meta context */ }
  const p = process.env?.[name];
  return p !== undefined && p !== null ? String(p) : '';
}

// --- Client (lazy, singleton) -------------------------------------------
let client = null;

function getDb() {
  if (client) return client;
  const url = readEnv('SUPABASE_URL').trim();
  const key = (
    readEnv('SUPABASE_SERVICE_ROLE_KEY') ||
    readEnv('SUPABASE_SERVICE_ROLE')     ||
    readEnv('SUPABASE_KEY')
  ).trim();
  if (!url || !key) {
    throw new Error(
      'Supabase non configuré. Définissez SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY ' +
      'dans .env (voir .env.example).'
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    db:   { schema: 'public' },
  });
  return client;
}

// --- Computed fields ----------------------------------------------------
export function computeStatut(row) {
  const q = Number(row?.quantite || 0);
  const seuil = Number(row?.seuil_stock_faible || DEFAULT_SEUIL);
  if (q <= 0) return 'rupture';
  if (q <= seuil) return 'stock_faible';
  return 'en_stock';
}

function decorate(row) {
  if (!row) return null;
  return { ...row, statut: computeStatut(row) };
}

// --- Helpers ------------------------------------------------------------
function normalize(data, existing = null) {
  const qInit = data.quantite_initiale !== undefined && data.quantite_initiale !== ''
    ? Number(data.quantite_initiale)
    : (existing?.quantite_initiale ?? 0);
  const q = data.quantite !== undefined && data.quantite !== ''
    ? Number(data.quantite)
    : (existing?.quantite ?? qInit);
  return {
    nom_produit:  String(data.nom_produit  ?? existing?.nom_produit  ?? '').trim(),
    description: String(data.description ?? existing?.description ?? '').trim(),
    marque:      String(data.marque      ?? existing?.marque      ?? '').trim(),
    couleur:     String(data.couleur     ?? existing?.couleur     ?? '').trim(),
    categorie:   String(data.categorie   ?? existing?.categorie   ?? '').trim(),
    prix_vente:  Number(data.prix_vente  ?? existing?.prix_vente  ?? 0) || 0,
    quantite:           Number.isFinite(q) ? q : 0,
    quantite_initiale:  Number.isFinite(qInit) ? qInit : 0,
    seuil_stock_faible: Number(data.seuil_stock_faible ?? existing?.seuil_stock_faible ?? DEFAULT_SEUIL) || DEFAULT_SEUIL,
    photo_url:    String(data.photo_url   ?? existing?.photo_url   ?? ''),
    code_barres:  String(data.code_barres ?? existing?.code_barres ?? '').trim(),
    taille:       String(data.taille      ?? existing?.taille      ?? '').trim(),
  };
}

// Surface a clean, actionable Error from a Supabase response.
function rethrow(prefix, error) {
  if (!error) return;
  const code = error.code || '';
  const msg  = error.message || error.hint || error.details || 'Erreur Supabase';

  // Common, friendly translations
  let friendly = msg;
  if (code === '42P01' || code === 'PGRST205' || /could not find the table/i.test(msg)) {
    friendly =
      "La table 'public.articles' est introuvable dans Supabase. " +
      "Va dans Supabase → SQL Editor → New query, colle le contenu de " +
      "supabase/schema.sql et clique RUN.";
  } else if (code === '42501' || /permission denied/i.test(msg)) {
    friendly =
      "Permission refusée sur la table 'articles'. Vérifie que SUPABASE_SERVICE_ROLE_KEY " +
      "est bien la clé 'service_role' (pas 'anon') et que la RLS n'a pas de policy bloquante.";
  } else if (code === '23505' || /duplicate key/i.test(msg)) {
    friendly = "Un article avec ce numéro existe déjà. Réessayez.";
  } else if (/Invalid API key/i.test(msg) || code === '401' || code === 401) {
    friendly =
      "Clé Supabase invalide. Vérifie SUPABASE_SERVICE_ROLE_KEY dans .env " +
      "(Project Settings → API → service_role).";
  } else if (/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(msg)) {
    friendly =
      "Impossible de joindre Supabase. Vérifie SUPABASE_URL et ta connexion. " +
      "Si le projet vient d'être créé, attends ~1 minute qu'il finisse de démarrer.";
  }

  const err = new Error(`${prefix} : ${friendly}`);
  err.cause = error;
  throw err;
}

// --- Public API ---------------------------------------------------------
export async function listArticles() {
  const db = getDb();
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .order('created_at', { ascending: false });
  if (error) rethrow('Lecture des articles', error);
  return (data || []).map(decorate);
}

export async function getArticle(id) {
  const db = getDb();
  const { data, error } = await db
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) rethrow('Lecture d\'un article', error);
  return decorate(data);
}

// Format : DECO-YYMMDD-NNNNNN — la date sert d'horodatage, le NNNNNN
// est tiré aléatoirement (000000-999999) avec vérification d'unicité côté DB.
// On lit les numéros déjà utilisés (toutes dates confondues) et on retire
// jusqu'à trouver un libre. Au-delà de 50 essais, on élargit à 9 digits.
function randomDigits(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

export async function nextNumArticle() {
  const today = new Date();
  const yy = String(today.getFullYear()).slice(2);
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const prefix = `DECO-${yy}${mm}${dd}-`;

  const db = getDb();
  const { data, error } = await db
    .from(TABLE)
    .select('numero_article');
  if (error) rethrow('Génération du numéro d\'article', error);

  const taken = new Set((data || []).map((r) => String(r.numero_article)));

  // 6 digits → 1 000 000 combinaisons possibles
  for (let i = 0; i < 50; i++) {
    const candidate = prefix + randomDigits(6);
    if (!taken.has(candidate)) return candidate;
  }
  // Fallback rarissime : on saturerait l'espace 6-digits. On élargit à 9.
  for (let i = 0; i < 50; i++) {
    const candidate = prefix + randomDigits(9);
    if (!taken.has(candidate)) return candidate;
  }
  // Ultime recours : timestamp millisecondes
  return prefix + Date.now();
}

export async function createArticle(data) {
  const db = getDb();
  const now = Date.now();
  const id = data.id || (globalThis.crypto?.randomUUID?.() ?? String(now) + Math.random().toString(36).slice(2, 9));
  const numero_article = String(data.numero_article || '').trim() || (await nextNumArticle());
  const fields = normalize(data);

  const { data: inserted, error } = await db
    .from(TABLE)
    .insert({
      id,
      numero_article,
      ...fields,
      created_at: now,
      updated_at: now,
    })
    .select('*')
    .single();
  if (error) rethrow('Création d\'un article', error);
  return decorate(inserted);
}

export async function createArticles(list) {
  const db = getDb();
  const now = Date.now();
  
  // Optimisation : on récupère les numéros existants une seule fois pour tout le lot
  const { data: nums } = await db.from(TABLE).select('numero_article');
  const taken = new Set((nums || []).map(r => String(r.numero_article)));
  
  const today = new Date();
  const yy = String(today.getFullYear()).slice(2);
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const prefix = `DECO-${yy}${mm}${dd}-`;

  const payloads = [];
  for (const item of list) {
    const id = item.id || (globalThis.crypto?.randomUUID?.() ?? String(now) + Math.random().toString(36).slice(2, 9));
    
    let numero_article = String(item.numero_article || '').trim();
    if (!numero_article) {
      let found = false;
      for (let i = 0; i < 100; i++) {
        const candidate = prefix + randomDigits(6);
        if (!taken.has(candidate)) {
          numero_article = candidate;
          taken.add(candidate);
          found = true;
          break;
        }
      }
      if (!found) numero_article = prefix + Date.now() + Math.floor(Math.random()*1000);
    }

    payloads.push({
      id,
      numero_article,
      ...normalize(item),
      created_at: now,
      updated_at: now,
    });
  }

  const { data, error } = await db.from(TABLE).insert(payloads).select('*');
  if (error) rethrow('Importation des articles', error);
  return (data || []).map(decorate);
}

export async function updateArticle(id, data) {
  const db = getDb();
  const { data: existing, error: readErr } = await db
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (readErr) rethrow('Lecture d\'un article', readErr);
  if (!existing) return null;

  const fields = normalize(data, existing);
  const numero_article = String(data.numero_article ?? existing.numero_article).trim() || existing.numero_article;

  const { data: updated, error } = await db
    .from(TABLE)
    .update({
      numero_article,
      ...fields,
      updated_at: Date.now(),
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) rethrow('Mise à jour d\'un article', error);
  return decorate(updated);
}

export async function deleteArticle(id) {
  const db = getDb();
  const { error, count } = await db
    .from(TABLE)
    .delete({ count: 'exact' })
    .eq('id', id);
  if (error) rethrow('Suppression d\'un article', error);
  return Number(count || 0) > 0;
}

export async function clearAllArticles() {
  const db = getDb();
  // Postgres requires a WHERE clause for DELETE via PostgREST. We use a
  // tautology that matches every row regardless of its id.
  const { error, count } = await db
    .from(TABLE)
    .delete({ count: 'exact' })
    .not('id', 'is', null);
  if (error) rethrow('Vidage de la table articles', error);
  return Number(count || 0);
}

// ─────────────────────────────────────────────────────────────────────────
// Statistiques agrégées — version optimisée pour /api/stats.
//
// L'app stockait jusque-là les photos en data URL base64 dans `photo_url`,
// ce qui rend `select *` très lourd (plusieurs MB par article). Ici on fait
// un seul scan de la table avec UNIQUEMENT les colonnes utiles aux agrégats
// (pas de photo) puis, pour le top-N, une seconde requête limitée aux IDs
// concernés pour rapatrier juste leurs photos.
//
// Retour :
//   {
//     total, units, value,                     // KPIs principaux
//     low, out, in_stock,                      // par statut
//     status_counts: { en_stock, stock_faible, rupture },
//     by_category: [{ name, count, qty, value }, ...],   // trié par valeur ↓
//     top:         [{ ...row, photo_url, _value }, ...]  // top N par valeur ↓
//   }
export async function getStatsBundle({ topLimit = 10 } = {}) {
  const db = getDb();

  // 1) Scan léger — on évite photo_url qui peut contenir des data-URLs lourds
  const { data, error } = await db
    .from(TABLE)
    .select('id,numero_article,nom_produit,marque,couleur,categorie,prix_vente,quantite,seuil_stock_faible,created_at,updated_at');
  
  if (error) rethrow('Statistiques', error);
  const rows = data || [];

  let total = 0;
  let units = 0;
  let value = 0;
  let low = 0;
  let out = 0;
  const byCat = new Map();
  const topCandidates = [];

  for (const r of rows) {
    const q = Number(r.quantite || 0);
    const p = Number(r.prix_vente || 0);
    const seuil = Number(r.seuil_stock_faible || DEFAULT_SEUIL);
    const v = p * q;

    total += 1;
    units += q;
    value += v;
    if (q <= 0) out += 1;
    else if (q <= seuil) low += 1;

    const catKey = (r.categorie || '').trim() || 'Sans catégorie';
    const e = byCat.get(catKey) || { count: 0, qty: 0, value: 0 };
    e.count += 1;
    e.qty   += q;
    e.value += v;
    byCat.set(catKey, e);

    if (v > 0) {
      topCandidates.push({
        id: r.id,
        numero_article: r.numero_article,
        nom_produit: r.nom_produit,
        marque: r.marque,
        couleur: r.couleur,
        categorie: r.categorie,
        prix_vente: p,
        quantite: q,
        created_at: r.created_at,
        updated_at: r.updated_at,
        _value: v,
      });
    }
  }

  const in_stock = total - low - out;
  const by_category = [...byCat.entries()]
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.value - a.value);

  // 2) Top N par valeur de stock
  const topLight = topCandidates
    .sort((a, b) => b._value - a._value)
    .slice(0, Math.max(0, topLimit));

  // 3) Récupère uniquement les photos des top N (1 requête ciblée)
  let top = topLight;
  if (topLight.length) {
    try {
      const ids = topLight.map((a) => a.id);
      const { data: photos, error: e2 } = await db
        .from(TABLE)
        .select('id,photo_url')
        .in('id', ids);
      if (!e2 && photos) {
        const m = new Map(photos.map((p) => [p.id, p.photo_url]));
        top = topLight.map((a) => ({ ...a, photo_url: m.get(a.id) || '' }));
      } else if (e2) {
        console.warn('Statistiques (photos) :', e2.message);
      }
    } catch (err) {
      console.warn('Statistiques (photos catch) :', err);
    }
  }

  return {
    total,
    units,
    value,
    low,
    out,
    in_stock,
    status_counts: { en_stock: in_stock, stock_faible: low, rupture: out },
    by_category,
    top,
  };
}

// Recherche d'un article par numéro ou code-barres.
//
// Retourne :
//   { found: true,  match: 'exact'|'partial', article, articles }
//   { found: false, article: null, articles: [] }
//
// Quand la recherche est par code-barres et plusieurs articles partagent
// le même code, `articles` contiendra TOUS ces articles. `article` sera le
// premier (pour la compatibilité ascendante). Si la recherche est par
// numero_article (unique), `articles` aura un seul élément.
export async function findArticleByCode(q) {
  const query = String(q || '').trim();
  if (!query) return { found: false, article: null, articles: [] };

  const db = getDb();

  // 1) Match par numero_article (unique) — priorité absolue
  const { data: byNumData } = await db
    .from(TABLE).select('*').eq('numero_article', query).limit(1);
  if (byNumData?.[0]) {
    const article = decorate(byNumData[0]);
    return { found: true, match: 'exact', article, articles: [article] };
  }

  // 2) Match par code_barres — peut retourner plusieurs articles
  const { data: byBarData } = await db
    .from(TABLE).select('*').eq('code_barres', query);
  if (byBarData && byBarData.length > 0) {
    const articles = byBarData.map(decorate);
    return { found: true, match: 'exact', article: articles[0], articles };
  }

  // 3) Match approximatif (substring sur numero_article, normalisation des
  //    espaces/tirets sur code_barres). On lit uniquement les colonnes
  //    nécessaires (pas de photo_url) pour rester rapide.
  const { data: lite, error } = await db
    .from(TABLE)
    .select('id,numero_article,code_barres');
  if (error) rethrow('Recherche d\'article', error);

  const norm = query.toLowerCase();
  const stripped = norm.replace(/[\s\-]/g, '');

  // Collecter TOUS les matches approximatifs sur code_barres
  const matchedByBar = (lite || []).filter((a) => {
    const cb = (a.code_barres || '').toLowerCase();
    return cb === norm || cb.replace(/[\s\-]/g, '') === stripped;
  });

  if (matchedByBar.length > 0) {
    // Ramener les lignes complètes (avec photo)
    const ids = matchedByBar.map((a) => a.id);
    const { data: full } = await db.from(TABLE).select('*').in('id', ids);
    if (full && full.length > 0) {
      const articles = full.map(decorate);
      return { found: true, match: 'partial', article: articles[0], articles };
    }
  }

  // Match sur numero_article (substring)
  const matchedByNum = (lite || []).find((a) => {
    const n = (a.numero_article || '').toLowerCase();
    return n.includes(norm);
  });
  if (matchedByNum) {
    const article = await getArticle(matchedByNum.id);
    return article
      ? { found: true, match: 'partial', article, articles: [article] }
      : { found: false, article: null, articles: [] };
  }

  return { found: false, article: null, articles: [] };
}

export async function getSyncStatus() {
  const db = getDb();
  const { data, error, count } = await db
    .from(TABLE)
    .select('updated_at', { count: 'exact', head: false })
    .order('updated_at', { ascending: false })
    .limit(1);
  if (error) return { last_updated: 0, count: 0 };
  const lastUpdated = data && data.length > 0 ? data[0].updated_at : 0;
  return { last_updated: lastUpdated, count: count || 0 };
}
