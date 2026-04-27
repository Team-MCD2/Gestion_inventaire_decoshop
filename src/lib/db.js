// SQLite database layer — @libsql/client, MCD-aligned schema
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

  const dataDir = path.resolve(process.cwd(), 'data');
  try {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  } catch (e) {
    throw new Error(
      "Impossible de créer le dossier 'data/' (système de fichiers en lecture seule ?). " +
      "Définissez TURSO_DATABASE_URL pour utiliser une base distante."
    );
  }
  return { url: 'file:' + path.join(dataDir, 'inventaire.db') };
}

// MCD-aligned schema (cf. mcd_mld.md §2 Articles)
//
// NOTE: les colonnes legacy (couleur, ref_couleur, taille_canape, prix_achat,
// shopify_product_id) sont conservées dans le DDL pour ne pas casser les bases
// déjà déployées. L'application ne les lit/écrit plus, elles restent à leur
// valeur par défaut ("" ou 0). Elles peuvent être supprimées lors d'une
// future opération de cleanup manuelle.
async function initSchema(c) {
  await c.executeMultiple(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      numero_article TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      marque TEXT NOT NULL DEFAULT '',
      modele TEXT NOT NULL DEFAULT '',
      categorie TEXT NOT NULL DEFAULT '',
      couleur TEXT NOT NULL DEFAULT '',
      ref_couleur TEXT NOT NULL DEFAULT '',
      prix_achat REAL NOT NULL DEFAULT 0,
      prix_vente REAL NOT NULL DEFAULT 0,
      quantite INTEGER NOT NULL DEFAULT 0,
      quantite_initiale INTEGER NOT NULL DEFAULT 0,
      seuil_stock_faible INTEGER NOT NULL DEFAULT ${DEFAULT_SEUIL},
      photo_url TEXT NOT NULL DEFAULT '',
      code_barres TEXT NOT NULL DEFAULT '',
      taille TEXT NOT NULL DEFAULT '',
      taille_canape TEXT NOT NULL DEFAULT '',
      shopify_product_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_articles_numero ON articles(numero_article);
    CREATE INDEX IF NOT EXISTS idx_articles_categorie ON articles(categorie);
    CREATE INDEX IF NOT EXISTS idx_articles_code_barres ON articles(code_barres);
    CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at);
  `);
}

// Idempotent migration : if the table existed with the old (pre-MCD) schema,
// rename columns and add the new ones in place. Safe no-op for a fresh install.
async function migrateSchema(c) {
  const info = await c.execute('PRAGMA table_info(articles)');
  if (!info.rows.length) return; // brand-new install, initSchema handles it
  const cols = new Set(info.rows.map((r) => r.name));

  const renames = [
    ['num_article', 'numero_article'],
    ['reference', 'code_barres'],
    ['dimension', 'taille'],
    ['quantite_actuelle', 'quantite'],
    ['photo', 'photo_url'],
  ];
  for (const [from, to] of renames) {
    if (cols.has(from) && !cols.has(to)) {
      await c.execute(`ALTER TABLE articles RENAME COLUMN ${from} TO ${to}`);
      cols.delete(from);
      cols.add(to);
    }
  }

  const added = [
    ['ref_couleur',        "TEXT NOT NULL DEFAULT ''"],
    ['taille_canape',      "TEXT NOT NULL DEFAULT ''"],
    ['shopify_product_id', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, type] of added) {
    if (!cols.has(name)) {
      await c.execute(`ALTER TABLE articles ADD COLUMN ${name} ${type}`);
      cols.add(name);
    }
  }
}

async function getDb() {
  if (client) return client;
  if (!initPromise) {
    initPromise = (async () => {
      const { url, authToken } = resolveDbUrl();
      client = createClient({ url, authToken });
      await initSchema(client);
      await migrateSchema(client);
      return client;
    })();
  }
  return initPromise;
}

// --- Computed fields ----------------------------------------------------
export function computeStatut(row) {
  const q = Number(row.quantite || 0);
  const seuil = Number(row.seuil_stock_faible || DEFAULT_SEUIL);
  if (q <= 0) return 'rupture';
  if (q <= seuil) return 'stock_faible';
  return 'en_stock';
}

function decorate(row) {
  if (!row) return null;
  return {
    ...row,
    statut: computeStatut(row),
  };
}

// libsql may return BigInt for INTEGER columns. Coerce to Number for JSON.
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

// MCD format : DECO-YYMMDD-XXXXXX (séquence quotidienne, 6 digits)
export async function nextNumArticle() {
  const today = new Date();
  const yy = String(today.getFullYear()).slice(2);
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const prefix = `DECO-${yy}${mm}${dd}-`;

  const c = await getDb();
  const result = await c.execute({
    sql: 'SELECT numero_article FROM articles WHERE numero_article LIKE ?',
    args: [prefix + '%'],
  });
  const nums = result.rows
    .map((r) => parseInt(String(r.numero_article).slice(prefix.length), 10))
    .filter((n) => !Number.isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return prefix + String(next).padStart(6, '0');
}

function normalize(data, existing = null) {
  const qInit = data.quantite_initiale !== undefined && data.quantite_initiale !== ''
    ? Number(data.quantite_initiale)
    : (existing?.quantite_initiale ?? 0);
  const q = data.quantite !== undefined && data.quantite !== ''
    ? Number(data.quantite)
    : (existing?.quantite ?? qInit);
  return {
    description: String(data.description ?? existing?.description ?? '').trim(),
    marque:      String(data.marque ?? existing?.marque ?? '').trim(),
    modele:      String(data.modele ?? existing?.modele ?? '').trim(),
    categorie:   String(data.categorie ?? existing?.categorie ?? '').trim(),
    prix_vente:  Number(data.prix_vente ?? existing?.prix_vente ?? 0) || 0,
    quantite:           Number.isFinite(q) ? q : 0,
    quantite_initiale:  Number.isFinite(qInit) ? qInit : 0,
    seuil_stock_faible: Number(data.seuil_stock_faible ?? existing?.seuil_stock_faible ?? DEFAULT_SEUIL) || DEFAULT_SEUIL,
    photo_url:    String(data.photo_url ?? existing?.photo_url ?? ''),
    code_barres:  String(data.code_barres ?? existing?.code_barres ?? '').trim(),
    taille:       String(data.taille ?? existing?.taille ?? '').trim(),
  };
}

export async function createArticle(data) {
  const c = await getDb();
  const now = Date.now();
  const id = data.id || (globalThis.crypto?.randomUUID?.() ?? String(now) + Math.random().toString(36).slice(2, 9));
  const numero_article = String(data.numero_article || '').trim() || (await nextNumArticle());
  const fields = normalize(data);
  await c.execute({
    sql: `
      INSERT INTO articles (
        id, numero_article, description, marque, modele, categorie,
        prix_vente, quantite, quantite_initiale, seuil_stock_faible,
        photo_url, code_barres, taille,
        created_at, updated_at
      ) VALUES (
        :id, :numero_article, :description, :marque, :modele, :categorie,
        :prix_vente, :quantite, :quantite_initiale, :seuil_stock_faible,
        :photo_url, :code_barres, :taille,
        :created_at, :updated_at
      )
    `,
    args: {
      id,
      numero_article,
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
  const numero_article = String(data.numero_article ?? existing.numero_article).trim() || existing.numero_article;
  await c.execute({
    sql: `
      UPDATE articles SET
        numero_article = :numero_article,
        description = :description,
        marque = :marque,
        modele = :modele,
        categorie = :categorie,
        prix_vente = :prix_vente,
        quantite = :quantite,
        quantite_initiale = :quantite_initiale,
        seuil_stock_faible = :seuil_stock_faible,
        photo_url = :photo_url,
        code_barres = :code_barres,
        taille = :taille,
        updated_at = :updated_at
      WHERE id = :id
    `,
    args: {
      id,
      numero_article,
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
