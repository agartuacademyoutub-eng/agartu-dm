// Supabase PostgREST арқылы (service_role). SDK қажет емес.
import { cfg } from './config.js';

export async function rest(path, { method = 'GET', body, prefer } = {}) {
  const res = await fetch(`${cfg.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: cfg.supabaseKey,
      Authorization: `Bearer ${cfg.supabaseKey}`,
      'Content-Type': 'application/json',
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`db ${method} ${path}: ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

export async function getAccount(igUserId) {
  const rows = await rest(`accounts?ig_user_id=eq.${encodeURIComponent(igUserId)}&select=*`);
  return rows[0] || null;
}

export async function listAccounts() {
  return rest('accounts?select=*&order=ig_user_id.asc');
}

// Google Sheet есебі осы аккаунт бойынша (тізім реті тұрақты емес — атымен аламыз)
export async function mainAccount() {
  const all = await listAccounts();
  return all.find((a) => a.username === cfg.mainAccount) || all[0] || null;
}

export async function upsertAccount(row) {
  await rest('accounts?on_conflict=ig_user_id', {
    method: 'POST',
    body: { ...row, updated_at: new Date().toISOString() },
    prefer: 'resolution=merge-duplicates',
  });
}

// Комментті бір рет қана өңдеу үшін: жаңа болса жолды қайтарады, қайталанса null.
export async function claimComment(row) {
  const rows = await rest('dm_logs?on_conflict=comment_id', {
    method: 'POST',
    body: { ...row, status: 'processing' },
    prefer: 'resolution=ignore-duplicates,return=representation',
  });
  return rows && rows.length ? rows[0] : null;
}

export async function updateLog(commentId, patch) {
  await rest(`dm_logs?comment_id=eq.${encodeURIComponent(commentId)}`, { method: 'PATCH', body: patch });
}

export async function countSentSince(igUserId, sinceIso) {
  const res = await fetch(
    `${cfg.supabaseUrl}/rest/v1/dm_logs?ig_user_id=eq.${igUserId}&status=eq.sent&created_at=gte.${encodeURIComponent(sinceIso)}&select=comment_id`,
    { method: 'HEAD', headers: { apikey: cfg.supabaseKey, Authorization: `Bearer ${cfg.supabaseKey}`, Prefer: 'count=exact' } },
  );
  return Number((res.headers.get('content-range') || '*/0').split('/')[1]) || 0;
}

export async function listFlows() {
  return rest('flows?active=eq.true&select=*&order=priority.asc,id.asc');
}

// Адам қай сценарий арқылы DM алды: соңғы жіберілген DM-нің сценарийі (id бойынша, болмаса username бойынша).
export async function lastFlowForUser(igUserId, fromId, username) {
  const q = (filter) =>
    rest(`dm_logs?ig_user_id=eq.${encodeURIComponent(igUserId)}&status=eq.sent&${filter}&flow_id=not.is.null&select=flow_id&order=created_at.desc&limit=1`);
  let rows = await q(`from_id=eq.${encodeURIComponent(fromId)}`);
  if (!rows.length && username) rows = await q(`from_username=eq.${encodeURIComponent(username)}`);
  if (!rows.length) return null;
  const flows = await rest(`flows?id=eq.${rows[0].flow_id}&select=id,name,lead_tag,phone_reply`);
  return flows[0] || null;
}

export async function addAnswer(row) {
  await rest('dm_answers', { method: 'POST', body: row });
}

// Соңғы 14 күндегі батырма жауаптары (ескісі бірінші).
export async function recentAnswers(igUserId, fromId) {
  const since = new Date(Date.now() - 14 * 864e5).toISOString();
  return rest(
    `dm_answers?ig_user_id=eq.${encodeURIComponent(igUserId)}&from_id=eq.${encodeURIComponent(fromId)}&created_at=gte.${since}&select=flow_id,title&order=created_at.asc`,
  );
}

export async function addLead(row) {
  await rest('phone_leads', { method: 'POST', body: row });
}

export async function addError(where, message) {
  try {
    await rest('bot_errors', { method: 'POST', body: { where_at: where, message: String(message).slice(0, 2000) } });
  } catch {
    /* базаға жаза алмасақ — Telegram бәрібір хабарлайды */
  }
}

export async function countSince(table, sinceIso, extra = '') {
  const res = await fetch(
    `${cfg.supabaseUrl}/rest/v1/${table}?created_at=gte.${encodeURIComponent(sinceIso)}${extra}&select=created_at`,
    { method: 'HEAD', headers: { apikey: cfg.supabaseKey, Authorization: `Bearer ${cfg.supabaseKey}`, Prefer: 'count=exact' } },
  );
  return Number((res.headers.get('content-range') || '*/0').split('/')[1]) || 0;
}

export async function upsertStats(row) {
  await rest('ig_stats_daily?on_conflict=ig_user_id,day', {
    method: 'POST',
    body: { ...row, updated_at: new Date().toISOString() },
    prefer: 'resolution=merge-duplicates',
  });
}

export async function statsHistory(igUserId, fromDay) {
  return rest(`ig_stats_daily?ig_user_id=eq.${encodeURIComponent(igUserId)}&day=gte.${fromDay}&select=*&order=day.asc`);
}
