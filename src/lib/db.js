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
    modele:      String(data.modele      ?? existing?.modele      ?? '').trim(),
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

// Surface a clean Error from a Supabase response — never leak the raw object.
function rethrow(prefix, error) {
  if (!error) return;
  const msg = error.message || error.hint || error.details || 'Erreur Supabase';
  const err = new Error(`${prefix} : ${msg}`);
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

// MCD format : DECO-YYMMDD-XXXXXX (séquence quotidienne, 6 digits)
export async function nextNumArticle() {
  const today = new Date();
  const yy = String(today.getFullYear()).slice(2);
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const prefix = `DECO-${yy}${mm}${dd}-`;

  const db = getDb();
  const { data, error } = await db
    .from(TABLE)
    .select('numero_article')
    .like('numero_article', `${prefix}%`);
  if (error) rethrow('Génération du numéro d\'article', error);

  const nums = (data || [])
    .map((r) => parseInt(String(r.numero_article).slice(prefix.length), 10))
    .filter((n) => !Number.isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return prefix + String(next).padStart(6, '0');
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
