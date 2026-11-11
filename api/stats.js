import { cfg } from '../lib/config.js';
import { decrypt, safeEqual } from '../lib/crypto.js';
import * as db from '../lib/db.js';
import * as st from '../lib/stats.js';

// Дашбордқа дерек: /api/stats?key=<STATS_KEY>&account=<username>&days=30
export async function GET(request) {
  const u = new URL(request.url);
  if (!safeEqual(u.searchParams.get('key'), cfg.statsKey)) return Response.json({ error: 'forbidden' }, { status: 403 });

  const accounts = await db.listAccounts();
  const acc = accounts.find((a) => a.username === u.searchParams.get('account')) || accounts.find((a) => a.username === cfg.mainAccount) || accounts[0];
  if (!acc) return Response.json({ error: 'Аккаунт қосылмаған' }, { status: 404 });

  const days = Math.min(Math.max(Number(u.searchParams.get('days')) || 30, 7), 365);
  const token = decrypt(acc.access_token, cfg.encKey);
  const today = st.almatyDay(0);
  const [profile, history, media, todayIns, dms, leads] = await Promise.all([
    st.profile(token),
    db.statsHistory(acc.ig_user_id, st.almatyDay(-days).day),
    st.recentMedia(token, 24).catch((e) => ({ error: e.message })),
    st.accountDay(acc.ig_user_id, token, today.since, Math.floor(Date.now() / 1000)),
    db.countSince('dm_logs', new Date(Date.now() - days * 864e5).toISOString(), `&ig_user_id=eq.${acc.ig_user_id}&status=eq.sent`),
    db.countSince('phone_leads', new Date(Date.now() - days * 864e5).toISOString(), `&ig_user_id=eq.${acc.ig_user_id}`),
  ]);

  return Response.json(
    {
      accounts: accounts.map((a) => a.username),
      profile,
      insightsOk: !todayIns.error,
      insightsError: todayIns.error || null,
      today: todayIns.error ? null : { day: today.day, ...todayIns },
      history,
      media: Array.isArray(media) ? media : [],
      bot: { dms, leads, days },
      generatedAt: new Date().toISOString(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
