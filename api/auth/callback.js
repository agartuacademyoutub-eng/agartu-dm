import crypto from 'node:crypto';
import { cfg } from '../../lib/config.js';
import { encrypt } from '../../lib/crypto.js';
import * as db from '../../lib/db.js';
import * as ig from '../../lib/ig.js';
import { tg } from '../../lib/tg.js';

const page = (title, body, status = 200) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:18px system-ui;max-width:560px;margin:60px auto;padding:0 16px"><h2>${title}</h2><p>${body}</p>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

export async function GET(request) {
  const u = new URL(request.url);
  const [nonce, sig] = (u.searchParams.get('state') || '').split('.');
  const expected = nonce && crypto.createHmac('sha256', cfg.cronSecret).update(nonce).digest('hex').slice(0, 32);
  if (!nonce || sig !== expected) return page('Қате', 'state жарамсыз. Қайта бастаңыз.', 403);
  if (u.searchParams.get('error')) return page('Бас тартылды', u.searchParams.get('error_description') || '', 400);

  const code = (u.searchParams.get('code') || '').replace(/#_$/, '');
  try {
    const { token, expiresIn } = await ig.exchangeCode(code, `${cfg.appUrl}/api/auth/callback`);
    const me = await ig.getMe(token);
    await ig.subscribe(token);
    await db.upsertAccount({
      ig_user_id: String(me.user_id),
      username: me.username,
      access_token: encrypt(token, cfg.encKey),
      token_expires_at: new Date(Date.now() + (expiresIn || 5184000) * 1000).toISOString(),
    });
    await tg(`✅ @${me.username} ботқа қосылды.`);
    return page('Дайын ✅', `@${me.username} қосылды. Комментке «${cfg.triggers.join(', ')}» жазылса, бот Директке жауап береді.`);
  } catch (e) {
    await db.addError('auth_callback', e.message);
    return page('Қате', e.message.replace(/</g, '&lt;'), 500);
  }
}
