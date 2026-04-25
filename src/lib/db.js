// SQLite database layer — better-sqlite3
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, 'inventaire.db');
const DEFAULT_SEUIL = 5;

let db = null;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function initSchema(d) {
  d.exec(`
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

export function getDb() {
  if (!db) {
    ensureDir();
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema(db);
  }
  return db;
}

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

export function listArticles() {
  const d = getDb();
  const rows = d.prepare('SELECT * FROM articles ORDER BY created_at DESC').all();
  return rows.map(decorate);
}

export function getArticle(id) {
  const d = getDb();
  const row = d.prepare('SELECT * FROM articles WHERE id = ?').get(id);
  return decorate(row);
}

export function nextNumArticle() {
  const d = getDb();
  const rows = d.prepare('SELECT num_article FROM articles').all();
  const nums = rows
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

export function createArticle(data) {
  const d = getDb();
  const now = Date.now();
  const id = data.id || (globalThis.crypto?.randomUUID?.() ?? String(now) + Math.random().toString(36).slice(2, 9));
  const num_article = String(data.num_article || '').trim() || nextNumArticle();
  const fields = normalize(data);
  d.prepare(`
    INSERT INTO articles (
      id, num_article, categorie, marque, modele, description,
      prix_achat, prix_vente, reference, couleur, dimension,
      quantite_initiale, quantite_actuelle, seuil_stock_faible,
      photo, created_at, updated_at
    ) VALUES (
      @id, @num_article, @categorie, @marque, @modele, @description,
      @prix_achat, @prix_vente, @reference, @couleur, @dimension,
      @quantite_initiale, @quantite_actuelle, @seuil_stock_faible,
      @photo, @created_at, @updated_at
    )
  `).run({
    id,
    num_article,
    ...fields,
    created_at: now,
    updated_at: now,
  });
  return getArticle(id);
}

export function updateArticle(id, data) {
  const d = getDb();
  const existing = d.prepare('SELECT * FROM articles WHERE id = ?').get(id);
  if (!existing) return null;
  const fields = normalize(data, existing);
  const num_article = String(data.num_article ?? existing.num_article).trim() || existing.num_article;
  d.prepare(`
    UPDATE articles SET
      num_article = @num_article,
      categorie = @categorie,
      marque = @marque,
      modele = @modele,
      description = @description,
      prix_achat = @prix_achat,
      prix_vente = @prix_vente,
      reference = @reference,
      couleur = @couleur,
      dimension = @dimension,
      quantite_initiale = @quantite_initiale,
      quantite_actuelle = @quantite_actuelle,
      seuil_stock_faible = @seuil_stock_faible,
      photo = @photo,
      updated_at = @updated_at
    WHERE id = @id
  `).run({
    id,
    num_article,
    ...fields,
    updated_at: Date.now(),
  });
  return getArticle(id);
}

export function deleteArticle(id) {
  const d = getDb();
  const result = d.prepare('DELETE FROM articles WHERE id = ?').run(id);
  return result.changes > 0;
}

export function clearAllArticles() {
  const d = getDb();
  const result = d.prepare('DELETE FROM articles').run();
  return result.changes;
}
