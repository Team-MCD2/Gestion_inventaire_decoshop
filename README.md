# Marché de Mo' — Inventaire intelligent

Application web **Astro SSR** (adaptateur Vercel Node) qui permet aux équipes
des magasins **Marché de Mo' Portet-sur-Garonne** et **Toulouse Sud — Cépière**
de tenir l'inventaire en filmant l'article ou en scannant son code-barres.
La photo est analysée par **Google Gemini** (rayon, marque, format/poids,
description) avec enrichissement optionnel par **Google Cloud Vision** (OCR
EAN, logo de marque, OCR DLC). Les articles sont stockés dans **Supabase
Postgres**.

> Cette application est un **projet autonome**. Elle vit à côté du site
> public `MarcheDeMoV2/` (frontale clients) sans partager ni base de
> données ni authentification. Le tableau de bord admin du site public
> contient simplement un lien qui ouvre cette appli dans un nouvel onglet.

## Le pipeline en 30 secondes

```
        ┌──── Caméra (filmer / importer) ────┐
        │                                    │
        ▼                                    ▼
  ┌──────────┐                       ┌──────────────┐
  │ ZXing    │                       │ Photo data-  │
  │ EAN/UPC  │                       │ URL base64   │
  └────┬─────┘                       └──────┬───────┘
       │ code                                │ image
       ▼                                     ▼
 ┌──────────────────┐               ┌─────────────────────┐
 │ barcode-lookup   │               │  Vision LLM chain   │
 │ Open*Facts → DB  │               │ Gemini → Groq →     │
 │ Open Library →   │ ──── join ──▶ │ Mistral             │
 │ UPCitemDB        │               └──────────┬──────────┘
 └──────────────────┘                          │
                                  ┌────────────┘
                                  ▼
                       ┌────────────────────┐
                       │  Cloud Vision      │
                       │  (OCR + logo)      │
                       └─────────┬──────────┘
                                 ▼
                       ┌────────────────────┐
                       │  /api/articles     │
                       │  (Supabase insert) │
                       └────────────────────┘
```

## Schéma de données (light grocery MVP)

Une seule table métier : `public.articles`. Une ligne = un SKU.

| Colonne              | Type           | Notes                                              |
|----------------------|----------------|----------------------------------------------------|
| `id`                 | text PK        | UUID v4                                            |
| `numero_article`     | text unique    | Auto-généré : `MDM-YYMMDD-NNNNNN`                   |
| `nom_produit`        | text           | Nom court (ex : Banane plantain, Lait UHT 1L)       |
| `description`        | text           | Description courte (1 à 2 phrases)                 |
| `marque`             | text           | Marque visible sur l'emballage                     |
| `rayon`              | text           | Rayon Marché de Mo' : `fruits-legumes`, `boucherie-halal`, `saveurs-asie`… (cf. `src/lib/rayons.js`) |
| `format`             | text           | Format / poids / contenance (ex : `500g`, `1L`, `12 unités`) |
| `code_barres`        | text           | EAN-13 / UPC / GTIN — peut être vide               |
| `dlc`                | date           | Date limite de consommation (DLC), nullable         |
| `magasin`            | text           | `portet` / `toulouse-sud` / `tous`                  |
| `photo_url`          | text           | data URL base64 ou URL externe (Cloudinary)         |
| `prix_vente`         | numeric(12,2)  | Prix TTC en EUR                                    |
| `quantite`           | integer        | Stock courant (≥ 0)                                |
| `quantite_initiale`  | integer        | Reçu en commande (référence pour audits)           |
| `seuil_stock_faible` | integer        | Défaut : 5                                         |
| `created_at`         | bigint         | Timestamp UNIX en millisecondes                    |
| `updated_at`         | bigint         | Timestamp UNIX en millisecondes                    |

Champ calculé (non stocké) :
- `statut` ∈ { `en_stock` | `stock_faible` | `rupture` } selon `quantite` vs `seuil_stock_faible`

> Le full grocery + traçabilité (lot, fournisseur, DLUO, prix d'achat HT,
> zone température) est prévu en v3 — voir `regles_de_gestion.md`.

## Fonctionnalités

- **Filmer l'article** → analyse IA hybride Gemini + Vision (rayon, marque,
  format, description, prix indicatif)
- **Scanner le code-barres** (EAN / UPC / QR via `@zxing/browser`) → recherche
  successive Open Food Facts → Open Beauty Facts → UPCitemDB → fallback IA
- Formulaire éditable : N° article, Nom, Rayon, Format, Code-barres, Marque,
  DLC, Description, Prix de vente, Quantité initiale, Quantité actuelle,
  Magasin, **Statut (En stock / Stock faible / Rupture, auto)**
- Tableau d'inventaire (édition / suppression par ligne)
- **Export CSV** (compatible Excel, BOM UTF-8, séparateur `;`)
- **Export PDF** (paysage A4, jsPDF + autoTable, badges de statut, totaux)
- Responsive mobile / desktop
- Persistance **Supabase Postgres** via `@supabase/supabase-js` (server-side,
  service role)
- Clés API stockées **côté serveur** dans `.env` (proxy `/api/analyze/*`),
  override possible utilisateur dans Settings (localStorage)
- **Pool de clés Gemini** avec rotation automatique sur quota / clé invalide
- **Fallback LLM** : Gemini → Groq Llama Vision → Mistral Pixtral
- Authentification simple par code à 6 chiffres (cookie HttpOnly 24 h)

## Prérequis

- Node.js 18.17+ (ou 20+)
- Une clé API **Google Gemini** gratuite : <https://aistudio.google.com/app/apikey>
- Un projet **Supabase** gratuit : <https://supabase.com/>
- *(Optionnel)* Une clé **Google Cloud Vision API** pour l'enrichissement OCR/logo
- *(Optionnel)* Une clé **Groq** + **Mistral** pour le fallback LLM
- *(Optionnel)* Un compte **Cloudinary** pour stocker les photos hors-DB

## Installation locale

```powershell
npm install
copy .env.example .env
# Éditer .env et coller au minimum :
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY, APP_AUTH_SECRET
npm run dev
```

Le serveur démarre sur <http://localhost:4321>. La première visite ouvre
`/code` ; saisis `APP_ACCESS_CODE` (défaut `110706`) pour entrer.

## Schéma Supabase

Une seule étape, **idempotente** : Dashboard Supabase → **SQL Editor** →
**New query** → coller `supabase/schema.sql` → **RUN**. Le script crée la
table `articles` et ses index si elle n'existe pas, ou l'aligne sur la
version actuelle si elle existe (drop des colonnes obsolètes, add des
nouvelles, sans détruire de données).

## Déploiement Vercel

1. Créer un projet Supabase ; récupérer `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`.
2. SQL Editor → coller `supabase/schema.sql` → RUN.
3. Pousser ce repo sur GitHub.
4. <https://vercel.com/new> → importer le repo → framework `Astro` (auto-détecté).
5. Environment Variables (Production + Preview) :
   ```
   SUPABASE_URL              = https://xxxxxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY = eyJhbGciOiJI...
   GEMINI_API_KEY            = AIzaSy...
   GEMINI_MODEL              = gemini-2.5-flash
   APP_ACCESS_CODE           = 110706 (à changer en production)
   APP_AUTH_SECRET           = 64 hex chars (générer avec openssl rand -hex 32)
   PUBLIC_BRAND_NAME         = Marché de Mo'
   PUBLIC_BRAND_TAGLINE      = Inventaire intelligent
   # Optionnels :
   GOOGLE_VISION_API_KEY     = AIzaSy...
   GROQ_API_KEY              = gsk_...
   MISTRAL_API_KEY           = ...
   PUBLIC_CLOUDINARY_CLOUD_NAME    = ...
   PUBLIC_CLOUDINARY_UPLOAD_PRESET = marchedemo_unsigned
   ```
6. **Deploy**.

## Architecture

```
src/
├── layouts/Layout.astro        # HTML shell + favicon + Filson Pro/Soft (Typekit)
├── components/
│   ├── Navbar.astro            # Top nav + lien retour vers le site public
│   └── ScannerModal.astro      # Modal caméra (filmer / scanner)
├── pages/
│   ├── index.astro             # Tableau de bord
│   ├── ajouter.astro           # Formulaire d'ajout (caméra / scan / manuel)
│   ├── inventaire.astro        # Tableau d'articles + édition inline
│   ├── scan.astro              # Vue scan dédiée
│   ├── codes-barres.astro      # Génération de codes-barres pour étiquettes
│   ├── statistiques.astro      # KPIs + Chart.js
│   ├── code.astro              # Page de saisie du code d'accès
│   └── api/
│       ├── articles/           # CRUD articles
│       ├── analyze/            # Proxy LLM + Vision
│       ├── auth/               # Login + logout
│       ├── stats.js            # Stats agrégées
│       ├── next-num.js         # Génère le prochain N° article
│       └── gemini-status.js    # État des clés Gemini (rotation)
├── lib/
│   ├── db.js                   # Supabase CRUD + statut calculé
│   ├── auth.js                 # Cookies HttpOnly + HMAC + TTL
│   ├── analyze.js              # Orchestrateur LLM Vision + Cloud Vision
│   ├── gemini.js               # Provider Gemini (pool de clés rotatif)
│   ├── groq.js                 # Provider Groq (fallback #1)
│   ├── mistral.js              # Provider Mistral (fallback #2)
│   ├── vision.js               # Cloud Vision (OCR / logo)
│   ├── llm-vision-prompt.js    # SOURCE UNIQUE des prompts + JSON schema
│   ├── rayons.js               # Liste des rayons Marché de Mo' (taxonomie)
│   └── barcode-lookup.js       # Open Food Facts / Open Library / UPCitemDB
├── scripts/
│   ├── app.js                  # Bootstrap + wiring événements
│   ├── state.js                # Client state + fetch API REST
│   ├── camera.js               # getUserMedia + capture frame
│   ├── barcode.js              # ZXing BrowserMultiFormatReader
│   ├── gemini.js               # Appels Gemini (structured JSON)
│   ├── csv.js                  # Export CSV (BOM UTF-8, ;)
│   ├── pdf.js                  # Export PDF (jsPDF + autoTable)
│   ├── codes-barres.js         # Logique de la page codes-barres
│   ├── scan.js                 # Logique de la page scan
│   ├── stats.js                # Logique des statistiques
│   ├── ui.js                   # Toast host + helpers communs
│   └── sound.js                # Beep de feedback scan
├── middleware.js               # Auth gate sur toutes les routes hors /code
├── env.d.ts                    # Types Astro
└── styles/global.css           # Tailwind v4 + tokens vert/creme + Filson
public/
└── favicon.svg                 # Logo Marché de Mo'
supabase/
└── schema.sql                  # DDL Postgres idempotent
```

## Sécurité

- **Service role key Supabase** : utilisée UNIQUEMENT côté serveur (API
  routes Astro). Bypasse la RLS. RLS activée en mode "deny all" pour
  bloquer tout accès via la clé publique anon.
- **Auth cookies** : HttpOnly, SameSite=Lax, signés HMAC-SHA256 avec
  `APP_AUTH_SECRET`. TTL : `APP_SESSION_TTL_HOURS` (défaut 24 h).
- **Clés LLM** : stockées côté serveur, jamais exposées au client. Un
  override per-utilisateur via Settings va en localStorage uniquement
  sur le navigateur de l'utilisateur.
- **CSP** : pas activée explicitement (Vercel ajoute des en-têtes par
  défaut). À durcir en production si besoin.

## Licence

Usage interne **Marché de Mo'**. Code sous responsabilité du client.

## Direction artistique

L'app suit strictement la DA Marché de Mo' (cf. `MarcheDeMoV2/PROMPT-MAITRE.md`) :

- Couleurs : **vert `#1C6B35`** (primaire), **rouge `#8B1919`** (accent
  promo / urgences), **noir `#0F0F0F`** (texte), **blanc `#FFFFFF`** (fonds).
- Typographie : **Filson Pro** (display, titres) + **Filson Soft** (body)
  via Typekit (`https://use.typekit.net/tci0qgy.css`).
- Logos officiels (réutilisés depuis `MarcheDeMoV2/public/logos/`) :
  - `favicon-marchedemo.png` → onglet navigateur + apple-touch-icon
  - `logo-marchedemo-rond-contourgreen.png` → navbar header
  - `logo-marchedemo-rec.png` → footer / écrans larges
- Voix : factuelle, chaleureuse, terrain. Pas de buzzwords corporate.
- **Interdits** : beige / crème / ocre dans la palette, fonts serif élégantes,
  dark mode dominant, container coloré autour du logo, texte ajouté à côté
  du logo.
#   g e s t i o n - i n v e n t a i r e - m a r c h e d e m o  
 