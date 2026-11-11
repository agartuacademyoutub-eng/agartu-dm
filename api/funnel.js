import { cfg } from '../lib/config.js';
import { safeEqual } from '../lib/crypto.js';
import * as db from '../lib/db.js';
import { funnelReport, syncComments, syncPhones } from '../lib/funnel.js';

// Воронка: /api/funnel?key=<STATS_KEY>&account=<username>&days=30
// &sync=1 — алдымен соңғы 3 күндегі посттарды жаңартады (дашбордтағы батырма)
export async function GET(request) {
  const u = new URL(request.url);
  if (!safeEqual(u.searchParams.get('key'), cfg.statsKey)) return Response.json({ error: 'forbidden' }, { status: 403 });
  const accounts = await db.listAccounts();
  const acc = accounts.find((a) => a.username === u.searchParams.get('account')) || accounts.find((a) => a.username === cfg.mainAccount) || accounts[0];
  if (!acc) return Response.json({ error: 'Аккаунт қосылмаған' }, { status: 404 });
  const days = Math.min(Math.max(Number(u.searchParams.get('days')) || 30, 1), 90);
  if (u.searchParams.get('sync') === '1') {
    await syncComments(acc, 3);
    await syncPhones(acc, { days: 17, recheckHours: 0.25, limit: 400 });
  }
  return Response.json({ username: acc.username, days, ...(await funnelReport(acc, days)) }, { headers: { 'Cache-Control': 'no-store' } });
}
