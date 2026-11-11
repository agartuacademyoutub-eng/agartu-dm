import { cfg } from '../../lib/config.js';
import { decrypt, safeEqual } from '../../lib/crypto.js';
import * as db from '../../lib/db.js';
import * as ig from '../../lib/ig.js';
import { tg } from '../../lib/tg.js';
import { handleComment, loadFlows } from '../../lib/handle.js';
import { collectStories } from '../../lib/stories.js';
import { runFollowups } from '../../lib/followup.js';

// Әр 10 минут (Supabase pg_cron → pg_net шақырады, Hobby жоспарында Vercel cron күніне бір рет қана):
// 1) API жұмыс істей ме — бұғатталса/қалпына келсе Telegram-ға бір рет хабар;
// 2) webhook жіберіп алған триггер-комменттерді тауып, DM жібереміз;
// 3) батырма басып, нөмір қалдырмағандарға бір реттік еске салу (flows.followup_text);
// 4) сағатына бір рет (минут < 10) сторис статистикасын жинаймыз.
const LOOKBACK_MS = 6 * 3600e3;
const MIN_AGE_MS = 3 * 60e3; // webhook-қа үлгеруге уақыт береміз

export async function GET(request) {
  if (!safeEqual(request.headers.get('authorization'), `Bearer ${cfg.cronSecret}`)) {
    return new Response('forbidden', { status: 403 });
  }
  const report = [];
  const flows = await loadFlows();

  for (const acc of await db.listAccounts()) {
    const token = decrypt(acc.access_token, cfg.encKey);
    try {
      await ig.getMe(token);
    } catch (e) {
      report.push({ account: acc.username, api: 'down', error: e.message });
      if (acc.api_ok !== false) {
        await db.rest(`accounts?ig_user_id=eq.${acc.ig_user_id}`, { method: 'PATCH', body: { api_ok: false } });
        await db.addError('watch', e.message);
        const hint = /access blocked/i.test(e.message)
          ? '\n\nСебебі көбіне Meta checkpoint: developers.facebook.com ашып, «Confirm Account» арқылы растаңыз.'
          : '';
        await tg(`🚨 @${acc.username}: бот тоқтады — Instagram API жауап бермейді.\n${e.message.slice(0, 300)}${hint}`);
      }
      continue;
    }
    if (acc.api_ok === false) {
      await db.rest(`accounts?ig_user_id=eq.${acc.ig_user_id}`, { method: 'PATCH', body: { api_ok: true } });
      await tg(`✅ @${acc.username}: Instagram API қайта жұмыс істеп тұр.`);
    }

    const now = Date.now();
    const recovered = [];
    try {
      for (const c of await ig.recentComments(token, now - LOOKBACK_MS)) {
        if (now - new Date(c.timestamp).getTime() < MIN_AGE_MS) continue;
        const r = await handleComment(
          {
            igUserId: acc.ig_user_id,
            commentId: c.id,
            fromId: String(c.from?.id || ''),
            fromUsername: c.from?.username || null,
            mediaId: c.mediaId,
            text: c.text || '',
          },
          flows,
        ).catch(async (e) => {
          await db.addError('watch_comment', e.message);
          return 'error';
        });
        if (r === 'sent') recovered.push(c.from?.username || c.from?.id);
      }
    } catch (e) {
      await db.addError('watch_sweep', e.message);
    }
    if (recovered.length) {
      await tg(`🔁 @${acc.username}: webhook жіберіп алған ${recovered.length} комментке DM жіберілді: ${recovered.map((u) => '@' + u).join(', ')}`);
    }
    const followed = await runFollowups(acc, token, flows).catch(async (e) => {
      await db.addError('watch_followup', e.message);
      return [];
    });
    if (followed.length) await tg(`💬 @${acc.username}: нөмір қалдырмаған ${followed.length} адамға еске салу жіберілді.`);
    let stories = null;
    if (new Date().getUTCMinutes() < 10 || new URL(request.url).searchParams.get('stories') === '1') {
      stories = await collectStories(acc).catch(async (e) => {
        await db.addError('watch_stories', e.message);
        return 'error';
      });
    }
    report.push({ account: acc.username, api: 'ok', recovered: recovered.length, stories });
  }
  return Response.json({ ok: true, report });
}
