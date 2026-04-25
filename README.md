# DECO SHOP — Inventaire intelligent

Application web **Astro SSR** (Node adapter) permettant de dresser un inventaire d'articles en les filmant ou en scannant leur code-barres. L'image est analysée par **Google Gemini** (description, prix, catégorie) optionnellement enrichie par **Google Cloud Vision** (OCR EAN, logo de marque, couleur dominante). Les articles sont stockés dans une base **SQLite3** locale.

## Fonctionnalités

- **Filmer l'article** → analyse IA hybride Gemini + Vision (marque, modèle, description, catégorie, couleur, dimension, prix estimés…)
- **Scanner le code-barres** (EAN / UPC / QR via `@zxing/browser`) → recherche IA du produit
- Formulaire éditable avec les champs : Num article, Catégorie, Référence, Couleur, Marque, Modèle, Dimension, Description, Prix d'achat, Prix de vente, **Marge (auto-calculée)**, Quantité initiale, Quantité actuelle, **Statut (En stock / Stock faible / Rupture, auto)**
- Tableau d'inventaire (édition / suppression par ligne, modification manuelle de tous les champs)
- **Export CSV** (compatible Excel, BOM UTF-8, séparateur `;`)
- **Export PDF** (paysage A4, jsPDF + autoTable, badges colorés pour le statut, totaux stock)
- Responsive mobile / desktop
- Persistance **SQLite3** (`data/inventaire.db`) via `better-sqlite3`
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

### 1. Créer une base Turso (SQLite distante, gratuite)

Vercel utilise un système de fichiers en lecture seule, donc impossible d'écrire un `data/inventaire.db` local. La base doit être distante. Turso offre un free tier généreux (9 GB / 1 milliard de reads par mois) et est 100 % compatible SQLite.

```powershell
# Installer le CLI (Windows : via npm ou scoop)
npm i -g @libsql/client  # facultatif, juste pour le client
# OU télécharger turso CLI : https://docs.turso.tech/cli/installation

turso auth login
turso db create decoshop-inventaire
turso db show decoshop-inventaire        # copier l'URL libsql://...
turso db tokens create decoshop-inventaire   # copier le token
```

Sinon : créer la base directement depuis le dashboard web https://app.turso.tech/.

### 2. Pousser le code sur GitHub

```powershell
git add .
git commit -m "switch to Vercel + Turso"
git push
```

### 3. Importer le repo dans Vercel

1. https://vercel.com/new → sélectionne ton repo GitHub
2. Framework Preset : **Astro** (auto-détecté)
3. **Environment Variables** (Settings → Environment Variables) :
   ```
   TURSO_DATABASE_URL  = libsql://decoshop-inventaire-xxx.turso.io
   TURSO_AUTH_TOKEN    = eyJhbGciOiJFZERTQSI...
   GEMINI_API_KEY      = AIzaSy... (ta clé Gemini)
   GEMINI_MODEL        = gemini-2.5-flash
   GOOGLE_VISION_API_KEY = AIzaSy... (optionnel)
   ```
4. **Deploy**.

Le déploiement prend 1–2 minutes. La première requête peut être lente (cold start + init schéma) ; les suivantes sont instantanées.

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
│   ├── db.js                   # @libsql/client : schéma + CRUD + statut/marge (local file ou Turso distant)
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
data/
└── inventaire.db               # Base SQLite3 (créée au lancement, gitignorée)
```

## Schéma SQLite

Table `articles` :

| Colonne              | Type    | Notes                                         |
|----------------------|---------|-----------------------------------------------|
| `id`                 | TEXT PK | UUID v4                                       |
| `num_article`        | TEXT    | Unique, auto-généré (`ART-0001`, `ART-0002`…) |
| `categorie`          | TEXT    |                                               |
| `marque`             | TEXT    |                                               |
| `modele`             | TEXT    |                                               |
| `description`        | TEXT    |                                               |
| `prix_achat`         | REAL    |                                               |
| `prix_vente`         | REAL    |                                               |
| `reference`          | TEXT    | Code EAN / SKU                                |
| `couleur`            | TEXT    |                                               |
| `dimension`          | TEXT    |                                               |
| `quantite_initiale`  | INTEGER |                                               |
| `quantite_actuelle`  | INTEGER |                                               |
| `seuil_stock_faible` | INTEGER | Défaut : 5                                    |
| `photo`              | TEXT    | data URL base64                               |
| `created_at`         | INTEGER | Timestamp ms                                  |
| `updated_at`         | INTEGER | Timestamp ms                                  |

Champs calculés (non stockés, ajoutés par l'API) :

- `marge` = `prix_vente - prix_achat`
- `statut` ∈ { `en_stock` | `stock_faible` | `rupture` } selon `quantite_actuelle` vs `seuil_stock_faible`

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
