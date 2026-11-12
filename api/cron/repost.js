import { cfg } from '../../lib/config.js';
import { safeEqual } from '../../lib/crypto.js';
import * as db from '../../lib/db.js';
import { repostStep } from '../../lib/repost.js';
import { tg } from '../../lib/tg.js';

// Әр 10 минут (Supabase pg_cron): cfg.repostDaily аккаунттарының ескі Reels-ін пробный етіп қайта салу, бір қадамнан.
// Бір шақыруда тек бір аккаунт видео өңдейді (300 с лимит), қалғандары тек дайынын жариялайды.
// ?force=1&account=<username> — уақыт/лимит/аралыққа қарамай келесі қадам (қолмен тексеру үшін).
// ?all=1 — барлық аккаунт қатар видео өңдейді (GitHub Actions-та уақыт лимиті жоқ).
export async function GET(request) {
  if (!safeEqual(request.headers.get('authorization'), `Bearer ${cfg.cronSecret}`)) {
    return new Response('forbidden', { status: 403 });
  }
  const u = new URL(request.url);
  const force = u.searchParams.get('force') === '1';
  const only = u.searchParams.get('account');
  const all = u.searchParams.get('all') === '1';
  // Әр 10 минут сайын бірінші тұратын аккаунт ауысады — бірін-бірі тежемесін
  const list = (await db.listAccounts()).filter((a) => cfg.repostDaily[a.username] && (!only || a.username === only));
  const shift = Math.floor(Date.now() / 600e3) % (list.length || 1);
  const accs = [...list.slice(shift), ...list.slice(0, shift)];
  const report = [];
  let busy = false;
  for (const acc of accs) {
    if (acc.api_ok === false) { report.push({ account: acc.username, action: 'api_down' }); continue; }
    try {
      const r = await repostStep(acc, { daily: cfg.repostDaily[acc.username], force, prepare: !busy });
      if (r.action === 'started' && !all) busy = true;
      if (r.action === 'error') await tg(`⚠️ @${acc.username} пробный қайта салу: IG видеоны қабылдамады (${r.error}).\n${r.source}`);
      report.push({ account: acc.username, ...r });
    } catch (e) {
      busy = !all;
      await db.addError('repost', `${acc.username}: ${e.message}`);
      await tg(`⚠️ @${acc.username} пробный қайта салу қатесі: ${e.message.slice(0, 300)}`);
      report.push({ account: acc.username, action: 'exception', error: e.message });
    }
  }
  return Response.json({ ok: true, report });
}
