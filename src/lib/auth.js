// Petite couche d'authentification "code d'accès" pour DECO SHOP.
//
// - Code à 6 chiffres (par défaut 110706, surchargeable via APP_ACCESS_CODE).
// - Session de 24 heures matérialisée par un cookie HttpOnly signé HMAC-SHA256.
// - Vérification timing-safe à chaque requête (cf. src/middleware.js).

import crypto from 'node:crypto';

export const ACCESS_CODE = String(process.env.APP_ACCESS_CODE || '110706').trim();
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
 * Format : "<issuedAtMs>.<hexSig>".
 */
export function makeSessionToken(now = Date.now()) {
  const issuedAt = String(now);
  return `${issuedAt}.${sign(issuedAt)}`;
}

/**
 * Valide un cookie de session. Retourne :
 *   - { ok: true,  issuedAt, expiresAt }  si tout est OK
 *   - { ok: false, expired: true }        si la session est périmée
 *   - { ok: false }                       si le cookie est absent / invalide
 */
export function verifySessionToken(token, now = Date.now()) {
  if (!token || typeof token !== 'string') return { ok: false };
  const dot = token.indexOf('.');
  if (dot < 1) return { ok: false };

  const issuedAtStr = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!/^\d+$/.test(issuedAtStr)) return { ok: false };
  if (!/^[a-f0-9]+$/i.test(sig)) return { ok: false };

  const expected = sign(issuedAtStr);
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
  return { ok: true, issuedAt, expiresAt };
}

/** Compare le code saisi au code attendu (timing-safe). */
export function isValidCode(input) {
  if (typeof input !== 'string') return false;
  const a = Buffer.from(input);
  const b = Buffer.from(ACCESS_CODE);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
