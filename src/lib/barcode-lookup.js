// Public barcode databases — Open Food Facts, Open Beauty Facts, Open Products Facts.
// Free, no API key, community-maintained (~3M+ products). Used INSTEAD of Gemini
// for barcode resolution to avoid LLM hallucination on EAN/UPC lookups.
//
// API docs:
//   - https://wiki.openfoodfacts.org/API
//   - https://world.openbeautyfacts.org/data
//   - https://world.openproductsfacts.org/data

const USER_AGENT = 'DecoShopInventaire/1.0 (https://github.com/decoshop)';
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

// ---------- Map Open*Facts categories to MCD categories ----------
// Most Open*Facts entries are food/cosmetics, which fall into "Autre" for a
// deco store. We only override when we detect deco-relevant tags.
function mapCategoryTags(tags = []) {
  const t = (Array.isArray(tags) ? tags : []).join(' ').toLowerCase();
  if (/furniture|chair|table|sofa|couch|bed|desk|shelf/.test(t)) return 'Mobilier';
  if (/lamp|light|lighting|chandelier|lantern/.test(t)) return 'Luminaire';
  if (/textile|cushion|pillow|blanket|curtain|rug|carpet/.test(t)) return 'Textile';
  if (/wall-decoration|painting|frame|poster|mirror/.test(t)) return 'Décoration murale';
  if (/tableware|dish|plate|cutlery|glassware|mug|cup/.test(t)) return 'Vaisselle';
  if (/appliance|kitchen-appliance|small-appliance/.test(t)) return 'Électroménager';
  if (/garden|outdoor|plant|flower-pot/.test(t)) return 'Jardin';
  if (/storage|box|basket|container/.test(t)) return 'Rangement';
  if (/toy|game|plaything/.test(t)) return 'Jouet';
  if (/electronic|electronics|gadget/.test(t)) return 'Électronique';
  return '';
}

// ---------- Map Open*Facts product to MCD article shape ----------
function mapProduct(p, code, source) {
  // Description: prefer French, fall back to default name
  const name = (p.product_name_fr || p.product_name || '').trim();
  // Brand: take only the first one if multiple are listed
  const brand = (p.brands || '').split(',')[0]?.trim() || '';
  // Quantity / size (e.g. "175 g", "500 ml", "120x60 cm")
  const size = (p.quantity || '').trim();
  // Image: prefer the front image
  const image = (p.image_front_url || p.image_url || '').trim();
  // Categorization
  const categorie = mapCategoryTags(p.categories_tags) || 'Autre';

  return {
    code_barres: code,
    description: name,
    marque: brand,
    modele: '',
    categorie,
    couleur: '',
    ref_couleur: '',
    taille: size,
    taille_canape: '',
    photo_url: image,
    prix_achat: 0,
    prix_vente: 0,
    _source: source,
  };
}

// ---------- Per-database lookups ----------
const FIELDS = 'product_name,product_name_fr,brands,categories_tags,image_url,image_front_url,quantity';

// Each lookup returns { product, rateLimited } so the orchestrator can decide
// whether to negative-cache the result (only if no DB was rate-limited).
async function lookupOne(host, label, source, code) {
  const url = `https://${host}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`;
  const r = await fetchJson(url, label);
  if (!r.ok) return { product: null, rateLimited: r.status === 429 };
  if (r.data?.status !== 1 || !r.data?.product) return { product: null, rateLimited: false };
  // Skip products with empty name — they exist in OFF but are useless to us
  const name = r.data.product.product_name_fr || r.data.product.product_name || '';
  if (!name.trim()) return { product: null, rateLimited: false };
  return { product: mapProduct(r.data.product, code, source), rateLimited: false };
}

const lookupOpenFoodFacts     = (code) => lookupOne('world.openfoodfacts.org',     'OFF',  'openfoodfacts',     code);
const lookupOpenBeautyFacts   = (code) => lookupOne('world.openbeautyfacts.org',   'OBF',  'openbeautyfacts',   code);
const lookupOpenProductsFacts = (code) => lookupOne('world.openproductsfacts.org', 'OPF',  'openproductsfacts', code);

// ---------- Main entry point ----------
// Validates the code, queries all 3 public DBs in parallel, and returns the
// first result that has a usable description. Never invents data.
// Caches positive results for 1h and "genuinely not found" results for 5min.
// Rate-limit (429) responses are NOT cached so a retry on the next scan can
// still find the product.
//
// Returns:
//   { found: true,  result: {...}, source: 'openfoodfacts'|'openbeautyfacts'|'openproductsfacts' }
//   { found: false, reason: 'invalid_checksum'|'not_in_databases'|'rate_limited', code_barres }
export async function lookupBarcode(rawCode) {
  const code = String(rawCode || '').replace(/\s+/g, '').trim();
  if (!validateBarcode(code)) {
    return { found: false, reason: 'invalid_checksum', code_barres: code };
  }

  // Cache hit — return immediately
  const cached = cacheGet(code);
  if (cached) return cached;

  // Query all 3 in parallel — total wall time = the slowest one
  const settled = await Promise.allSettled([
    lookupOpenFoodFacts(code),
    lookupOpenBeautyFacts(code),
    lookupOpenProductsFacts(code),
  ]);
  const outcomes = settled.map((s) => s.status === 'fulfilled' ? s.value : { product: null, rateLimited: false });

  // Priority: OFF → OBF → OPF (preserved by Promise.allSettled order)
  const best = outcomes.find((o) => o.product)?.product;
  if (best) {
    const { _source, ...result } = best;
    const value = { found: true, result, source: _source };
    cacheSet(code, value, CACHE_TTL_MS);
    return value;
  }

  const anyRateLimited = outcomes.some((o) => o.rateLimited);
  if (anyRateLimited) {
    // Don't cache: next request should retry (the rate limit may have lifted)
    return { found: false, reason: 'rate_limited', code_barres: code };
  }

  const value = { found: false, reason: 'not_in_databases', code_barres: code };
  cacheSet(code, value, NEGATIVE_TTL_MS);
  return value;
}
