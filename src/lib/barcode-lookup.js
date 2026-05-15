// Marche de Mo' — lookup multi-sources pour les codes-barres scannés.
// On interroge les bases publiques en priorité (gratuit, pas de halluc' LLM) :
//   1. Open Food Facts        — alimentaire (~3M produits)  ← source #1 pour un supermarche
//   2. Open Beauty Facts      — cosmétiques
//   3. Open Products Facts    — objets divers
//   4. Open Pet Food Facts    — nourriture pour animaux
//   5. UPCitemDB (free tier)  — catalogue produits US/international
//
// Cas particulier ISBN (codes 978/979) : Open Library en priorité.
//
// Le LLM Gemini/Groq/Mistral n'est appelé qu'en DERNIER RECOURS (cf.
// lib/analyze.js#tryBarcodeLLMs) pour eviter qu'il invente un produit
// plausible.
//
// Docs API :
//   - https://wiki.openfoodfacts.org/API
//   - https://openlibrary.org/dev/docs/api/books
//   - https://www.upcitemdb.com/api/explorer
import { guessRayonFromText } from './rayons.js';

const USER_AGENT = 'MarcheDeMoInventaire/2.0 (https://marchedemo.com)';
const FETCH_TIMEOUT_MS = 4000;
const CACHE_TTL_MS = 60 * 60 * 1000;       // 1h: same code looked up again returns instantly
const NEGATIVE_TTL_MS = 5 * 60 * 1000;     // 5min: don't retry "not found" too aggressively
const CACHE_MAX_ENTRIES = 500;

// Module-level cache — persists across requests inside the same Node instance.
// On Vercel each serverless cold start resets it, but warm instances reuse it.
const cache = new Map(); // code -> { value, expiresAt }

function cacheGet(code) {
  const entry = cache.get(code);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { cache.delete(code); return null; }
  return entry.value;
}
function cacheSet(code, value, ttl) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Drop the oldest entry (Map iteration order = insertion order)
    const first = cache.keys().next().value;
    if (first !== undefined) cache.delete(first);
  }
  cache.set(code, { value, expiresAt: Date.now() + ttl });
}

// ---------- Checksum validation ----------
// Validates EAN-13 / UPC-A / EAN-8 checksum to reject mis-scanned codes.
// Returns true for any plausible barcode (8-14 digits) and verifies the check digit
// for the standard formats. Returns false for codes that look numeric but have a
// wrong checksum.
export function validateBarcode(input) {
  const code = String(input || '').replace(/\s+/g, '').trim();
  if (!/^\d{8,14}$/.test(code)) return false;
  // EAN-8, UPC-A (12), EAN-13 — all use the same modulo-10 checksum algorithm
  if (code.length === 8 || code.length === 12 || code.length === 13) {
    const digits = code.split('').map(Number);
    const check = digits.pop();
    // From the right (excluding check digit), odd positions × 3, even × 1
    const sum = digits
      .reverse()
      .reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
    const expected = (10 - (sum % 10)) % 10;
    return expected === check;
  }
  // ITF-14, GTIN-14, etc. — accept without strict check
  return true;
}

// ---------- HTTP helper with timeout ----------
// Returns { ok: true, data } on success, { ok: false, status, reason } on error.
// We need the status so the caller can distinguish 429 (rate-limited, should
// not be cached as "not found") from 404 (genuine not-found).
async function fetchJson(url, label) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) {
      if (res.status === 429) {
        console.warn(`[barcode] ${label}: rate-limited (429)`);
      } else if (res.status >= 500) {
        console.warn(`[barcode] ${label}: server error ${res.status}`);
      }
      return { ok: false, status: res.status, reason: 'http_error' };
    }
    const data = await res.json();
    return { ok: true, data };
  } catch (e) {
    const reason = e.name === 'AbortError' ? 'timeout' : 'network_error';
    console.warn(`[barcode] ${label}: ${reason} (${e.message})`);
    return { ok: false, status: 0, reason };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- Map Open*Facts categories → Marche de Mo' rayon slug ----------
// Le rayon est determine en deux temps :
//   1. Heuristique fixe pour les rayons "durs" non-grocery (boucherie halal,
//      surgeles, beaute/animal-only → produits-courants).
//   2. Fallback sur guessRayonFromText(rayons.js) avec les tags + catégories
//      qui matche les keywords ethniques (saveurs-afrique, asie, etc.).
function mapCategoryTags(tags = []) {
  const t = (Array.isArray(tags) ? tags : []).join(' ').toLowerCase();

  // Heuristiques explicites (priorité 1)
  if (/halal|hallal/.test(t) && /viande|meat|poulet|boeuf|agneau|lamb|chicken|beef/.test(t)) {
    return 'boucherie-halal';
  }
  if (/frozen|surgel/.test(t)) return 'surgeles';
  if (/fresh.?fruit|fresh.?vegetable|fruits-frais|legumes-frais|produce/.test(t)) {
    return 'fruits-legumes';
  }
  if (/spice|seasoning|epice|herb/.test(t)) return 'epices-du-monde';

  // Fallback : on passe la chaîne complète à guessRayonFromText (lib/rayons.js).
  return guessRayonFromText(t);
}

// ---------- Description builder for Open*Facts products ----------
// Combines product_name + generic_name + quantity + categories + labels into
// a single rich description, dropping duplicates and empty parts.
function buildOpenFactsDescription(p) {
  const name    = (p.product_name_fr   || p.product_name   || '').trim();
  const generic = (p.generic_name_fr   || p.generic_name   || '').trim();
  // Quantity — drop obviously wrong values like "0", "0g", "0 kg"
  const qtyRaw  = (p.quantity || '').trim();
  const qty     = /^0+\s*[a-z]*$/i.test(qtyRaw) ? '' : qtyRaw;
  // Categories — keep the 3 most specific (last), strip foreign-lang prefixes (en:/pt:/...)
  const catStr = (p.categories_fr || p.categories || '').trim();
  const cats   = catStr
    ? catStr.split(',')
        .map((s) => s.trim().replace(/^[a-z]{2}:/i, ''))
        .filter((s) => s && !/^[a-z]{2}-?[a-z]*$/i.test(s)) // skip language codes alone
        .slice(-3)
        .join(', ')
    : '';
  // Packaging hint — collapse newlines and bullet-style components, keep it short
  const rawPack = (p.packaging_text_fr || p.packaging_text || p.packaging || '').trim();
  const pack    = rawPack
    .replace(/\s*\n\s*/g, ', ')        // newlines -> commas
    .replace(/\s+/g, ' ')              // collapse spaces
    .replace(/(?:à recycler|to recycle)/gi, '') // strip recycling boilerplate
    .replace(/\s*,\s*,/g, ',')         // double commas
    .replace(/^,\s*|,\s*$/g, '')       // trim commas
    .slice(0, 80)                      // cap to 80 chars to avoid wall-of-text
    .trim();
  // Useful labels: bio, vegan, fair-trade, etc.
  const labels = (Array.isArray(p.labels_tags) ? p.labels_tags : [])
    .map((t) => String(t).replace(/^[a-z]{2}:/, ''))
    .filter((t) => /bio|organic|fair[-_]?trade|vegan|sans[-_]?gluten|gluten[-_]?free|equitable/i.test(t))
    .slice(0, 3)
    .join(', ');

  const parts = [];
  if (name) parts.push(name);
  // Avoid duplicating generic_name if it's already inside the product name
  if (generic && !name.toLowerCase().includes(generic.toLowerCase())) parts.push(generic);
  if (qty) parts.push(qty);
  if (cats) parts.push(`Catégorie : ${cats}`);
  if (pack) parts.push(`Conditionnement : ${pack}`);
  if (labels) parts.push(`Labels : ${labels}`);
  return parts.join(' — ');
}

// ---------- Map Open*Facts product → article shape (grocery) ----------
function mapProduct(p, code, source) {
  const name      = (p.product_name_fr || p.product_name || '').trim();
  const brand     = (p.brands || '').split(',')[0]?.trim() || '';
  const sizeRaw   = (p.quantity || '').trim();
  const format    = /^0+\s*[a-z]*$/i.test(sizeRaw) ? '' : sizeRaw;
  const image     = (p.image_front_url || p.image_url || '').trim();
  const description = buildOpenFactsDescription(p);

  // On combine les tags + categories + nom + description pour deviner le
  // rayon grocery. Beaucoup d'entrées OFF ont des tags ethniques (saveurs-
  // afrique, balkan, ...) qu'on veut capter.
  const corpus = [
    ...(p.categories_tags || []),
    p.categories_fr, p.categories,
    name, description,
  ].filter(Boolean).join(' ');
  const rayon = mapCategoryTags(p.categories_tags) || guessRayonFromText(corpus);

  return {
    code_barres: code,
    nom_produit: name,
    description,
    marque: brand,
    rayon,
    format,
    photo_url: image,
    prix_vente: 0,
    _source: source,
  };
}

// ---------- Per-database lookups (Open*Facts family) ----------
// All four (OFF / OBF / OPF / OPetFF) share the same API shape, just different hosts.
const OFF_FIELDS = [
  'product_name', 'product_name_fr',
  'generic_name', 'generic_name_fr',
  'brands',
  'categories', 'categories_fr', 'categories_tags',
  'labels_tags',
  'packaging', 'packaging_text', 'packaging_text_fr',
  'quantity',
  'image_url', 'image_front_url',
].join(',');

async function lookupOpenFacts(host, label, source, code) {
  const url = `https://${host}/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`;
  const r = await fetchJson(url, label);
  if (!r.ok) return { product: null, rateLimited: r.status === 429 };
  if (r.data?.status !== 1 || !r.data?.product) return { product: null, rateLimited: false };
  const name = r.data.product.product_name_fr || r.data.product.product_name || '';
  if (!name.trim()) return { product: null, rateLimited: false };
  return { product: mapProduct(r.data.product, code, source), rateLimited: false };
}

const lookupOpenFoodFacts    = (code) => lookupOpenFacts('world.openfoodfacts.org',    'OFF',    'openfoodfacts',    code);
const lookupOpenBeautyFacts  = (code) => lookupOpenFacts('world.openbeautyfacts.org',  'OBF',    'openbeautyfacts',  code);
const lookupOpenProductsFacts= (code) => lookupOpenFacts('world.openproductsfacts.org','OPF',    'openproductsfacts',code);
const lookupOpenPetFoodFacts = (code) => lookupOpenFacts('world.openpetfoodfacts.org', 'OPetFF', 'openpetfoodfacts', code);

// ---------- Open Library (ISBN only) ----------
// Returns rich book metadata: title, authors, publisher, year, pages, cover, subjects.
async function lookupOpenLibrary(code) {
  const url = `https://openlibrary.org/api/books?bibkeys=ISBN:${encodeURIComponent(code)}&format=json&jscmd=data`;
  const r = await fetchJson(url, 'OpenLib');
  if (!r.ok) return { product: null, rateLimited: r.status === 429 };
  const key = `ISBN:${code}`;
  const book = r.data?.[key];
  if (!book || !book.title) return { product: null, rateLimited: false };

  const authors = (book.authors || []).map((a) => a.name).filter(Boolean).join(', ');
  const publisher = (book.publishers || []).map((p) => p.name).filter(Boolean)[0] || '';
  const year = (book.publish_date || '').match(/\d{4}/)?.[0] || '';
  const pages = book.number_of_pages ? `${book.number_of_pages} pages` : '';
  const subjects = (book.subjects || []).map((s) => s.name || s).filter(Boolean).slice(0, 3).join(', ');
  const cover = book.cover?.large || book.cover?.medium || book.cover?.small || '';

  const parts = [book.title];
  if (authors) parts.push(`Auteur : ${authors}`);
  if (year || publisher) parts.push([publisher, year].filter(Boolean).join(', '));
  if (pages) parts.push(pages);
  if (subjects) parts.push(`Sujets : ${subjects}`);

  return {
    product: {
      code_barres: code,
      nom_produit: book.title,
      description: parts.join(' — '),
      marque: publisher,
      rayon: 'produits-courants', // les livres ne sont pas un rayon Marche de Mo', on retombe sur courants
      format: pages,
      photo_url: cover,
      prix_vente: 0,
      _source: 'openlibrary',
    },
    rateLimited: false,
  };
}

// ---------- UPCitemDB (free trial tier — ~100 req/day per IP) ----------
// Wide catalog of US/international consumer products with brand, model, dimensions, image.
async function lookupUpcItemDb(code) {
  const url = `https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`;
  const r = await fetchJson(url, 'UPCitemDB');
  if (!r.ok) return { product: null, rateLimited: r.status === 429 };
  const item = r.data?.items?.[0];
  if (!item || !item.title) return { product: null, rateLimited: false };

  const parts = [item.title];
  if (item.description && item.description !== item.title) parts.push(item.description);
  if (item.dimension) parts.push(`Dimensions : ${item.dimension}`);
  if (item.weight)    parts.push(`Poids : ${item.weight}`);
  if (item.category)  parts.push(`Catégorie : ${item.category}`);

  // UPCitemDB est centré US/non-alimentaire — on essaie de matcher un rayon
  // grocery via mapCategoryTags + guess sur title/description, sinon on
  // retombe sur 'produits-courants' (le rayon le plus large).
  const corpus = [item.category, item.title, item.description].filter(Boolean).join(' ');
  const rayon = mapCategoryTags([item.category])
    || guessRayonFromText(corpus)
    || 'produits-courants';

  return {
    product: {
      code_barres: code,
      nom_produit: item.title || '',
      description: parts.join(' — '),
      marque: (item.brand || '').trim(),
      rayon,
      format: (item.size || item.dimension || item.weight || '').trim(),
      photo_url: (item.images || [])[0] || '',
      prix_vente: Number(item.lowest_recorded_price) || 0,
      _source: 'upcitemdb',
    },
    rateLimited: false,
  };
}

// ---------- Main entry point ----------
// Validates the code, queries the relevant public DBs in parallel, returns
// the first usable result. Special-cases ISBN (978/979 prefix) by hitting
// Open Library first. Never invents data.
//
// Returns:
//   { found: true,  result: {...}, source: '<source-name>' }
//   { found: false, reason: 'invalid_checksum'|'not_in_databases'|'rate_limited', code_barres }
function isISBN(code) {
  // EAN-13 books start with 978 (Bookland) or 979 (since 2007)
  return /^(978|979)\d{10}$/.test(code);
}

export async function lookupBarcode(rawCode) {
  const code = String(rawCode || '').replace(/\s+/g, '').trim();
  if (!validateBarcode(code)) {
    return { found: false, reason: 'invalid_checksum', code_barres: code };
  }

  const cached = cacheGet(code);
  if (cached) return cached;

  // For ISBN codes (books), Open Library is by far the most reliable source.
  // We still query OFF as a fallback (OFF sometimes has cookbook entries).
  // For any other code, we query the 4 Open*Facts family DBs + UPCitemDB in parallel.
  const tasks = isISBN(code)
    ? [lookupOpenLibrary(code), lookupOpenFoodFacts(code)]
    : [
        lookupOpenFoodFacts(code),
        lookupOpenBeautyFacts(code),
        lookupOpenProductsFacts(code),
        lookupOpenPetFoodFacts(code),
        lookupUpcItemDb(code),
      ];

  const settled = await Promise.allSettled(tasks);
  const outcomes = settled.map((s) => (s.status === 'fulfilled' ? s.value : { product: null, rateLimited: false }));

  // Order in tasks[] = priority order — first non-null wins
  const best = outcomes.find((o) => o.product)?.product;
  if (best) {
    const { _source, ...result } = best;
    const value = { found: true, result, source: _source };
    cacheSet(code, value, CACHE_TTL_MS);
    return value;
  }

  const anyRateLimited = outcomes.some((o) => o.rateLimited);
  if (anyRateLimited) {
    return { found: false, reason: 'rate_limited', code_barres: code };
  }

  const value = { found: false, reason: 'not_in_databases', code_barres: code };
  cacheSet(code, value, NEGATIVE_TTL_MS);
  return value;
}
