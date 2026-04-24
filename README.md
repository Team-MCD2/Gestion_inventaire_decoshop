# 📦 Inventaire IA — Scanner & Gérer

Application web responsive pour gérer un inventaire d'articles en utilisant :
- 📷 **Photo + IA Google Gemini Vision** → remplissage automatique des champs
- 🏷️ **Scanner de code-barres** → recherche automatique du produit (Open Food Facts + Gemini)
- 💾 **Stockage local** (localStorage) dans le navigateur
- 📊 **Export CSV** compatible Excel

---

## 🚀 Démarrage rapide

### 1. Obtenir une clé API Gemini (gratuite)

1. Aller sur **https://aistudio.google.com/app/apikey**
2. Se connecter avec un compte Google
3. Cliquer sur **Create API Key**
4. Copier la clé (format : `AIzaSy...`)

> Le modèle **Gemini 2.0 Flash** est gratuit jusqu'à 15 requêtes/min et 1 500 requêtes/jour.

### 2. Lancer l'application

#### Option A — Serveur local Python (recommandé)

```powershell
# Depuis le dossier du projet
python -m http.server 8000
```

Puis ouvrir **http://localhost:8000** dans le navigateur.

#### Option B — Serveur local Node.js

```powershell
npx serve .
```

#### Option C — Extension VS Code "Live Server"

Clic droit sur `index.html` → **Open with Live Server**.

> ⚠️ **Ne pas ouvrir directement `index.html` en double-cliquant** : la caméra ne fonctionne qu'en contexte HTTPS ou `localhost`.

### 3. Utiliser l'application

1. Au premier lancement, la fenêtre **Paramètres** s'ouvre : coller la clé API Gemini et enregistrer.
2. Cliquer sur **📷 Photographier l'article** → prendre une photo → l'IA remplit les champs automatiquement.
3. Ou cliquer sur **🏷️ Scanner le code-barres** → la recherche produit se fait automatiquement.
4. Vérifier/compléter manuellement si besoin puis **Enregistrer**.
5. Cliquer sur **Exporter CSV** pour télécharger le fichier.

---

## 📱 Utilisation sur mobile

L'app est 100 % responsive. Pour l'utiliser sur téléphone :

### Méthode 1 — Accès via le réseau local

Sur le PC, trouver l'adresse IP locale :
```powershell
ipconfig
```
Puis sur le téléphone (connecté au même WiFi), ouvrir `http://<IP-PC>:8000`.

> ⚠️ Pour que la caméra fonctionne sur mobile via IP locale, il faut du HTTPS. Deux options :
> - Utiliser **ngrok** : `ngrok http 8000` → donne une URL HTTPS gratuite.
> - Déployer en ligne (voir section déploiement).

### Méthode 2 — Déploiement gratuit en ligne

Le site est 100 % statique, déployable sans backend :
- **Netlify Drop** : glisser-déposer le dossier sur https://app.netlify.com/drop
- **Vercel** : `npx vercel`
- **GitHub Pages** : push dans un repo, activer Pages dans les paramètres

---

## 🗂️ Structure des fichiers

```
filme/
├── index.html      Structure HTML + modals
├── styles.css      Styles personnalisés
├── app.js          Logique principale (caméra, scan, form, table)
├── gemini.js       Intégration Gemini Vision + Open Food Facts
├── storage.js      localStorage + export CSV
└── README.md       Ce fichier
```

---

## 📋 Champs de l'inventaire

| Champ | Remplissage |
|---|---|
| **N° Article** | Auto (ART-00001, ART-00002…) |
| **Photo** | Caméra ou import fichier |
| **Marque** | IA |
| **Modèle** | IA |
| **Description** | IA |
| **Catégorie** | IA |
| **Quantité** | Manuel (défaut 1) |
| **N° Série** | IA (étiquette) ou code-barres |
| **Emplacement** | Manuel |
| **Prix d'achat** | IA (estimation €) |
| **Valeur actuelle** | IA (estimation €) |
| **Fournisseur** | IA |

---

## 🔒 Confidentialité

- La clé API est stockée **uniquement dans votre navigateur** (`localStorage`), jamais envoyée ailleurs que chez Google.
- Les photos sont envoyées à Google Gemini pour analyse (obligatoire pour la reconnaissance).
- Aucun serveur backend : l'app est 100 % client-side.

---

## 🔧 Dépannage

| Problème | Solution |
|---|---|
| « Impossible d'accéder à la caméra » | Vérifier que la page est en `http://localhost` ou `https://`. Autoriser la caméra dans le navigateur. |
| « Erreur Gemini 403 » | Clé API invalide ou quota dépassé. Vérifier sur aistudio.google.com. |
| « Erreur Gemini 400 » | Modèle non disponible dans votre région → choisir `gemini-1.5-flash`. |
| Scanner ne lit pas le code | Nettoyer le code-barres, améliorer l'éclairage, rapprocher. |
| Données perdues après vidage cache | Exporter régulièrement en CSV pour sauvegarde. |

---

## 🛠️ Technologies utilisées

- **HTML5** (getUserMedia pour la caméra)
- **Tailwind CSS** (via CDN, responsive)
- **html5-qrcode** (scan de codes-barres)
- **Google Gemini API** (analyse d'image)
- **Open Food Facts API** (recherche code-barres produits courants)

Aucun framework ni build — un simple serveur statique suffit.
