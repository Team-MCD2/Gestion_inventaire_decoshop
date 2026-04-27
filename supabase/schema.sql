-- Supabase / Postgres schema for DECO SHOP inventaire
-- Exécuter ce script UNE FOIS dans le SQL Editor de Supabase
-- (Dashboard → SQL Editor → New query → coller → RUN)
--
-- Le script est IDEMPOTENT : tu peux le rejouer en toute sécurité, il ne
-- détruit aucune donnée. Utile pour appliquer les changements de schéma
-- (ajout / suppression de colonnes) sur une base déjà créée.

-- ─────────────────────────────────────────────────────────────────────────────
-- Création initiale (no-op si la table existe déjà)
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.articles (
  id                   text primary key,
  numero_article       text not null unique,
  description          text not null default '',
  marque               text not null default '',
  couleur              text not null default '',
  categorie            text not null default '',
  prix_vente           numeric(12, 2) not null default 0,
  quantite             integer not null default 0,
  quantite_initiale    integer not null default 0,
  seuil_stock_faible   integer not null default 5,
  photo_url            text not null default '',
  code_barres          text not null default '',
  taille               text not null default '',
  created_at           bigint not null,
  updated_at           bigint not null
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Migrations idempotentes pour bases existantes
-- ─────────────────────────────────────────────────────────────────────────────
-- Ajoute la colonne 'couleur' si elle n'existe pas
alter table public.articles add column if not exists couleur text not null default '';

-- Retire la colonne 'modele' si elle existe (l'application ne l'utilise plus)
alter table public.articles drop column if exists modele;

-- ─────────────────────────────────────────────────────────────────────────────
-- Index
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists idx_articles_numero       on public.articles (numero_article);
create index if not exists idx_articles_categorie    on public.articles (categorie);
create index if not exists idx_articles_code_barres  on public.articles (code_barres);
create index if not exists idx_articles_created      on public.articles (created_at desc);

-- ─────────────────────────────────────────────────────────────────────────────
-- Sécurité : Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
-- L'application appelle Supabase UNIQUEMENT côté serveur (API routes Astro)
-- avec la SERVICE_ROLE_KEY, qui bypasse automatiquement la RLS. Aucun token
-- n'est jamais exposé au client. On peut donc activer la RLS en mode "deny
-- all" pour bloquer tout accès non autorisé via la clé publique anon.
alter table public.articles enable row level security;

-- (Optionnel) Si tu veux laisser une policy lecture publique pour ouvrir un
-- jour un dashboard read-only, décommente :
-- create policy "articles_read_public" on public.articles for select using (true);
