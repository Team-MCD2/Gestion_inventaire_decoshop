# DECO SHOP — Inventaire intelligent

Application web **Astro SSR** (Node adapter) permettant de dresser un inventaire d'articles en les filmant ou en scannant leur code-barres. L'image est analysée par **Google Gemini** (description, prix, catégorie) optionnellement enrichie par **Google Cloud Vision** (OCR EAN, logo de marque). Les articles sont stockés dans une base **Supabase Postgres**.

## Fonctionnalités

- **Filmer l'article** → analyse IA hybride Gemini + Vision (marque, couleur, description, catégorie, dimension, prix estimés…)
- **Scanner le code-barres** (EAN / UPC / QR via `@zxing/browser`) → recherche IA du produit
- Formulaire éditable : N° article, Catégorie, Code-barres, Marque, Couleur, Taille/Dimensions, Description, Prix de vente, Quantité initiale, Quantité actuelle, **Statut (En stock / Stock faible / Rupture, auto)**
- Tableau d'inventaire (édition / suppression par ligne, modification manuelle de tous les champs)
- **Export CSV** (compatible Excel, BOM UTF-8, séparateur `;`)
- **Export PDF** (paysage A4, jsPDF + autoTable, badges colorés pour le statut, totaux stock)
- Responsive mobile / desktop
- Persistance **Supabase Postgres** via `@supabase/supabase-js` (server-side, service role)
- Clés API stockées **côté serveur** dans `.env` (proxy `/api/analyze/*`), avec override possible par utilisateur dans Settings (localStorage)
- Favicon **DECO SHOP**

## Prérequis

- Node.js 18.17+ (ou 20+)
- Une clé API **Google Gemini** gratuite : <https://aistudio.google.com/app/apikey>
- *(Optionnel)* Une clé **Google Cloud Vision API** pour l'enrichissement OCR/logo/couleur (voir section dédiée)

## Installation

```powershell
npm install
copy .env.example .env
# Éditer .env et coller au minimum GEMINI_API_KEY
npm run dev
```

Le serveur démarre sur <http://localhost:4321>. Si la clé est dans `.env`, l'IA est immédiatement active. Sinon ouvrez **Paramètres** (engrenage en haut à droite) et collez-la côté navigateur.

## Configuration Cloud Vision (optionnel)

L'app fonctionne en Gemini-only par défaut. Activer Cloud Vision améliore la précision sur :

| Champ formulaire | Source Vision | Logique |
|---|---|---|
| `marque` | LOGO_DETECTION | Si logo détecté avec confiance ≥ 70 %, écrase Gemini |
| `reference` | TEXT_DETECTION (OCR) | Si un EAN/UPC (8/12/13/14 chiffres) est lu, prioritaire |
| `dimension` | TEXT_DETECTION (OCR) | Regex `L120 x l60 x H75 cm` ou `Ø30 cm` |
| `prix_vente` | TEXT_DETECTION (OCR) | Regex `12,99 €` ou `EUR 12.99` (étiquette de prix) |
| `couleur` | IMAGE_PROPERTIES | Couleur dominante traduite en français (HSL → nom) |
| `categorie` | LABEL_DETECTION | Fallback uniquement si Gemini renvoie vide |

### Étapes de création (5 min)

1. <https://console.cloud.google.com/> → créer un nouveau projet (ex. *decoshop-vision*)
2. **Billing** → lier un compte de facturation
   - **Vision est gratuit jusqu'à 1000 requêtes/mois/feature**, mais Google exige une CB enregistrée
   - Crédit d'essai 300 $ / 90 jours offert pour les nouveaux comptes
3. **APIs & Services** → **Library** → chercher "Cloud Vision API" → **Enable**
4. **APIs & Services** → **Credentials** → **+ Create credentials** → **API key**
5. Cliquer sur la clé créée → **API restrictions** → restreindre à *Cloud Vision API* (recommandé)
6. Coller la clé dans `.env` :
   ```env
   GOOGLE_VISION_API_KEY=AIzaSy...
   ```
7. Redémarrer `npm run dev`

Le badge dans **Settings → Clé Cloud Vision** doit passer au vert ("Clé Cloud Vision serveur active").

## Permissions navigateur

Pour accéder à la caméra, le site doit être servi :
- en `localhost` (cas du `npm run dev`)
- ou en HTTPS

Autorisez l'accès à la caméra lorsque le navigateur le demande. Sur mobile, le site utilise automatiquement la caméra arrière.

## Build production

```powershell
npm run build
```

Le build produit `.vercel/output/` (fonctions serverless + assets statiques) prêt pour Vercel.

## Déploiement sur Vercel

### 1. Créer une base Supabase (Postgres, gratuite)

L'application stocke les articles dans une table Postgres hébergée par Supabase. Free tier : 500 MB de stockage / 2 Go bandwidth / pas de carte bancaire requise.

1. https://supabase.com/ → **Sign up** (GitHub recommandé)
2. **New Project** → nom + mot de passe DB + région proche
3. Une fois le projet créé, **SQL Editor** → **New query** → coller le contenu de `supabase/schema.sql` → **RUN**.
   Cela crée la table `articles` et ses index.
4. **Project Settings → API** :
   - copier **Project URL** → `SUPABASE_URL`
   - copier la clé **service_role** (pas l'anon key !) → `SUPABASE_SERVICE_ROLE_KEY`
   > La clé `service_role` bypass la RLS et reste **uniquement côté serveur**. Ne la commit jamais et ne l'expose jamais au client.

### 2. Pousser le code sur GitHub

```powershell
git add .
git commit -m "migrate database to Supabase"
git push
```

### 3. Importer le repo dans Vercel

1. https://vercel.com/new → sélectionne ton repo GitHub
2. Framework Preset : **Astro** (auto-détecté)
3. **Environment Variables** (Settings → Environment Variables) :
   ```
   SUPABASE_URL              = https://xxxxxxxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY = eyJhbGciOiJI...
   GEMINI_API_KEY            = AIzaSy... (ta clé Gemini)
   GEMINI_MODEL              = gemini-2.5-flash
   GOOGLE_VISION_API_KEY     = AIzaSy... (optionnel)
   ```
4. **Deploy**.

Le déploiement prend 1–2 minutes. La première requête peut être lente (cold start) ; les suivantes sont instantanées.

### 4. Vérifier

Une fois déployé : ouvre ton URL Vercel, ouvre **Paramètres**, le badge "Clé Gemini serveur active" doit être vert.

## Architecture

```
src/
├── layouts/Layout.astro        # HTML shell + favicon + polices
├── pages/
│   ├── index.astro             # Page unique (UI complète)
│   └── api/
│       ├── articles/
│       │   ├── index.js        # GET liste / POST création
│       │   ├── [id].js         # GET / PUT / DELETE par id
│       │   └── clear.js        # POST : supprime tout
│       └── next-num.js         # GET : prochain numéro d'article
├── lib/
│   ├── db.js                   # @supabase/supabase-js : CRUD articles + statut calculé
│   ├── gemini.js               # Proxy Gemini côté serveur (clé .env protégée)
│   ├── vision.js               # Proxy Cloud Vision côté serveur
│   └── analyze.js              # Orchestrateur Gemini + Vision (parallel + fusion)
├── scripts/
│   ├── app.js                  # Bootstrap + wiring événements
│   ├── state.js                # Client state + fetch API REST
│   ├── camera.js               # getUserMedia + capture frame
│   ├── barcode.js              # ZXing BrowserMultiFormatReader
│   ├── gemini.js               # Appels Gemini (structured JSON)
│   ├── csv.js                  # Export CSV (BOM UTF-8, ;)
│   └── pdf.js                  # Export PDF (jsPDF + autoTable)
└── styles/global.css           # Tailwind v4 + animations custom
public/
└── favicon.svg                 # Logo DECO SHOP
supabase/
└── schema.sql                  # DDL Postgres à exécuter dans le SQL Editor
```

## Schéma Postgres (Supabase)

Voir `supabase/schema.sql` pour le DDL complet. Table `articles` :

| Colonne              | Type           | Notes                                              |
|----------------------|----------------|----------------------------------------------------|
| `id`                 | text PK        | UUID v4                                            |
| `numero_article`     | text unique    | Auto-généré (`DECO-YYMMDD-XXXXXX`)                  |
| `categorie`          | text           | Mobilier, Luminaire, Textile…                      |
| `marque`             | text           |                                                    |
| `couleur`            | text           | Couleur principale ("Bleu nuit", "Bois clair"…)     |
| `description`        | text           |                                                    |
| `prix_vente`         | numeric(12,2)  |                                                    |
| `code_barres`        | text           | EAN / UPC / GTIN                                   |
| `taille`             | text           | Dimensions (ex: `L120 x l60 x H75 cm`)             |
| `quantite_initiale`  | integer        |                                                    |
| `quantite`           | integer        | Stock courant                                      |
| `seuil_stock_faible` | integer        | Défaut : 5                                         |
| `photo_url`          | text           | data URL base64 ou URL distante                    |
| `created_at`         | bigint         | Timestamp epoch ms                                 |
| `updated_at`         | bigint         | Timestamp epoch ms                                 |

Champ calculé (non stocké, ajouté par l'API) :

- `statut` ∈ { `en_stock` | `stock_faible` | `rupture` } selon `quantite` vs `seuil_stock_faible`

## Sécurité de la clé API

La clé Gemini est stockée dans le `localStorage` du navigateur. Elle est envoyée directement depuis le navigateur à l'API Google. Pour un usage en production multi-utilisateurs, utilisez plutôt un backend proxy qui garde la clé côté serveur.

## Déploiement production

Le projet produit un serveur Node.js standalone :

```powershell
npm run build
node ./dist/server/entry.mjs
```

Le port peut être changé via la variable d'environnement `PORT` (défaut 4321 en dev, 8080 en prod).

## Licence

Usage interne MICRODIDAC / DECO SHOP.
