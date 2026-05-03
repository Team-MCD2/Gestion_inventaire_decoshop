-- ════════════════════════════════════════════════════════════════════════════
--  DECO SHOP — Schéma Supabase / PostgreSQL — État actuel (avril 2026)
-- ════════════════════════════════════════════════════════════════════════════
--
--  Ce script reflète l'état COMPLET et ACTUEL du schéma utilisé par
--  l'application (cf. src/lib/db.js). Une seule table métier : public.articles.
--
--  ▸ EXÉCUTION
--    Dashboard Supabase → SQL Editor → New query → coller ce fichier → RUN.
--
--  ▸ IDEMPOTENCE
--    Le script est ENTIÈREMENT idempotent : tu peux le rejouer sur une base
--    vide OU sur une base déjà peuplée. Aucune donnée n'est jamais détruite.
--    Toutes les commandes utilisent IF NOT EXISTS / IF EXISTS.
--
--  ▸ STATUT (en_stock / stock_faible / rupture)
--    Le statut N'EST PAS stocké en base : il est calculé à la lecture par
--    src/lib/db.js (fonction computeStatut) à partir de quantite et
--    seuil_stock_faible. Une vue helper `articles_with_status` est fournie
--    en bas de ce fichier pour le calculer aussi côté SQL si besoin.
--
--  ▸ SÉCURITÉ
--    L'application accède à Supabase UNIQUEMENT côté serveur (routes /api/...)
--    avec la SERVICE_ROLE_KEY (qui bypasse la RLS). Aucune clé sensible n'est
--    exposée au navigateur. La RLS est donc activée en mode "deny all" par
--    défaut afin de bloquer tout accès via la clé publique `anon`.
--
-- ════════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Table principale : public.articles
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists public.articles (
  -- Identifiants
  id                   text           primary key,
  numero_article       text           not null unique,
  nom_produit          text           not null default '',

  -- Champs descriptifs
  description          text           not null default '',
  marque               text           not null default '',
  couleur              text           not null default '',
  categorie            text           not null default '',
  taille               text           not null default '',
  code_barres          text           not null default '',

  -- Photo (data URL base64 ou URL externe)
  photo_url            text           not null default '',

  -- Économie
  prix_vente           numeric(12, 2) not null default 0,

  -- Stock
  quantite             integer        not null default 0,
  quantite_initiale    integer        not null default 0,
  seuil_stock_faible   integer        not null default 5,

  -- Horodatage (timestamp UNIX en millisecondes — généré par l'application)
  created_at           bigint         not null,
  updated_at           bigint         not null
);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Migrations idempotentes (pour bases déjà créées avant un changement)
-- ─────────────────────────────────────────────────────────────────────────────
-- Toutes les migrations utilisent IF NOT EXISTS / IF EXISTS afin de pouvoir
-- être rejouées sur une base à n'importe quel état antérieur.

-- 2.1 Ajouter chaque colonne si elle n'existe pas (résilience aux schémas anciens)
alter table public.articles add column if not exists numero_article     text           not null default '';
alter table public.articles add column if not exists nom_produit        text           not null default '';
alter table public.articles add column if not exists description        text           not null default '';
alter table public.articles add column if not exists marque             text           not null default '';
alter table public.articles add column if not exists couleur            text           not null default '';
alter table public.articles add column if not exists categorie          text           not null default '';
alter table public.articles add column if not exists taille             text           not null default '';
alter table public.articles add column if not exists code_barres        text           not null default '';
alter table public.articles add column if not exists photo_url          text           not null default '';
alter table public.articles add column if not exists prix_vente         numeric(12, 2) not null default 0;
alter table public.articles add column if not exists quantite           integer        not null default 0;
alter table public.articles add column if not exists quantite_initiale  integer        not null default 0;
alter table public.articles add column if not exists seuil_stock_faible integer        not null default 5;

-- 2.2 Supprimer les colonnes obsolètes (l'application ne les utilise plus)
alter table public.articles drop column if exists modele;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Contraintes d'intégrité (CHECK)
-- ─────────────────────────────────────────────────────────────────────────────
-- Empêche les valeurs aberrantes au niveau de la base, en complément des
-- validations applicatives (src/lib/db.js#normalize).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'articles_quantite_positive'
  ) then
    alter table public.articles
      add constraint articles_quantite_positive
      check (quantite >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'articles_quantite_initiale_positive'
  ) then
    alter table public.articles
      add constraint articles_quantite_initiale_positive
      check (quantite_initiale >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'articles_seuil_positive'
  ) then
    alter table public.articles
      add constraint articles_seuil_positive
      check (seuil_stock_faible >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'articles_prix_positive'
  ) then
    alter table public.articles
      add constraint articles_prix_positive
      check (prix_vente >= 0);
  end if;
end $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Index (optimisation des requêtes courantes)
-- ─────────────────────────────────────────────────────────────────────────────
create index if not exists idx_articles_numero       on public.articles (numero_article);
create index if not exists idx_articles_categorie    on public.articles (categorie);
create index if not exists idx_articles_code_barres  on public.articles (code_barres);
create index if not exists idx_articles_created      on public.articles (created_at desc);
create index if not exists idx_articles_marque       on public.articles (marque);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Commentaires sur la table et les colonnes (documentation in-DB)
-- ─────────────────────────────────────────────────────────────────────────────
-- Visibles dans Supabase Studio (Table Editor → colonne info) et via psql \d+.
comment on table  public.articles                    is 'Catalogue des articles du magasin DECO SHOP. Une ligne = un SKU.';
comment on column public.articles.id                 is 'Identifiant interne (UUID ou DECO-YYMMDD-NNNNNN — généré côté app).';
comment on column public.articles.numero_article     is 'Numéro d''article public, format DECO-YYMMDD-NNNNNN (NNNNNN aléatoire).';
comment on column public.articles.nom_produit          is 'Nom du produit / Libellé court (ex: Chaise scandinave).';
comment on column public.articles.description        is 'Description courte (1 à 2 phrases).';
comment on column public.articles.marque             is 'Marque du produit (ex: IKEA, Maisons du Monde…).';
comment on column public.articles.couleur            is 'Couleur principale en français (ex: ''Chêne clair'', ''Bleu marine'').';
comment on column public.articles.categorie          is 'Catégorie : Mobilier, Luminaire, Textile, Décoration murale, Vaisselle, Électroménager, Jardin, Rangement, Jouet, Électronique, Autre.';
comment on column public.articles.taille             is 'Dimensions ou taille (ex: ''90x190'', ''L120 x H75 cm'').';
comment on column public.articles.code_barres        is 'EAN-13 / UPC / GTIN — peut être vide.';
comment on column public.articles.photo_url          is 'Photo : data URL base64 (image/jpeg) ou URL externe.';
comment on column public.articles.prix_vente         is 'Prix de vente public TTC en EUR (numeric 12,2).';
comment on column public.articles.quantite           is 'Quantité actuelle en stock (≥ 0).';
comment on column public.articles.quantite_initiale  is 'Quantité reçue lors de la réception initiale (référence pour audits).';
comment on column public.articles.seuil_stock_faible is 'Seuil sous lequel l''article passe en statut ''stock_faible''. Défaut : 5.';
comment on column public.articles.created_at         is 'Timestamp UNIX en MILLISECONDES (BIGINT) — généré par Date.now() côté Node.';
comment on column public.articles.updated_at         is 'Timestamp UNIX en MILLISECONDES de la dernière modification.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Vue : articles_with_status (statut calculé côté SQL)
-- ─────────────────────────────────────────────────────────────────────────────
-- Utile pour des requêtes ad-hoc dans le SQL Editor sans avoir à reproduire
-- la logique de calcul de l'application. L'app utilise plutôt computeStatut()
-- en JavaScript, mais cette vue est cohérente avec ce calcul.
create or replace view public.articles_with_status as
select
  a.*,
  case
    when a.quantite <= 0                       then 'rupture'
    when a.quantite <= a.seuil_stock_faible    then 'stock_faible'
    else                                            'en_stock'
  end as statut
from public.articles a;

comment on view public.articles_with_status is
  'Vue lecture seule incluant le statut calculé (en_stock / stock_faible / rupture). Utiliser pour les requêtes SQL ad-hoc — l''application elle-même calcule ce champ côté JS dans src/lib/db.js.';


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Sécurité : Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
-- L'application appelle Supabase UNIQUEMENT côté serveur (API routes Astro)
-- avec la SERVICE_ROLE_KEY, qui bypasse automatiquement la RLS. Aucun token
-- n'est jamais exposé au client. On active donc la RLS en mode "deny all"
-- pour bloquer tout accès non autorisé via la clé publique `anon`.
alter table public.articles enable row level security;

-- (Optionnel) Pour ouvrir un jour un dashboard public en lecture seule,
-- décommenter la policy ci-dessous :
-- create policy "articles_read_public"
--   on public.articles
--   for select
--   using (true);


-- ════════════════════════════════════════════════════════════════════════════
--  Fin du schéma. Pour vérifier l'état :
--    select column_name, data_type, is_nullable, column_default
--    from information_schema.columns
--    where table_schema = 'public' and table_name = 'articles'
--    order by ordinal_position;
-- ════════════════════════════════════════════════════════════════════════════
