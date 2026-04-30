// Middleware Astro : protège toutes les pages et toutes les routes /api/* avec
// le cookie de session "dsh_auth". Tout visiteur sans session valide est
// redirigé vers /code (ou reçoit un 401 JSON pour les appels API).

import { COOKIE_NAME, verifySessionToken } from './lib/auth.js';

// Chemins toujours accessibles (page de saisie du code, endpoints d'auth,
// quelques fichiers statiques racine éventuels).
const PUBLIC_PATHS = new Set([
  '/code',
  '/api/auth/login',
  '/api/auth/logout',
  '/favicon.svg',
  '/favicon.ico',
  '/robots.txt',
]);

function isPublic(pathname) {
  if (PUBLIC_PATHS.has(pathname)) return true;
  // Astro/Vite assets et endpoints internes
  if (pathname.startsWith('/_astro/')) return true;
  if (pathname.startsWith('/_image')) return true;
  if (pathname.startsWith('/_actions/')) return true;
  return false;
}

export const onRequest = async (context, next) => {
  const { cookies, redirect, locals, url } = context;
  const pathname = url.pathname;

  if (isPublic(pathname)) {
    return next();
  }

  const cookie = cookies.get(COOKIE_NAME);
  const session = verifySessionToken(cookie?.value || '');

  if (!session.ok) {
    // Pour les appels API on renvoie un JSON 401 au lieu de rediriger,
    // sinon les fetch() côté client recevraient du HTML.
    if (pathname.startsWith('/api/')) {
      return new Response(
        JSON.stringify({ error: 'unauthorized', code: 'AUTH_REQUIRED' }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
      );
    }
    // Pour une navigation classique, on redirige vers /code en gardant
    // l'URL d'origine pour pouvoir y revenir après authentification.
    const back = encodeURIComponent(pathname + url.search);
    return redirect(`/code?next=${back}`, 302);
  }

  // Expose l'expiration aux pages (utilisé par Layout.astro pour planifier
  // une auto-déconnexion côté client pile à l'expiration).
  locals.authExpiresAt = session.expiresAt;
  locals.authIssuedAt = session.issuedAt;

  return next();
};
