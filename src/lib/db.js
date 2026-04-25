// SQLite database layer — @libsql/client
// Uses a local file (file:./data/inventaire.db) for dev, Turso (libsql://...) in production.
// All exported functions are async.
import { createClient } from '@libsql/client';
import path from 'node:path';
import fs from 'node:fs';

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
let initPromise = null;

function resolveDbUrl() {
  const remote = readEnv('TURSO_DATABASE_URL').trim();
  if (remote) return { url: remote, authToken: readEnv('TURSO_AUTH_TOKEN').trim() || undefined };

  // Local fallback — only works when the cwd has a writable `data/` directory
  // (i.e. running locally or on Render/Railway/Fly with a persistent disk).
  // Vercel serverless will hit this branch and crash at write time, which is
  // why we expect TURSO_DATABASE_URL to be set in production.
  const dataDir = path.resolve(process.cwd(), 'data');
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    // Read-only filesystem (e.g. Vercel) — surface a clear error
    throw new Error(
      "Impossible de créer le dossier 'data/' (système de fichiers en lecture seule ?). " +
      "Définissez TURSO_DATABASE_URL pour utiliser une base distante."
    );
  }
  return { url: 'file:' + path.join(dataDir, 'inventaire.db') };
}

async function initSchema(c) {
  // libsql executeMultiple supports multiple statements separated by semicolons
  await c.executeMultiple(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      num_article TEXT NOT NULL UNIQUE,
      categorie TEXT NOT NULL DEFAULT '',
      marque TEXT NOT NULL DEFAULT '',
      modele TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      prix_achat REAL NOT NULL DEFAULT 0,
      prix_vente REAL NOT NULL DEFAULT 0,
      reference TEXT NOT NULL DEFAULT '',
      couleur TEXT NOT NULL DEFAULT '',
      dimension TEXT NOT NULL DEFAULT '',
      quantite_initiale INTEGER NOT NULL DEFAULT 0,
      quantite_actuelle INTEGER NOT NULL DEFAULT 0,
      seuil_stock_faible INTEGER NOT NULL DEFAULT ${DEFAULT_SEUIL},
      photo TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_articles_num ON articles(num_article);
    CREATE INDEX IF NOT EXISTS idx_articles_categorie ON articles(categorie);
    CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at);
  `);
}

async function getDb() {
  if (client) return client;
  if (!initPromise) {
    initPromise = (async () => {
      const { url, authToken } = resolveDbUrl();
      client = createClient({ url, authToken });
      await initSchema(client);
      return client;
    })();
  }
  return initPromise;
}

// --- Computed fields ----------------------------------------------------
export function computeStatut(row) {
  const q = Number(row.quantite_actuelle || 0);
  const seuil = Number(row.seuil_stock_faible || DEFAULT_SEUIL);
  if (q <= 0) return 'rupture';
  if (q <= seuil) return 'stock_faible';
  return 'en_stock';
}

export function computeMarge(row) {
  const achat = Number(row.prix_achat || 0);
  const vente = Number(row.prix_vente || 0);
  return Math.round((vente - achat) * 100) / 100;
}

function decorate(row) {
  if (!row) return null;
  return {
    ...row,
    marge: computeMarge(row),
    statut: computeStatut(row),
  };
}

// libsql returns rows as { columnName: value } already, but values may be BigInt
// for INTEGER columns. Coerce to Number for JSON-serializability.
function coerceRow(row) {
  if (!row) return null;
  const out = {};
  for (const k of Object.keys(row)) {
    const v = row[k];
    out[k] = (typeof v === 'bigint') ? Number(v) : v;
  }
  return out;
}

// --- Public API ---------------------------------------------------------
export async function listArticles() {
  const c = await getDb();
  const result = await c.execute('SELECT * FROM articles ORDER BY created_at DESC');
  return result.rows.map((r) => decorate(coerceRow(r)));
}

export async function getArticle(id) {
  const c = await getDb();
  const result = await c.execute({
    sql: 'SELECT * FROM articles WHERE id = ?',
    args: [id],
  });
  return decorate(coerceRow(result.rows[0] || null));
}

export async function nextNumArticle() {
  const c = await getDb();
  const result = await c.execute('SELECT num_article FROM articles');
  const nums = result.rows
    .map((r) => parseInt(String(r.num_article).replace(/\D/g, ''), 10))
    .filter((n) => !Number.isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `ART-${String(max + 1).padStart(4, '0')}`;
}

function normalize(data, existing = null) {
  const qInit = data.quantite_initiale !== undefined && data.quantite_initiale !== ''
    ? Number(data.quantite_initiale)
    : (existing?.quantite_initiale ?? 0);
  const qAct = data.quantite_actuelle !== undefined && data.quantite_actuelle !== ''
    ? Number(data.quantite_actuelle)
    : (existing?.quantite_actuelle ?? qInit);
  return {
    categorie: String(data.categorie ?? existing?.categorie ?? '').trim(),
    marque: String(data.marque ?? existing?.marque ?? '').trim(),
    modele: String(data.modele ?? existing?.modele ?? '').trim(),
    description: String(data.description ?? existing?.description ?? '').trim(),
    prix_achat: Number(data.prix_achat ?? existing?.prix_achat ?? 0) || 0,
    prix_vente: Number(data.prix_vente ?? existing?.prix_vente ?? 0) || 0,
    reference: String(data.reference ?? existing?.reference ?? '').trim(),
    couleur: String(data.couleur ?? existing?.couleur ?? '').trim(),
    dimension: String(data.dimension ?? existing?.dimension ?? '').trim(),
    quantite_initiale: Number.isFinite(qInit) ? qInit : 0,
    quantite_actuelle: Number.isFinite(qAct) ? qAct : 0,
    seuil_stock_faible: Number(data.seuil_stock_faible ?? existing?.seuil_stock_faible ?? DEFAULT_SEUIL) || DEFAULT_SEUIL,
    photo: String(data.photo ?? existing?.photo ?? ''),
  };
}

export async function createArticle(data) {
  const c = await getDb();
  const now = Date.now();
  const id = data.id || (globalThis.crypto?.randomUUID?.() ?? String(now) + Math.random().toString(36).slice(2, 9));
  const num_article = String(data.num_article || '').trim() || (await nextNumArticle());
  const fields = normalize(data);
  await c.execute({
    sql: `
      INSERT INTO articles (
        id, num_article, categorie, marque, modele, description,
        prix_achat, prix_vente, reference, couleur, dimension,
        quantite_initiale, quantite_actuelle, seuil_stock_faible,
        photo, created_at, updated_at
      ) VALUES (
        :id, :num_article, :categorie, :marque, :modele, :description,
        :prix_achat, :prix_vente, :reference, :couleur, :dimension,
        :quantite_initiale, :quantite_actuelle, :seuil_stock_faible,
        :photo, :created_at, :updated_at
      )
    `,
    args: {
      id,
      num_article,
      ...fields,
      created_at: now,
      updated_at: now,
    },
  });
  return getArticle(id);
}

export async function updateArticle(id, data) {
  const c = await getDb();
  const existingRes = await c.execute({
    sql: 'SELECT * FROM articles WHERE id = ?',
    args: [id],
  });
  const existing = coerceRow(existingRes.rows[0] || null);
  if (!existing) return null;
  const fields = normalize(data, existing);
  const num_article = String(data.num_article ?? existing.num_article).trim() || existing.num_article;
  await c.execute({
    sql: `
      UPDATE articles SET
        num_article = :num_article,
        categorie = :categorie,
        marque = :marque,
        modele = :modele,
        description = :description,
        prix_achat = :prix_achat,
        prix_vente = :prix_vente,
        reference = :reference,
        couleur = :couleur,
        dimension = :dimension,
        quantite_initiale = :quantite_initiale,
        quantite_actuelle = :quantite_actuelle,
        seuil_stock_faible = :seuil_stock_faible,
        photo = :photo,
        updated_at = :updated_at
      WHERE id = :id
    `,
    args: {
      id,
      num_article,
      ...fields,
      updated_at: Date.now(),
    },
  });
  return getArticle(id);
}

export async function deleteArticle(id) {
  const c = await getDb();
  const result = await c.execute({
    sql: 'DELETE FROM articles WHERE id = ?',
    args: [id],
  });
  return Number(result.rowsAffected) > 0;
}

export async function clearAllArticles() {
  const c = await getDb();
  const result = await c.execute('DELETE FROM articles');
  return Number(result.rowsAffected);
}
