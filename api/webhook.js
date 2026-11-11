import { cfg } from '../lib/config.js';
import { validSignature, safeEqual } from '../lib/crypto.js';
import { processPayload } from '../lib/handle.js';

// Meta webhook верификациясы
export function GET(request) {
  const u = new URL(request.url);
  if (u.searchParams.get('hub.mode') === 'subscribe' && safeEqual(u.searchParams.get('hub.verify_token'), cfg.verifyToken)) {
    return new Response(u.searchParams.get('hub.challenge') || '', { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

export async function POST(request) {
  const raw = await request.text();
  // Instagram Login webhook-тары Instagram App Secret-пен, кейде негізгі App Secret-пен қол қойылады
  const sig = request.headers.get('x-hub-signature-256');
  if (!validSignature(raw, sig, cfg.igAppSecret) && !validSignature(raw, sig, cfg.metaAppSecret)) {
    return new Response('bad signature', { status: 401 });
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response('bad json', { status: 400 });
  }
  const results = await processPayload(payload);
  return Response.json({ ok: true, results });
}
