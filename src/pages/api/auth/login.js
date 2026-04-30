export const prerender = false;

import {
  isValidCode,
  makeSessionToken,
  buildSetCookie,
  SESSION_TTL_MS,
} from '../../../lib/auth.js';

export async function POST({ request, url }) {
  let code = '';
  try {
    const data = await request.json();
    code = String(data?.code ?? '').trim();
  } catch {
    return new Response(JSON.stringify({ error: 'bad_request' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  // Format attendu : 6 chiffres exactement
  if (!/^\d{6}$/.test(code) || !isValidCode(code)) {
    return new Response(JSON.stringify({ error: 'invalid_code' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }

  const token = makeSessionToken();
  const secure = url.protocol === 'https:';
  return new Response(
    JSON.stringify({ ok: true, expiresIn: SESSION_TTL_MS }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': buildSetCookie(token, { secure }),
      },
    },
  );
}
