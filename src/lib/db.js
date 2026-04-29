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
const DEFAULT_SEUIL = 5;

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
