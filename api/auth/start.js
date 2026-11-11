import crypto from 'node:crypto';
import { cfg, SCOPES } from '../../lib/config.js';
import { safeEqual } from '../../lib/crypto.js';

// Instagram аккаунтын қосу: /api/auth/start?key=<CRON_SECRET>
// state = HMAC, сондықтан бөтен адам өз аккаунтын қоса алмайды.
export function GET(request) {
  const u = new URL(request.url);
  if (!safeEqual(u.searchParams.get('key'), cfg.cronSecret)) return new Response('forbidden', { status: 403 });
  const nonce = crypto.randomBytes(8).toString('hex');
  const sig = crypto.createHmac('sha256', cfg.cronSecret).update(nonce).digest('hex').slice(0, 32);
  const auth = new URL('https://www.instagram.com/oauth/authorize');
  auth.searchParams.set('client_id', cfg.igAppId);
  auth.searchParams.set('redirect_uri', `${cfg.appUrl}/api/auth/callback`);
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('scope', SCOPES.join(','));
  auth.searchParams.set('state', `${nonce}.${sig}`);
  auth.searchParams.set('enable_fb_login', '0');
  auth.searchParams.set('force_authentication', '1');
  return Response.redirect(auth.toString(), 302);
}
