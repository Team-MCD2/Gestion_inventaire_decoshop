export const prerender = false;

import { buildClearCookie } from '../../../lib/auth.js';

export async function POST({ url }) {
  const secure = url.protocol === 'https:';
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': buildClearCookie({ secure }),
    },
  });
}
