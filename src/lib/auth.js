// Petite couche d'authentification "code d'accès" pour DECO SHOP.
//
// - Code à 6 chiffres (par défaut 110706, surchargeable via APP_ACCESS_CODE).
// - Session de 24 heures matérialisée par un cookie HttpOnly signé HMAC-SHA256.
// - Vérification timing-safe à chaque requête (cf. src/middleware.js).

import crypto from 'node:crypto';

export const ACCESS_CODE = String(process.env.APP_ACCESS_CODE || '110706').trim();
export const ADMIN_CODE = String(process.env.APP_ADMIN_CODE || '302006').trim();
const TTL_HOURS = Number(process.env.APP_SESSION_TTL_HOURS || '24');
export const SESSION_TTL_MS = TTL_HOURS * 60 * 60 * 1000;
export const COOKIE_NAME = 'dsh_auth';

// Secret de signature : on prend en priorité APP_AUTH_SECRET, sinon on retombe
// sur une valeur stable propre à l'installation (clé Supabase service-role)
// avant un dernier fallback en dur. Sans secret stable, les sessions seraient
// invalidées à chaque redémarrage — ce qui n'est pas dramatique.
const SECRET =
  process.env.APP_AUTH_SECRET ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  'decoshop-default-secret-change-me';

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

/**
 * Construit la valeur de cookie pour une nouvelle session.
 * Format : "<issuedAtMs>.<role>.<hexSig>".
 */
export function makeSessionToken(role = 'user', now = Date.now()) {
  const issuedAt = String(now);
  const payload = `${issuedAt}.${role}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Valide un cookie de session. Retourne :
 *   - { ok: true,  issuedAt, expiresAt, role }  si tout est OK
 *   - { ok: false, expired: true }              si la session est périmée
 *   - { ok: false }                             si le cookie est absent / invalide
 */
export function verifySessionToken(token, now = Date.now()) {
  if (!token || typeof token !== 'string') return { ok: false };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false };

  const [issuedAtStr, role, sig] = parts;
  if (!/^\d+$/.test(issuedAtStr)) return { ok: false };
  if (!/^[a-f0-9]+$/i.test(sig)) return { ok: false };

  const payload = `${issuedAtStr}.${role}`;
  const expected = sign(payload);
  
  let a, b;
  try {
    a = Buffer.from(sig, 'hex');
    b = Buffer.from(expected, 'hex');
  } catch {
    return { ok: false };
  }
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false };

  const issuedAt = Number(issuedAtStr);
  const expiresAt = issuedAt + SESSION_TTL_MS;
  if (now > expiresAt) return { ok: false, expired: true };
  return { ok: true, issuedAt, expiresAt, role };
}

/** Identifie le rôle correspondant au code saisi (timing-safe). */
export function getRoleForCode(input) {
  if (typeof input !== 'string') return null;
  const a = Buffer.from(input);
  const bUser = Buffer.from(ACCESS_CODE);
  const bAdmin = Buffer.from(ADMIN_CODE);

  if (a.length === bAdmin.length && crypto.timingSafeEqual(a, bAdmin)) return 'admin';
  if (a.length === bUser.length && crypto.timingSafeEqual(a, bUser)) return 'user';
  return null;
}

/** Déprécié, utiliser getRoleForCode */
export function isValidCode(input) {
  return getRoleForCode(input) !== null;
}

/** Construit l'en-tête Set-Cookie pour ouvrir une session. */
export function buildSetCookie(token, { secure = true } = {}) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Construit l'en-tête Set-Cookie pour fermer la session. */
export function buildClearCookie({ secure = true } = {}) {
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'Max-Age=0',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/**
 * S'assure qu'un paramètre `next` reste sur le même domaine.
 * Refuse les schémas absolus, les URL "//exemple.com", etc.
 */
export function safeNextPath(next) {
  if (!next || typeof next !== 'string') return '/';
  if (!next.startsWith('/')) return '/';
  if (next.startsWith('//')) return '/';
  // refuse aussi les redirections vers /code (boucle)
  if (next === '/code' || next.startsWith('/code?')) return '/';
  return next;
}
