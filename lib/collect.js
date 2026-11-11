// Бір аккаунттың бір күнгі статистикасын IG-ден алып ig_stats_daily-ге жазады.
import { cfg } from './config.js';
import { decrypt } from './crypto.js';
import * as db from './db.js';
import * as st from './stats.js';

// offset=-1 — кеше. withProfile — жазылушы санын да сол күнге жазу (тек cron, өйткені бұл "қазіргі" сан).
export async function collectDay(acc, offset = -1, { withProfile = false } = {}) {
  const token = decrypt(acc.access_token, cfg.encKey);
  const { day, since, until } = st.almatyDay(offset);
  const ins = await st.accountDay(acc.ig_user_id, token, since, until);
  const row = { ig_user_id: acc.ig_user_id, day };
  if (!ins.error) Object.assign(row, ins);
  if (withProfile) {
    const p = await st.profile(token);
    Object.assign(row, { followers: p.followers_count, follows: p.follows_count, media_count: p.media_count });
  }
  await db.upsertStats(row);
  return { row, insightsError: ins.error || null };
}

const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('ru-RU'));

// Telegram үшін қысқа жол
export async function statsLine(acc, row) {
  const prev = await db.statsHistory(acc.ig_user_id, st.almatyDay(-2).day);
  const before = prev.find((r) => r.day === st.almatyDay(-2).day);
  const delta = before?.followers != null && row.followers != null ? row.followers - before.followers : null;
  const d = delta == null ? '' : ` (${delta >= 0 ? '+' : ''}${fmt(delta)})`;
  let s = `📊 жазылушы ${fmt(row.followers)}${d}`;
  if (row.reach != null) s += ` · reach ${fmt(row.reach)} · views ${fmt(row.views)}`;
  if (row.new_followers != null) s += ` · +${fmt(row.new_followers)}/−${fmt(row.unfollows)}`;
  return s;
}
