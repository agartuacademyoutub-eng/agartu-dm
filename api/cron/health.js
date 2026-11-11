import { cfg } from '../../lib/config.js';
import { encrypt, decrypt, safeEqual } from '../../lib/crypto.js';
import * as db from '../../lib/db.js';
import * as ig from '../../lib/ig.js';
import { tg } from '../../lib/tg.js';
import { collectDay, statsLine } from '../../lib/collect.js';
import { updateSheet } from '../../lib/report.js';
import { almaty, sendReport } from '../../lib/attendance.js';

// Күнде 04:00 UTC (= 09:00 Алматы): токенді жаңарту + кешегі статистиканы жазу + Telegram-ға есеп.
// Vercel cron өзі "Authorization: Bearer <CRON_SECRET>" жібереді.
export async function GET(request) {
  if (!safeEqual(request.headers.get('authorization'), `Bearer ${cfg.cronSecret}`)) {
    return new Response('forbidden', { status: 403 });
  }
  const test = new URL(request.url).searchParams.get('test') === '1';
  const since = new Date(Date.now() - 864e5).toISOString();
  const lines = [];
  let problems = 0;

  for (const acc of await db.listAccounts()) {
    let note = '';
    try {
      const daysLeft = (new Date(acc.token_expires_at) - Date.now()) / 864e5;
      // Токенді 24 сағаттан ескі болса жаңартуға болады; 50 күннен аз қалса жаңартамыз
      if (daysLeft < 50) {
        const r = await ig.refreshToken(decrypt(acc.access_token, cfg.encKey));
        await db.upsertAccount({
          ig_user_id: acc.ig_user_id,
          username: acc.username,
          access_token: encrypt(r.token, cfg.encKey),
          token_expires_at: new Date(Date.now() + (r.expiresIn || 5184000) * 1000).toISOString(),
        });
        note = ' · токен жаңарды';
      } else {
        note = ` · токен ${Math.round(daysLeft)} күн`;
      }
    } catch (e) {
      problems++;
      note = ` · 🚨 токен: ${e.message.slice(0, 200)}`;
      await db.addError('token_refresh', e.message);
    }
    const sent = await db.countSince('dm_logs', since, `&ig_user_id=eq.${acc.ig_user_id}&status=eq.sent`);
    const failed = await db.countSince('dm_logs', since, `&ig_user_id=eq.${acc.ig_user_id}&status=in.(error,rate_limited)`);
    const leads = await db.countSince('phone_leads', since, `&ig_user_id=eq.${acc.ig_user_id}`);
    if (failed) problems++;
    lines.push(`@${acc.username}: DM ${sent}, қате ${failed}, нөмір ${leads}${note}`);
    try {
      const { row, insightsError } = await collectDay(acc, -1, { withProfile: true });
      lines.push(`   ${await statsLine(acc, row)}${insightsError ? ' · insights рұқсаты жоқ' : ''}`);
      // IG insights 1–2 күн кешігіп толады: алдыңғы екі күнді қайта жазамыз
      if (!insightsError) for (const off of [-2, -3]) await collectDay(acc, off);
    } catch (e) {
      await db.addError('stats', e.message);
      lines.push(`   📊 статистика алынбады: ${e.message.slice(0, 150)}`);
    }
  }
  if (cfg.sheetId) {
    try {
      const main = await db.mainAccount();
      if (main) await updateSheet(main);
      lines.push(`📄 Кесте жаңарды: https://docs.google.com/spreadsheets/d/${cfg.sheetId}`);
    } catch (e) {
      problems++;
      await db.addError('sheet', e.message);
      lines.push(`📄 Кесте жаңармады: ${e.message.slice(0, 150)}`);
    }
  }
  // Айдың 1-і: өткен айдың кешігу есебі админдерге
  const today = almaty(new Date()).day;
  if (today.endsWith('-01') || test) {
    const [y, m] = today.split('-').map(Number);
    const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
    for (const admin of cfg.attAdmins) {
      try {
        await sendReport(admin, py, pm);
      } catch (e) {
        problems++;
        await db.addError('attendance_report', e.message);
      }
    }
  }
  const errors = await db.countSince('bot_errors', since);
  if (errors) problems++;

  const head = test ? '🧪 Сынақ хабары' : problems ? '⚠️ Бот жұмыс істеп тұр, бірақ ескерту бар' : '✅ Бот тірі';
  await tg(`${head} (соңғы 24 сағ)\n${lines.join('\n') || 'Аккаунт қосылмаған'}\nbot_errors: ${errors}`);
  return Response.json({ ok: true, lines, errors });
}
