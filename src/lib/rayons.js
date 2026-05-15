// Marché de Mo' — Taxonomie des rayons.
// Source unique pour : prompts LLM, formulaires, exports, badges UI.
//
// Aligné avec MarcheDeMoV2/PROMPT-MAITRE.md §"Rayons (10)". Toute évolution
// doit être synchronisée avec le site public pour que les slugs restent
// cohérents entre l'inventaire et la vitrine clients.

/**
 * @typedef {Object} Rayon
 * @property {string} slug    URL-safe slug, stocké tel quel en DB (col. `rayon`).
 * @property {string} label   Libellé affiché dans l'UI / les exports.
 * @property {string} short   Libellé court pour les badges (max 14 car.).
 * @property {string[]} keywords  Mots-clés que les LLM/OCR peuvent voir et
 *                                 qui doivent mapper vers ce rayon.
 */

/** @type {Rayon[]} */
export const RAYONS = [
  {
    slug: 'fruits-legumes',
    label: 'Fruits & Légumes',
    short: 'Fruits/Légumes',
    keywords: [
      'banane', 'plantain', 'manioc', 'igname', 'patate douce', 'mangue', 'ananas',
      'tomate', 'oignon', 'piment', 'gombo', 'aubergine', 'avocat',
      'fresh produce', 'fruit', 'vegetable', 'légumes', 'produce',
    ],
  },
  {
    slug: 'boucherie-halal',
    label: 'Boucherie halal',
    short: 'Boucherie',
    keywords: [
      'boeuf', 'veau', 'agneau', 'mouton', 'poulet', 'merguez', 'haché',
      'halal', 'viande', 'volaille', 'meat', 'beef', 'lamb', 'chicken',
    ],
  },
  {
    slug: 'epices-du-monde',
    label: 'Épices du monde',
    short: 'Épices',
    keywords: [
      'curcuma', 'safran', 'paprika', 'cumin', 'gingembre', 'ras el hanout',
      'curry', 'mélange', 'épice', 'spice', 'seasoning',
    ],
  },
  {
    slug: 'saveurs-afrique',
    label: "Saveurs d'Afrique",
    short: 'Afrique',
    keywords: [
      'attiéké', 'fonio', 'mil', 'sorgho', 'fufu', 'gari', 'soumbala',
      'arachide', 'palme', 'kanwa', 'maggi', 'jumbo', 'yamvita', 'maïs',
      'sénégal', 'côte d', 'cameroun', 'mali', 'burkina', 'african',
    ],
  },
  {
    slug: 'saveurs-asie',
    label: "Saveurs d'Asie",
    short: 'Asie',
    keywords: [
      'riz basmati', 'riz jasmin', 'nouilles', 'soja', 'tofu', 'wasabi',
      'sushi', 'nem', 'curry thaï', 'pâte de curry', 'nuoc-mâm', 'kimchi',
      'kikkoman', 'sriracha', 'lait de coco', 'asian', 'japanese', 'thai',
      'chinese', 'korean', 'vietnamese', 'asie',
    ],
  },
  {
    slug: 'saveur-mediterranee',
    label: 'Saveurs méditerranéennes',
    short: 'Méditerranée',
    keywords: [
      'huile d\'olive', 'olive', 'feta', 'taboulé', 'couscous', 'semoule',
      'harissa', 'tahin', 'hommous', 'falafel', 'pita', 'feuille de vigne',
      'maroc', 'tunisie', 'algérie', 'liban', 'grèce', 'mediterranean',
    ],
  },
  {
    slug: 'saveur-sud-amer',
    label: "Saveurs d'Amérique du Sud",
    short: 'Latam',
    keywords: [
      'maïs', 'tortilla', 'haricot noir', 'guacamole', 'salsa', 'chimichurri',
      'jalapeño', 'manioc', 'plantain', 'rhum', 'cachaça', 'feijoada',
      'mexique', 'brésil', 'argentine', 'pérou', 'latam', 'mexican', 'brazilian',
    ],
  },
  {
    slug: 'balkans-turques',
    label: 'Saveurs des Balkans & Turquie',
    short: 'Balkans',
    keywords: [
      'baklava', 'lokoum', 'kebab', 'çay', 'thé', 'yufka', 'beurek', 'pide',
      'ayran', 'tarama', 'ajvar', 'kajmak', 'turc', 'turque', 'turkey',
      'serbe', 'croate', 'bosniaque', 'balkan',
    ],
  },
  {
    slug: 'produits-courants',
    label: 'Produits courants',
    short: 'Courants',
    keywords: [
      'lait', 'beurre', 'oeufs', 'fromage', 'pain', 'pâtes', 'farine', 'sucre',
      'sel', 'huile', 'vinaigre', 'yaourt', 'biscuits', 'céréales',
      'soda', 'jus', 'eau', 'épicerie', 'classic',
    ],
  },
  {
    slug: 'surgeles',
    label: 'Surgelés',
    short: 'Surgelés',
    keywords: [
      'surgelé', 'congelé', 'frozen', 'pizza surgelée', 'frites surgelées',
      'poisson surgelé', 'glace', 'sorbet', 'crème glacée',
    ],
  },
];

// Slug → Rayon (lookup rapide).
export const RAYONS_BY_SLUG = Object.fromEntries(RAYONS.map((r) => [r.slug, r]));

/** Slugs valides (utilisé pour la validation côté API / formulaire). */
export const RAYON_SLUGS = RAYONS.map((r) => r.slug);

/** Liste {slug, label} pour les <datalist> / <select>. */
export const RAYON_OPTIONS = RAYONS.map(({ slug, label }) => ({ slug, label }));

/**
 * Retourne le libellé d'un rayon depuis son slug, ou la chaîne vide.
 * @param {string} slug
 * @returns {string}
 */
export function rayonLabel(slug) {
  return RAYONS_BY_SLUG[slug]?.label ?? '';
}

/**
 * Devine un slug de rayon à partir d'un texte libre (nom de produit, description,
 * categorie OFF…). Retourne '' si rien ne matche au-dessus du seuil de confiance.
 *
 * Algorithme : pour chaque rayon on compte le nombre de keywords présents dans
 * le texte (case-insensitive, substring match). Le rayon avec le plus de hits
 * gagne, à condition d'avoir au moins 1 hit.
 *
 * @param {string} text
 * @returns {string}  slug du rayon ou '' si aucun match
 */
export function guessRayonFromText(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return '';

  let bestSlug = '';
  let bestScore = 0;
  for (const r of RAYONS) {
    let score = 0;
    for (const kw of r.keywords) {
      if (t.includes(kw.toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestSlug = r.slug;
    }
  }
  return bestScore > 0 ? bestSlug : '';
}

// Magasins (enum partagé avec la contrainte DB articles_magasin_enum).
export const MAGASINS = [
  { slug: '',             label: 'Non précisé' },
  { slug: 'portet',       label: 'Portet-sur-Garonne' },
  { slug: 'toulouse-sud', label: 'Toulouse Sud — Cépière' },
  { slug: 'tous',         label: 'Les deux magasins' },
];

export const MAGASIN_SLUGS = MAGASINS.map((m) => m.slug);
