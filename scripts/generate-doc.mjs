// scripts/generate-doc.mjs
// Génère le fichier "Documentation_DECO_SHOP.docx" à la racine du projet.
// Usage : npm run doc
//
// Dépendance : `docx` (devDependency)
//   npm install --save-dev docx

import {
  Document, Packer, Paragraph, HeadingLevel, TextRun,
  AlignmentType, PageBreak, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, LevelFormat, convertInchesToTwip,
} from 'docx';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const OUTPUT = resolve(__dirname, '..', 'Documentation_DECO_SHOP.docx');

// ─── Helpers ──────────────────────────────────────────────────────────────
const C = {
  primary:  '4F46E5', // indigo-600
  dark:     '0F172A', // slate-900
  text:     '334155', // slate-700
  muted:    '64748B', // slate-500
  accent:   '7C3AED', // violet-600
  success:  '059669', // emerald-600
  warning:  'D97706', // amber-600
  danger:   'DC2626', // red-600
  bgLight:  'F1F5F9', // slate-100
  bgRow:    'F8FAFC', // slate-50
  border:   'E2E8F0', // slate-200
};

const FONT = 'Calibri';

function h1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 360, after: 180 },
    children: [
      new TextRun({ text, bold: true, size: 36, color: C.primary, font: FONT }),
    ],
  });
}

function h2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 280, after: 140 },
    children: [
      new TextRun({ text, bold: true, size: 28, color: C.dark, font: FONT }),
    ],
  });
}

function h3(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_3,
    spacing: { before: 220, after: 100 },
    children: [
      new TextRun({ text, bold: true, size: 24, color: C.accent, font: FONT }),
    ],
  });
}

function p(text, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 320 },
    children: [
      new TextRun({
        text,
        size: 22,
        color: opts.color || C.text,
        font: FONT,
        bold: !!opts.bold,
        italics: !!opts.italics,
      }),
    ],
    alignment: opts.align || AlignmentType.JUSTIFIED,
  });
}

// Paragraphe avec mises en forme mixtes (chunks = [{text, bold?, italics?, color?, code?}])
function pMixed(chunks, opts = {}) {
  return new Paragraph({
    spacing: { after: 120, line: 320 },
    alignment: opts.align || AlignmentType.LEFT,
    children: chunks.map((c) => new TextRun({
      text: c.text,
      size: c.code ? 20 : 22,
      bold: !!c.bold,
      italics: !!c.italics,
      color: c.color || C.text,
      font: c.code ? 'Consolas' : FONT,
      shading: c.code ? { type: ShadingType.SOLID, color: 'auto', fill: C.bgLight } : undefined,
    })),
  });
}

function bullet(text, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 80, line: 300 },
    children: [
      new TextRun({ text, size: 22, color: C.text, font: FONT }),
    ],
  });
}

function bulletMixed(chunks, level = 0) {
  return new Paragraph({
    numbering: { reference: 'bullets', level },
    spacing: { after: 80, line: 300 },
    children: chunks.map((c) => new TextRun({
      text: c.text,
      size: c.code ? 20 : 22,
      bold: !!c.bold,
      italics: !!c.italics,
      color: c.color || C.text,
      font: c.code ? 'Consolas' : FONT,
      shading: c.code ? { type: ShadingType.SOLID, color: 'auto', fill: C.bgLight } : undefined,
    })),
  });
}

function code(text) {
  // Bloc de code simple : encadrement gris clair, police mono, taille réduite
  return new Paragraph({
    spacing: { before: 80, after: 160 },
    border: {
      top:    { style: BorderStyle.SINGLE, size: 6, color: C.border },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: C.border },
      left:   { style: BorderStyle.SINGLE, size: 12, color: C.primary },
      right:  { style: BorderStyle.SINGLE, size: 6, color: C.border },
    },
    shading: { type: ShadingType.SOLID, color: 'auto', fill: C.bgLight },
    children: [
      new TextRun({ text, size: 20, color: C.dark, font: 'Consolas' }),
    ],
  });
}

function spacer(size = 120) {
  return new Paragraph({ spacing: { after: size }, children: [new TextRun({ text: '' })] });
}

// Cellule de tableau formatée
function tCell(text, opts = {}) {
  return new TableCell({
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.header
      ? { type: ShadingType.SOLID, color: 'auto', fill: C.primary }
      : (opts.alt ? { type: ShadingType.SOLID, color: 'auto', fill: C.bgRow } : undefined),
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({
      alignment: opts.align || AlignmentType.LEFT,
      children: [new TextRun({
        text: String(text),
        bold: !!opts.header || !!opts.bold,
        color: opts.header ? 'FFFFFF' : (opts.color || C.text),
        size: opts.header ? 20 : 20,
        font: opts.code ? 'Consolas' : FONT,
      })],
    })],
  });
}

function buildTable(headers, rows, colWidths) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:           { style: BorderStyle.SINGLE, size: 4, color: C.border },
      bottom:        { style: BorderStyle.SINGLE, size: 4, color: C.border },
      left:          { style: BorderStyle.SINGLE, size: 4, color: C.border },
      right:         { style: BorderStyle.SINGLE, size: 4, color: C.border },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: C.border },
      insideVertical:   { style: BorderStyle.SINGLE, size: 2, color: C.border },
    },
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) =>
          tCell(h, { header: true, width: colWidths?.[i], align: AlignmentType.LEFT })
        ),
      }),
      ...rows.map((row, idx) => new TableRow({
        children: row.map((cell, i) => {
          if (cell && typeof cell === 'object' && 'text' in cell) {
            return tCell(cell.text, { ...cell, alt: idx % 2 === 1, width: colWidths?.[i] });
          }
          return tCell(cell, { alt: idx % 2 === 1, width: colWidths?.[i] });
        }),
      })),
    ],
  });
}

// Encadré "info / warning / danger" : un Table 1×1 avec fond coloré
function callout(title, body, kind = 'info') {
  const palette = {
    info:    { bg: 'EEF2FF', border: '6366F1', titleColor: '4338CA' },
    success: { bg: 'ECFDF5', border: '10B981', titleColor: '047857' },
    warning: { bg: 'FFFBEB', border: 'F59E0B', titleColor: 'B45309' },
    danger:  { bg: 'FEF2F2', border: 'EF4444', titleColor: 'B91C1C' },
  }[kind];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 4, color: palette.border },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: palette.border },
      left:   { style: BorderStyle.SINGLE, size: 24, color: palette.border },
      right:  { style: BorderStyle.SINGLE, size: 4, color: palette.border },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'auto' },
      insideVertical:   { style: BorderStyle.NONE, size: 0, color: 'auto' },
    },
    rows: [
      new TableRow({
        children: [new TableCell({
          shading: { type: ShadingType.SOLID, color: 'auto', fill: palette.bg },
          margins: { top: 160, bottom: 160, left: 200, right: 200 },
          children: [
            new Paragraph({
              spacing: { after: 80 },
              children: [new TextRun({ text: title, bold: true, size: 22, color: palette.titleColor, font: FONT })],
            }),
            ...body.map((line) => new Paragraph({
              spacing: { after: 60, line: 300 },
              children: [new TextRun({ text: line, size: 20, color: C.text, font: FONT })],
            })),
          ],
        })],
      }),
    ],
  });
}

// ─── CONTENU DE LA DOCUMENTATION ──────────────────────────────────────────
const children = [];

// === Page de garde ===
children.push(
  new Paragraph({ spacing: { before: 1800, after: 200 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'DECO SHOP', bold: true, size: 64, color: C.primary, font: FONT })],
  }),
  new Paragraph({ spacing: { after: 200 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Système de Gestion d\'Inventaire', bold: true, size: 36, color: C.dark, font: FONT })],
  }),
  new Paragraph({ spacing: { after: 1200 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Documentation fonctionnelle et technique', size: 28, color: C.muted, italics: true, font: FONT })],
  }),
  new Paragraph({ spacing: { after: 80 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: 'Version 1.0', size: 24, color: C.text, font: FONT })],
  }),
  new Paragraph({ spacing: { after: 80 },
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }), size: 22, color: C.muted, font: FONT })],
  }),
  new Paragraph({ children: [new PageBreak()] }),
);

// === Sommaire (textuel) ===
children.push(
  h1('Sommaire'),
  p('Ce document décrit le fonctionnement complet du site web de gestion d\'inventaire DECO SHOP, page par page, ainsi que toutes les intégrations techniques sous-jacentes (intelligence artificielle, base de données, API).'),
  spacer(),
  bullet('1. Vue d\'ensemble du système'),
  bullet('2. Architecture technique'),
  bullet('3. La base de données Supabase'),
  bullet('4. Pages du site web'),
  bullet('Page d\'accueil', 1),
  bullet('Inventaire', 1),
  bullet('Ajouter un article', 1),
  bullet('Scanner / Recherche', 1),
  bullet('Statistiques', 1),
  bullet('5. L\'analyse par intelligence artificielle'),
  bullet('Analyse photo (vision IA)', 1),
  bullet('Recherche par code-barres', 1),
  bullet('Chaînes de fallback multi-providers', 1),
  bullet('6. API et endpoints internes'),
  bullet('7. Configuration et variables d\'environnement'),
  bullet('8. Workflow utilisateur recommandé'),
  bullet('9. Maintenance et dépannage'),
  new Paragraph({ children: [new PageBreak()] }),
);

// === Section 1 : Vue d'ensemble ===
children.push(
  h1('1. Vue d\'ensemble du système'),
  p('DECO SHOP Inventaire est une application web complète permettant à un magasin de décoration de gérer son catalogue d\'articles. L\'objectif principal est de réduire le travail manuel de saisie en exploitant l\'intelligence artificielle : il suffit de filmer ou photographier un article (ou de scanner son code-barres) pour que les champs du formulaire (catégorie, marque, couleur, description, prix) se remplissent automatiquement.'),

  h2('Fonctionnalités principales'),
  bullet('Ajout d\'un article par photo/film avec analyse IA automatique'),
  bullet('Ajout d\'un article par scan de code-barres (recherche dans bases publiques + IA en fallback)'),
  bullet('Saisie manuelle classique pour les cas particuliers'),
  bullet('Recherche rapide par numéro d\'article ou code-barres pour modifier le stock'),
  bullet('Tableau de bord statistique avec graphiques (Chart.js)'),
  bullet('Export PDF et CSV de l\'inventaire filtré'),
  bullet('Calcul automatique du statut (en stock / stock faible / rupture)'),

  h2('Public visé'),
  p('L\'interface est conçue pour le personnel du magasin : caissiers, gestionnaires de stock et responsables. Aucune compétence technique n\'est requise — tout se fait via une interface web moderne accessible depuis n\'importe quel ordinateur, tablette ou smartphone disposant d\'un navigateur récent et d\'une caméra.'),

  callout('Particularité', [
    'L\'application fonctionne hors-ligne pour la consultation de l\'inventaire grâce au cache localStorage.',
    'En revanche, l\'analyse IA et la sauvegarde nécessitent une connexion internet.',
  ], 'info'),

  new Paragraph({ children: [new PageBreak()] }),
);

// === Section 2 : Architecture ===
children.push(
  h1('2. Architecture technique'),
  p('L\'application repose sur une stack moderne et minimaliste, déployable gratuitement sur Vercel.'),

  h2('Stack technologique'),
  buildTable(
    ['Couche', 'Technologie', 'Rôle'],
    [
      ['Framework', 'Astro 5 (SSR)', 'Génération hybride : pages statiques + endpoints serveur'],
      ['Adapter', '@astrojs/vercel', 'Déploiement serverless sur Vercel'],
      ['Styling', 'Tailwind CSS 4', 'Design system utility-first, responsive'],
      ['Base de données', 'Supabase (Postgres)', 'Stockage des articles + RLS'],
      ['Vision IA', 'Google Gemini, Groq Llama, Mistral Pixtral', 'Analyse de photos, fallback en chaîne'],
      ['OCR / Logos', 'Google Cloud Vision', 'Extraction texte et marque depuis les photos'],
      ['Code-barres scan', 'ZXing (browser)', 'Décodage en direct via la caméra'],
      ['Recherche barcode', 'Open Food Facts, Open Library, UPCitemDB', 'Bases publiques pour identifier un produit'],
      ['Graphiques', 'Chart.js 4', 'Statistiques visuelles'],
      ['Export PDF', 'jsPDF + AutoTable', 'Génération côté client'],
    ],
    [22, 30, 48],
  ),
  spacer(),

  h2('Structure du projet'),
  code(`filme/
├── src/
│   ├── pages/                  # Routes Astro (pages + API)
│   │   ├── index.astro         # Accueil (dashboard navigation)
│   │   ├── inventaire.astro    # Tableau d'inventaire
│   │   ├── ajouter.astro       # Formulaire de création
│   │   ├── scan.astro          # Scan + édition rapide
│   │   ├── statistiques.astro  # Tableau de bord
│   │   └── api/                # Endpoints serveur
│   ├── components/             # Composants UI partagés
│   │   ├── Navbar.astro
│   │   ├── ScannerModal.astro
│   │   └── EditModal.astro
│   ├── layouts/Layout.astro    # Layout global (head, navbar, toast host)
│   ├── lib/                    # Logique serveur
│   │   ├── db.js               # Client Supabase + CRUD articles
│   │   ├── analyze.js          # Orchestrateur Vision + LLM
│   │   ├── gemini.js           # Provider Google Gemini
│   │   ├── groq.js             # Provider Groq (Llama Vision)
│   │   ├── mistral.js          # Provider Mistral (Pixtral)
│   │   ├── vision.js           # Google Cloud Vision (OCR + logos)
│   │   ├── barcode-lookup.js   # Bases publiques de code-barres
│   │   └── llm-vision-prompt.js# Prompt + schéma JSON partagés
│   ├── scripts/                # JavaScript client
│   │   ├── app.js              # Logique principale (formulaire, scanner)
│   │   ├── scan.js             # Logique de la page /scan
│   │   ├── stats.js            # Graphiques de /statistiques
│   │   ├── state.js            # Cache localStorage
│   │   ├── ui.js               # Helpers (toast, escapeHtml, format)
│   │   ├── camera.js           # Accès caméra (getUserMedia)
│   │   ├── barcode.js          # Wrapper ZXing
│   │   ├── csv.js              # Export CSV
│   │   ├── pdf.js              # Export PDF
│   │   └── gemini.js           # Client API IA
│   └── styles/global.css       # Tailwind + custom utilities
├── supabase/schema.sql         # DDL Postgres idempotent
├── astro.config.mjs            # Config Astro (Vercel SSR)
└── package.json`),

  h2('Flux de données'),
  bullet('Le client (navigateur) appelle des endpoints internes /api/...'),
  bullet('Les endpoints exécutent la logique serveur (analyse IA, requêtes DB)'),
  bullet('La base Supabase est interrogée UNIQUEMENT côté serveur, avec la SERVICE_ROLE_KEY'),
  bullet('Aucune clé sensible (Supabase, Gemini, Groq, Mistral) n\'est exposée au client'),

  callout('Sécurité', [
    'Toutes les clés API sont stockées dans .env et ne sont JAMAIS envoyées au navigateur.',
    'Row Level Security activée sur Supabase : aucun accès direct possible avec la clé anonyme.',
    'Les requêtes du client passent obligatoirement par les routes /api/ qui agissent comme proxy sécurisé.',
  ], 'success'),

  new Paragraph({ children: [new PageBreak()] }),
);

// === Section 3 : Supabase ===
children.push(
  h1('3. La base de données Supabase'),
  p('Toutes les données du site sont stockées dans une base PostgreSQL hébergée par Supabase. Une seule table principale est utilisée : public.articles.'),

  h2('Schéma de la table articles'),
  buildTable(
    ['Colonne', 'Type', 'Description'],
    [
      [{ text: 'id', code: true }, 'TEXT (PK)', 'Identifiant interne (généré par l\'app au format DECO-YYMMDD-NNNNNN)'],
      [{ text: 'numero_article', code: true }, 'TEXT (UNIQUE)', 'Numéro unique affiché à l\'utilisateur, identique à id'],
      [{ text: 'description', code: true }, 'TEXT', 'Description courte (1-2 phrases)'],
      [{ text: 'marque', code: true }, 'TEXT', 'Marque du produit'],
      [{ text: 'couleur', code: true }, 'TEXT', 'Couleur principale en français'],
      [{ text: 'categorie', code: true }, 'TEXT', 'Catégorie (Mobilier, Luminaire, Textile…)'],
      [{ text: 'prix_vente', code: true }, 'NUMERIC(12,2)', 'Prix de vente public en EUR'],
      [{ text: 'quantite', code: true }, 'INTEGER', 'Quantité actuelle en stock'],
      [{ text: 'quantite_initiale', code: true }, 'INTEGER', 'Quantité reçue au départ (référence)'],
      [{ text: 'seuil_stock_faible', code: true }, 'INTEGER', 'Seuil en dessous duquel le statut bascule en "stock_faible"'],
      [{ text: 'photo_url', code: true }, 'TEXT', 'Photo en data URL (base64) ou URL externe'],
      [{ text: 'code_barres', code: true }, 'TEXT', 'EAN/UPC/GTIN'],
      [{ text: 'taille', code: true }, 'TEXT', 'Dimensions ou taille (ex: "90x190", "L120 cm")'],
      [{ text: 'created_at', code: true }, 'BIGINT', 'Timestamp UNIX (ms) de création'],
      [{ text: 'updated_at', code: true }, 'BIGINT', 'Timestamp UNIX (ms) de dernière modification'],
    ],
    [25, 22, 53],
  ),
  spacer(),

  h2('Génération des numéros d\'article'),
  p('Au lieu d\'une numérotation séquentielle (DECO-260428-000001, 000002…), chaque nouvel article reçoit un numéro tiré aléatoirement entre 000000 et 999999, avec vérification d\'unicité contre la base. Cela évite :'),
  bullet('De révéler le nombre exact d\'articles aux utilisateurs externes'),
  bullet('Les conflits de concurrence si plusieurs personnes ajoutent en même temps'),
  bullet('Un format perçu comme "ordonné" qui pourrait laisser deviner l\'âge des articles'),

  h2('Calcul automatique du statut'),
  p('La colonne statut n\'existe pas en base : elle est calculée à la volée à chaque lecture, à partir des champs quantite et seuil_stock_faible :'),
  buildTable(
    ['Condition', 'Statut'],
    [
      [{ text: 'quantite === 0', code: true }, { text: 'rupture', bold: true, color: C.danger }],
      [{ text: 'quantite ≤ seuil_stock_faible', code: true }, { text: 'stock_faible', bold: true, color: C.warning }],
      [{ text: 'sinon', code: true }, { text: 'en_stock', bold: true, color: C.success }],
    ],
    [60, 40],
  ),

  h2('Migration et idempotence'),
  p('Le fichier supabase/schema.sql peut être rejoué autant de fois que nécessaire. Il utilise CREATE TABLE IF NOT EXISTS, ALTER TABLE … ADD COLUMN IF NOT EXISTS et DROP COLUMN IF EXISTS pour évoluer en toute sécurité sur une base déjà peuplée, sans perdre de données.'),

  callout('Important — Exécution du schéma', [
    '1. Ouvrir le dashboard Supabase → SQL Editor → New query',
    '2. Coller le contenu de supabase/schema.sql',
    '3. Cliquer sur RUN',
    'À chaque évolution du schéma, rejouer ce script : il ne détruit jamais de données existantes.',
  ], 'warning'),

  new Paragraph({ children: [new PageBreak()] }),
);

// === Section 4 : Pages du site ===
children.push(
  h1('4. Pages du site web'),
  p('Le site est organisé en cinq pages principales accessibles via la barre de navigation supérieure. Chaque page a une responsabilité unique et claire.'),

  // 4.1 Accueil
  h2('4.1 Page d\'accueil — /'),
  p('La page d\'accueil sert de tableau de bord d\'entrée. Elle présente :'),
  bullet('Quatre cartes de navigation menant vers les fonctionnalités principales (Inventaire, Ajouter, Scanner, Statistiques)'),
  bullet('Quatre KPI en bas de page (total articles, unités, valeur totale, stock faible/rupture)'),
  bullet('Pendant le chargement des KPI, des skeletons animés s\'affichent + un mini-spinner dans chaque carte'),
  bullet('En cas d\'erreur de chargement, un bouton "Réessayer" apparaît'),
  
  h3('Comportement détaillé'),
  p('Au chargement de la page :'),
  bullet('Les 4 cartes de navigation sont immédiatement visibles et cliquables'),
  bullet('Les 4 KPI affichent un skeleton animé pulsant'),
  bullet('Un fetch sur /api/articles est lancé en parallèle'),
  bullet('Au succès : les vraies valeurs apparaissent en fade-in (250 ms)'),
  bullet('En cas d\'erreur : tirets gris et bouton Réessayer'),

  // 4.2 Inventaire
  h2('4.2 Page Inventaire — /inventaire'),
  p('La page principale pour consulter et gérer le stock. Elle présente :'),
  bullet('Une barre de recherche (par numéro d\'article, code-barres, marque, description, catégorie, taille, couleur)'),
  bullet('Un filtre par statut (en stock / stock faible / rupture)'),
  bullet('Trois boutons d\'export et d\'action : CSV, PDF, Vider'),
  bullet('Un tableau complet de tous les articles avec actions inline (modifier / supprimer)'),
  bullet('Un compteur d\'articles dans l\'en-tête de la page'),
  
  h3('Colonnes du tableau'),
  p('Le tableau affiche : N° article, Photo, Catégorie, Marque, Couleur, Description, Prix de vente, Code-barres, Taille, Quantité initiale, Quantité actuelle, Statut, Actions.'),

  h3('Action "Vider l\'inventaire"'),
  p('Cette action est destructive et IRRÉVERSIBLE. Pour éviter tout déclenchement accidentel :'),
  bullet('Une modale de confirmation s\'ouvre au clic sur "Vider"'),
  bullet('Elle affiche le nombre exact d\'articles qui vont être supprimés'),
  bullet('Un champ de saisie obligatoire requiert que l\'utilisateur tape exactement "VIDER"'),
  bullet('Le bouton de confirmation reste désactivé tant que la saisie n\'est pas exacte'),
  bullet('Échap, clic en dehors ou Annuler ferment la modale sans rien supprimer'),

  h3('Modification d\'un article'),
  p('Cliquer sur l\'icône crayon ouvre la EditModal qui permet de modifier tous les champs (sauf le numéro d\'article qui est immuable). La modale propose aussi un bouton "Supprimer définitivement" avec confirmation.'),

  // 4.3 Ajouter
  h2('4.3 Page Ajouter — /ajouter'),
  p('Cette page concentre les trois méthodes d\'ajout d\'un nouvel article :'),

  h3('Méthode 1 : Filmer l\'article (carte indigo)'),
  bullet('Ouvre le scanner caméra en mode photo'),
  bullet('L\'utilisateur cadre l\'article et appuie sur "Capturer"'),
  bullet('La photo est envoyée à l\'IA pour analyse'),
  bullet('Les champs du formulaire (catégorie, marque, couleur, description, prix, taille) sont pré-remplis automatiquement'),
  
  h3('Méthode 2 : Importer une photo (carte verte)'),
  bullet('Ouvre le sélecteur de fichier du système'),
  bullet('Le fichier image est lu et passé à l\'IA — même chaîne d\'analyse que la capture caméra'),

  h3('Méthode 3 : Scanner le code-barres (carte ambre)'),
  bullet('Ouvre le scanner caméra en mode code-barres'),
  bullet('ZXing décode le code en direct (EAN, UPC, GTIN, QR)'),
  bullet('Une fois le code détecté, recherche d\'abord dans les bases publiques (Open Food Facts, etc.)'),
  bullet('Si rien trouvé : fallback vers la chaîne IA (Gemini → Groq → Mistral)'),
  bullet('Le formulaire est pré-rempli avec les données identifiées'),

  h3('Bouton scan dans le champ code-barres'),
  p('Le champ "Code-barres" du formulaire dispose d\'un petit bouton-icône (à droite, dans l\'input). Il est utile dans le scénario suivant : l\'utilisateur a déjà filmé l\'article, le formulaire est pré-rempli, mais le code-barres n\'a pas été détecté sur la photo. Au lieu de tout recommencer, il peut :'),
  bullet('Soit taper directement le code-barres au clavier (saisie manuelle)'),
  bullet('Soit cliquer sur l\'icône du champ pour scanner uniquement le code-barres'),
  p('Dans ce mode "fill-only", le scanner ne remplace QUE le champ code_barres et n\'effectue AUCUN appel à l\'API. Les autres champs déjà remplis sont préservés.'),

  h3('Saisie manuelle classique'),
  p('Tous les champs du formulaire restent éditables. L\'IA ne fait que pré-remplir : l\'utilisateur peut toujours corriger, compléter ou tout saisir lui-même.'),

  h3('Champs du formulaire'),
  bullet('N° article (généré automatiquement, non modifiable)'),
  bullet('Catégorie (datalist avec valeurs prédéfinies + saisie libre)'),
  bullet('Code-barres (avec bouton scan intégré)'),
  bullet('Marque, Couleur, Taille, Description'),
  bullet('Prix de vente'),
  bullet('Quantité initiale et Quantité actuelle (la 2ème suit la 1ère par défaut)'),
  bullet('Statut (calculé automatiquement, en lecture seule)'),

  // 4.4 Scan
  h2('4.4 Page Scan — /scan'),
  p('Cette page sert à RETROUVER un article déjà enregistré pour le modifier rapidement (typiquement après une vente, pour décrémenter le stock).'),

  h3('Workflow'),
  bullet('L\'utilisateur arrive sur /scan'),
  bullet('Trois moyens de retrouver un article : taper le numéro, taper le code-barres, ou cliquer sur "Scanner"'),
  bullet('Si l\'article est trouvé en base : sa fiche s\'affiche avec un bouton "Modifier" qui ouvre la EditModal'),
  bullet('Si l\'article n\'est PAS trouvé : un dialogue propose explicitement "Voulez-vous l\'ajouter ?"'),
  bullet('Au clic sur Oui : redirection vers /ajouter?code_barres=XXX&from=scan'),
  bullet('Sur /ajouter, le code-barres est automatiquement pré-rempli + un toast guide l\'utilisateur'),

  h3('Cas du code-barres absent'),
  p('Si l\'article n\'a pas de code-barres (étiquette absente, produit volumineux), l\'utilisateur peut chercher par le numéro d\'article ou la description via la page /inventaire à la place.'),

  // 4.5 Statistiques
  h2('4.5 Page Statistiques — /statistiques'),
  p('Tableau de bord visuel résumant l\'état de l\'inventaire. Toutes les données viennent de la même source (/api/articles), donc reflètent l\'état réel à l\'instant T.'),

  h3('Indicateurs clés (KPI)'),
  bullet('Total articles : nombre d\'articles distincts'),
  bullet('Unités en stock : somme des quantités'),
  bullet('Valeur totale : somme des (prix_vente × quantité)'),
  bullet('Alertes : nombre d\'articles en stock_faible et rupture'),

  h3('Graphiques (Chart.js)'),
  bullet('Donut "Répartition par catégorie" : nombre d\'articles par catégorie'),
  bullet('Bar horizontal "Valeur par catégorie" : top 8 des catégories par valeur stockée'),
  bullet('Donut "Statuts" : répartition en stock / stock faible / rupture'),
  bullet('Top 10 "Articles les plus précieux" : barre de progression visuelle classée par valeur unitaire totale'),

  h3('États de chargement'),
  p('La page /statistiques effectue plusieurs calculs lourds. Pour la perception de performance :'),
  bullet('Pill loader violet "Chargement…" en haut de la page pendant le fetch'),
  bullet('Skeletons animés sur les 4 KPI (valeur + sous-titre)'),
  bullet('Overlays bloutés "Chargement…" sur chaque graphique'),
  bullet('Skeleton rows dans la liste Top 10'),
  bullet('Au succès : tout disparaît en fade-in 250 ms'),
  bullet('En cas d\'erreur : "Données indisponibles" + bouton Réessayer dans chaque section'),

  new Paragraph({ children: [new PageBreak()] }),
);

// === Section 5 : Intelligence artificielle ===
children.push(
  h1('5. L\'analyse par intelligence artificielle'),
  p('L\'IA est au cœur de l\'expérience utilisateur : elle transforme une photo ou un code-barres en formulaire pré-rempli. Pour garantir la fiabilité même en cas de panne d\'un service, l\'application utilise une stratégie de fallback en chaîne entre plusieurs fournisseurs.'),

  h2('5.1 Analyse photo (vision)'),
  p('Quand l\'utilisateur prend ou importe une photo, deux analyses sont lancées EN PARALLÈLE :'),

  h3('Analyse Google Cloud Vision (OCR + logos)'),
  bullet('Détection de texte sur l\'image (codes EAN, étiquettes, descriptions)'),
  bullet('Reconnaissance de logos de marque'),
  bullet('Extraction de la couleur dominante via IMAGE_PROPERTIES (mappée en français)'),

  h3('Analyse LLM Vision (chaîne de fallback)'),
  bullet('Provider 1 : Google Gemini 2.5 Flash (rapide, généreux quota gratuit)'),
  bullet('Provider 2 : Groq Llama 3.2 Vision (fallback si Gemini saturé)'),
  bullet('Provider 3 : Mistral Pixtral 12B (fallback final, RPM strict)'),
  p('Chaque provider est appelé seulement si le précédent est épuisé (quota dépassé, clés en cooldown). Les autres erreurs (image rejetée, JSON malformé) provoquent aussi un fallback car elles seraient identiques sur tous les providers.'),

  h3('Fusion des résultats'),
  p('Les deux analyses (Vision + LLM) sont fusionnées intelligemment :'),
  bullet('Marque : le LLM est prioritaire, sauf si Vision détecte un logo avec confiance > 0.7 (qui prend alors le dessus)'),
  bullet('Couleur : LLM prioritaire, Vision sert de fallback si LLM vide'),
  bullet('Code-barres : la valeur la plus longue (la plus complète) gagne'),
  bullet('Description, taille, prix : LLM uniquement'),

  h2('5.2 Analyse par code-barres'),
  p('Le scan d\'un code-barres déclenche une recherche en cascade sur des bases de données publiques avant tout appel IA. Cela évite la consommation de tokens IA pour les produits déjà connus, et donne des résultats plus fiables (les bases publiques contiennent des données vérifiées).'),

  h3('Bases publiques interrogées (dans l\'ordre)'),
  buildTable(
    ['Base', 'Couverture', 'Free'],
    [
      ['Open Food Facts', 'Alimentaire (mondial)', 'Oui'],
      ['Open Beauty Facts', 'Cosmétique', 'Oui'],
      ['Open Products Facts', 'Produits du quotidien', 'Oui'],
      ['Open Pet Food Facts', 'Aliments pour animaux', 'Oui'],
      ['Open Library', 'Livres (ISBN)', 'Oui'],
      ['UPCitemDB', 'Produits américains généraux', 'Oui (limité)'],
    ],
    [40, 45, 15],
  ),
  spacer(),

  h3('Fallback IA si aucune base ne connaît le code'),
  p('Quand aucune base publique ne renvoie de résultat, l\'application demande aux LLM "Connais-tu ce code-barres ?" avec un prompt strict qui leur interdit d\'halluciner :'),
  code(`"Si tu ne reconnais pas avec CERTITUDE le code-barres, réponds avec
des champs vides. NE PAS deviner. NE PAS inventer."`),
  p('Si l\'IA répond, l\'application affiche un toast d\'avertissement explicite : "Suggestion IA — vérifiez avant validation". L\'utilisateur sait qu\'il doit contrôler.'),

  h3('Niveaux de confiance affichés'),
  buildTable(
    ['Confiance', 'Source', 'Toast affiché'],
    [
      [{ text: 'high', bold: true, color: C.success }, 'Base publique connue', 'Vert : "Produit identifié via Open Food Facts (CODE)"'],
      [{ text: 'low', bold: true, color: C.warning }, 'Suggestion IA', 'Orange : "⚠ Suggestion IA — vérifiez avant validation"'],
      [{ text: 'none', bold: true, color: C.muted }, 'Aucune source', 'Bleu : "Code XXX : produit non identifié — complétez manuellement"'],
    ],
    [18, 32, 50],
  ),
  spacer(),

  h2('5.3 Rotation des clés et cooldown'),
  p('Chaque provider IA accepte plusieurs clés API séparées par des virgules dans les variables d\'environnement (GEMINI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY). Le système les utilise en rotation collante (sticky rotation) :'),
  bullet('Une clé est utilisée tant qu\'elle fonctionne'),
  bullet('Si elle renvoie une erreur de quota (429, "rate limit"), elle est mise en cooldown'),
  bullet('La clé suivante prend le relais immédiatement'),
  bullet('Au bout d\'un certain temps (30 min par défaut), la clé en cooldown redevient utilisable'),
  p('Cela permet de bénéficier d\'un quota gratuit cumulé sur plusieurs comptes sans intervention manuelle.'),

  new Paragraph({ children: [new PageBreak()] }),
);

// === Section 6 : API ===
children.push(
  h1('6. API et endpoints internes'),
  p('Toutes les communications client → serveur passent par /api/. Voici la liste exhaustive :'),

  buildTable(
    ['Endpoint', 'Méthode', 'Description'],
    [
      [{ text: '/api/articles', code: true }, 'GET', 'Liste tous les articles (avec statut calculé)'],
      [{ text: '/api/articles', code: true }, 'POST', 'Crée un nouvel article'],
      [{ text: '/api/articles/[id]', code: true }, 'GET', 'Récupère un article par ID'],
      [{ text: '/api/articles/[id]', code: true }, 'PUT', 'Met à jour un article'],
      [{ text: '/api/articles/[id]', code: true }, 'DELETE', 'Supprime un article'],
      [{ text: '/api/articles/clear', code: true }, 'POST', 'Vide tous les articles (action irréversible)'],
      [{ text: '/api/articles/search', code: true }, 'GET', 'Recherche par numero_article ou code_barres'],
      [{ text: '/api/next-num', code: true }, 'GET', 'Génère le prochain N° article (aléatoire unique)'],
      [{ text: '/api/analyze/image', code: true }, 'POST', 'Analyse une photo via Vision + LLM'],
      [{ text: '/api/analyze/barcode', code: true }, 'POST', 'Recherche un code-barres (bases publiques + LLM)'],
      [{ text: '/api/gemini-status', code: true }, 'GET', 'Vérifie l\'état des clés IA configurées'],
    ],
    [38, 12, 50],
  ),
  spacer(),

  h2('Format des réponses'),
  p('Les endpoints renvoient toujours du JSON. Format type pour /api/articles :'),
  code(`{
  "articles": [
    {
      "id": "DECO-260428-742193",
      "numero_article": "DECO-260428-742193",
      "categorie": "Mobilier",
      "marque": "IKEA",
      "couleur": "Chêne clair",
      "description": "Table basse en bois...",
      "code_barres": "7332543123456",
      "prix_vente": 49.99,
      "quantite": 12,
      "quantite_initiale": 20,
      "seuil_stock_faible": 5,
      "statut": "en_stock",
      "photo_url": "data:image/jpeg;base64,...",
      "taille": "L120 x l60 x H45 cm",
      "created_at": 1714298400000,
      "updated_at": 1714298400000
    }
  ]
}`),

  new Paragraph({ children: [new PageBreak()] }),
);

// === Section 7 : Configuration ===
children.push(
  h1('7. Configuration et variables d\'environnement'),
  p('Toutes les clés et identifiants sensibles sont stockés dans un fichier .env (à la racine du projet, jamais commité). Un fichier .env.example documente toutes les variables.'),

  h2('Variables obligatoires'),
  buildTable(
    ['Variable', 'Description', 'Où l\'obtenir'],
    [
      [{ text: 'SUPABASE_URL', code: true }, 'URL du projet Supabase', 'Dashboard Supabase → Settings → API'],
      [{ text: 'SUPABASE_SERVICE_ROLE_KEY', code: true }, 'Clé de service (bypass RLS)', 'Même endroit, à NE JAMAIS exposer côté client'],
      [{ text: 'GEMINI_API_KEY', code: true }, 'Clé Google Gemini (peut contenir plusieurs séparées par virgules)', 'aistudio.google.com'],
    ],
    [35, 40, 25],
  ),
  spacer(),

  h2('Variables optionnelles (fallback IA)'),
  buildTable(
    ['Variable', 'Description'],
    [
      [{ text: 'GROQ_API_KEY', code: true }, 'Clé Groq pour Llama Vision (fallback)'],
      [{ text: 'GROQ_VISION_MODEL', code: true }, 'Modèle vision Groq (défaut : llama-3.2-90b-vision-preview)'],
      [{ text: 'GROQ_TEXT_MODEL', code: true }, 'Modèle texte pour barcode lookup (défaut : llama-3.3-70b-versatile)'],
      [{ text: 'MISTRAL_API_KEY', code: true }, 'Clé Mistral pour Pixtral (fallback final)'],
      [{ text: 'MISTRAL_VISION_MODEL', code: true }, 'Modèle vision Mistral (défaut : pixtral-12b-2409)'],
      [{ text: 'MISTRAL_TEXT_MODEL', code: true }, 'Modèle texte pour barcode lookup (défaut : mistral-small-latest)'],
      [{ text: 'GOOGLE_VISION_API_KEY', code: true }, 'Clé Google Cloud Vision (OCR + logos)'],
    ],
    [35, 65],
  ),
  spacer(),

  callout('Conseil', [
    'Configurer toutes les clés possibles maximise la robustesse : si Gemini sature, Groq prend le relais ; si Groq est down, Mistral prend le relais.',
    'Toutes ces APIs ont un tier gratuit suffisant pour un usage commercial modéré.',
  ], 'success'),

  h2('Workflow de configuration'),
  bullet('1. Copier .env.example vers .env'),
  bullet('2. Renseigner SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY (obligatoire)'),
  bullet('3. Renseigner au moins une clé IA pour activer l\'analyse photo (GEMINI_API_KEY recommandé)'),
  bullet('4. Lancer le script SQL supabase/schema.sql dans le dashboard Supabase'),
  bullet('5. Lancer npm install puis npm run dev'),
  bullet('6. Ouvrir http://localhost:4321'),

  new Paragraph({ children: [new PageBreak()] }),
);

// === Section 8 : Workflow utilisateur ===
children.push(
  h1('8. Workflow utilisateur recommandé'),
  p('Voici les scénarios d\'usage typiques avec les actions à effectuer.'),

  h2('Scénario 1 : Réception d\'un nouvel arrivage'),
  bullet('Aller sur /ajouter'),
  bullet('Cliquer sur "Filmer l\'article" → cadrer l\'article → Capturer'),
  bullet('Vérifier les champs pré-remplis par l\'IA (catégorie, marque, couleur, prix)'),
  bullet('Si le code-barres n\'a pas été détecté : cliquer sur l\'icône scan dans le champ → scanner'),
  bullet('Saisir la quantité reçue dans "Quantité initiale"'),
  bullet('Cliquer sur "Ajouter à l\'inventaire"'),
  bullet('Toast de succès → un nouvel article est créé'),

  h2('Scénario 2 : Vente d\'un article (décrémenter le stock)'),
  bullet('Aller sur /scan'),
  bullet('Cliquer sur "Scanner" → pointer la caméra sur le code-barres du produit'),
  bullet('La fiche de l\'article s\'affiche'),
  bullet('Cliquer sur "Modifier"'),
  bullet('Décrémenter la "Quantité actuelle"'),
  bullet('Le statut passe automatiquement en "stock_faible" ou "rupture" si nécessaire'),
  bullet('Enregistrer'),

  h2('Scénario 3 : Inventaire physique mensuel'),
  bullet('Aller sur /inventaire'),
  bullet('Filtrer par catégorie ou par statut au besoin'),
  bullet('Exporter en PDF pour avoir la liste papier'),
  bullet('Compter physiquement, puis ajuster la quantité de chaque article via /scan ou en double-cliquant dans le tableau'),

  h2('Scénario 4 : Réception d\'un article inconnu (sans étiquette)'),
  bullet('Aller sur /ajouter'),
  bullet('Cliquer sur "Filmer l\'article" pour pré-remplir au mieux via IA'),
  bullet('Compléter manuellement les champs manquants (taille exacte, prix de vente convenu)'),
  bullet('Laisser le champ code-barres vide si vraiment absent'),
  bullet('Sauvegarder'),

  h2('Scénario 5 : Recherche d\'un produit non scannable'),
  bullet('Aller sur /inventaire'),
  bullet('Taper dans la barre de recherche : marque, couleur, ou description'),
  bullet('Le tableau filtre en temps réel'),
  bullet('Cliquer sur l\'icône crayon de la ligne pour modifier'),

  new Paragraph({ children: [new PageBreak()] }),
);

// === Section 9 : Maintenance ===
children.push(
  h1('9. Maintenance et dépannage'),

  h2('Problèmes courants'),

  h3('"Erreur 500 lors de l\'ajout d\'un article"'),
  bullet('Vérifier que SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont bien configurées dans .env'),
  bullet('Vérifier que la table public.articles existe en exécutant supabase/schema.sql'),
  bullet('Consulter les logs Vercel ou la console du serveur Astro'),

  h3('"L\'IA ne renvoie rien / Toast \'Quota dépassé\'"'),
  bullet('Toutes les clés du provider principal sont en cooldown'),
  bullet('Solution : ajouter une 2ème clé (sur un autre compte gratuit) à GEMINI_API_KEY (séparées par virgule)'),
  bullet('Ou configurer GROQ_API_KEY / MISTRAL_API_KEY pour activer le fallback'),

  h3('"Le scanner caméra ne s\'ouvre pas"'),
  bullet('Le navigateur exige HTTPS pour accéder à la caméra (sauf sur localhost)'),
  bullet('Vérifier que l\'utilisateur a accordé la permission caméra'),
  bullet('Sur iOS : Safari uniquement (pas Chrome iOS)'),

  h3('"Les statistiques ne se chargent pas"'),
  bullet('Cliquer sur le bouton "Réessayer" affiché en cas d\'erreur'),
  bullet('Vérifier la connexion Supabase'),
  bullet('Si le problème persiste, ouvrir DevTools → Console → chercher l\'erreur'),

  h2('Commandes utiles'),
  buildTable(
    ['Commande', 'Effet'],
    [
      [{ text: 'npm install', code: true }, 'Installer les dépendances'],
      [{ text: 'npm run dev', code: true }, 'Lancer le serveur de développement (http://localhost:4321)'],
      [{ text: 'npm run build', code: true }, 'Construire la version de production'],
      [{ text: 'npm run preview', code: true }, 'Prévisualiser le build de production'],
      [{ text: 'npx astro sync', code: true }, 'Régénérer les types Astro (en cas d\'erreur tsconfig)'],
      [{ text: 'npm run doc', code: true }, 'Régénérer ce fichier de documentation Word'],
    ],
    [35, 65],
  ),
  spacer(),

  h2('Évolutions futures envisagées'),
  bullet('Synchronisation Shopify : utiliser la même base Supabase pour le site marchand'),
  bullet('Authentification utilisateur (Supabase Auth) avec rôles (admin, employé)'),
  bullet('Historique des modifications de stock (audit log)'),
  bullet('Notifications par email quand un article passe en rupture'),
  bullet('Module ventes : table orders + tableau de bord financier'),
  bullet('Application mobile native (iOS/Android) avec scan optimisé'),

  // === Footer / version ===
  spacer(360),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    border: { top: { style: BorderStyle.SINGLE, size: 4, color: C.border, space: 8 } },
    children: [new TextRun({
      text: 'Documentation générée automatiquement — DECO SHOP Inventaire v1.0',
      size: 18, color: C.muted, italics: true, font: FONT,
    })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({
      text: `Date de génération : ${new Date().toLocaleString('fr-FR')}`,
      size: 18, color: C.muted, italics: true, font: FONT,
    })],
  }),
);

// ─── Document ──────────────────────────────────────────────────────────────
const doc = new Document({
  creator: 'DECO SHOP',
  title: 'Documentation DECO SHOP Inventaire',
  description: 'Documentation fonctionnelle et technique du système de gestion d\'inventaire',
  styles: {
    default: {
      document: {
        run: { font: FONT, size: 22 },
      },
    },
  },
  numbering: {
    config: [
      {
        reference: 'bullets',
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.25), hanging: convertInchesToTwip(0.2) } } } },
          { level: 1, format: LevelFormat.BULLET, text: '◦', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.6), hanging: convertInchesToTwip(0.2) } } } },
          { level: 2, format: LevelFormat.BULLET, text: '▪', alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: convertInchesToTwip(0.95), hanging: convertInchesToTwip(0.2) } } } },
        ],
      },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          margin: { top: 1000, right: 1100, bottom: 1000, left: 1100 },
        },
      },
      children,
    },
  ],
});

const buf = await Packer.toBuffer(doc);
writeFileSync(OUTPUT, buf);
console.log(`✓ Documentation générée : ${OUTPUT}`);
console.log(`  Taille : ${(buf.length / 1024).toFixed(1)} Ko`);
