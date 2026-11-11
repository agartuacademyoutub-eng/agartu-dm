// Воронка: пост → триггер-коммент (+, дұға, ...) → Директке нөмір.
// Комменттер мен Директті IG API-ден тартамыз, сондықтан бот қосылғанға дейінгі посттар да есептеледі.
import { cfg } from './config.js';
import { decrypt } from './crypto.js';
import { rest, listFlows } from './db.js';
import { pickFlow, extractPhone } from './match.js';
import { tg } from './tg.js';

const G = () => `https://graph.instagram.com/${cfg.graphVersion}`;
const LEAD_WINDOW_MS = 14 * 864e5; // комменттен кейін 14 күн ішінде жазылған нөмір ғана есептеледі

async function get(url, token, tries = 3) {
  const full = url.startsWith('http') ? url : `${G()}/${url}`;
  let res;
  try {
    res = await fetch(full, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    if (tries <= 1) throw e;
    await new Promise((r) => setTimeout(r, 2000));
    return get(url, token, tries - 1);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error ? `${json.error.code} ${json.error.message}` : String(res.status));
  return json;
}

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// Желі үзілсе бір рет қайталаймыз
const rest2 = (...a) => rest(...a).catch(() => new Promise((r) => setTimeout(r, 1500)).then(() => rest(...a)));

const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

const MEDIA_METRICS = ['reach', 'views', 'shares', 'saved'];
const REELS_METRICS = [...MEDIA_METRICS, 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'reels_skip_rate'];

// Бір сұраумен барлық метрика; бірі қолдау таппаса — әрқайсысын жеке сұраймыз
async function mediaInsights(id, metrics, token) {
  const val = (d) => d?.values?.[0]?.value ?? d?.total_value?.value ?? null;
  try {
    const r = await get(`${id}/insights?metric=${metrics.join(',')}`, token);
    return Object.fromEntries((r.data || []).map((d) => [d.name, val(d)]));
  } catch {
    const out = {};
    for (const k of metrics) out[k] = await get(`${id}/insights?metric=${k}`, token).then((r) => val(r.data?.[0]), () => null);
    return out;
  }
}

// Видео ұзақтығын API бермейді — mp4-тің mvhd атомынан оқимыз (алдымен басынан, табылмаса соңынан)
export function mvhdSeconds(buf) {
  const i = buf.indexOf('mvhd');
  if (i < 0 || i + 32 > buf.length) return null;
  const v1 = buf[i + 4] === 1;
  const scale = buf.readUInt32BE(i + (v1 ? 24 : 16));
  const dur = v1 ? Number(buf.readBigUInt64BE(i + 28)) : buf.readUInt32BE(i + 20);
  return scale ? Math.round((dur / scale) * 10) / 10 : null;
}
async function videoDuration(url) {
  if (!url) return null;
  try {
    const head = await fetch(url, { headers: { Range: 'bytes=0-131071' } });
    const s = mvhdSeconds(Buffer.from(await head.arrayBuffer()));
    if (s) return s;
    const total = Number((head.headers.get('content-range') || '').split('/')[1]);
    if (!total) return null;
    const tail = await fetch(url, { headers: { Range: `bytes=${Math.max(0, total - 524288)}-${total - 1}` } });
    return mvhdSeconds(Buffer.from(await tail.arrayBuffer()));
  } catch {
    return null;
  }
}

// 1) Соңғы `days` күндегі посттардың комменттерін жинап, триггерге сәйкестерін сақтау
export async function syncComments(acc, days, log = () => {}) {
  const token = decrypt(acc.access_token, cfg.encKey);
  const flows = await listFlows();
  const since = Date.now() - days * 864e5;
  const media = [];
  for (let url = 'me/media?fields=id,timestamp,comments_count,like_count,caption,permalink,media_type,media_product_type,media_url&limit=100'; url; ) {
    const r = await get(url, token);
    let stop = false;
    for (const m of r.data || []) { if (new Date(m.timestamp) < since) { stop = true; break; } media.push(m); }
    url = stop ? null : r.paging?.next;
  }
  const known = await rest2(`funnel_media?ig_user_id=eq.${acc.ig_user_id}&duration_s=not.is.null&select=media_id,duration_s&limit=10000`);
  const durations = Object.fromEntries(known.map((k) => [k.media_id, k.duration_s]));
  let found = 0;
  await pool(media, 4, async (m) => {
    const rows = [];
    if (m.comments_count) {
      for (let url = `${m.id}/comments?fields=id,text,username,from,timestamp&limit=100`; url; ) {
        const r = await get(url, token);
        for (const c of r.data || []) {
          if (c.username === acc.username) continue;
          const flow = pickFlow(c.text, flows);
          if (!flow) continue;
          rows.push({
            comment_id: c.id, ig_user_id: acc.ig_user_id, media_id: m.id, from_id: c.from?.id || null,
            username: c.username || c.from?.username || null, text: (c.text || '').slice(0, 500), flow_id: flow.id, created_at: c.timestamp,
          });
        }
        url = r.paging?.next;
      }
    }
    for (const part of chunks(rows, 500)) {
      await rest2('funnel_comments?on_conflict=comment_id', { method: 'POST', body: part, prefer: 'resolution=merge-duplicates' });
    }
    const isReel = m.media_product_type === 'REELS';
    const ins = await mediaInsights(m.id, isReel ? REELS_METRICS : MEDIA_METRICS, token);
    const reel = isReel
      ? {
          avg_watch_ms: ins.ig_reels_avg_watch_time ?? null, total_watch_ms: ins.ig_reels_video_view_total_time ?? null,
          skip_rate: ins.reels_skip_rate ?? null, duration_s: durations[m.id] ?? (await videoDuration(m.media_url)),
        }
      : {};
    await rest2('funnel_media?on_conflict=ig_user_id,media_id', {
      method: 'POST',
      body: {
        ig_user_id: acc.ig_user_id, media_id: m.id, comments_total: m.comments_count, likes: m.like_count ?? null,
        posted_at: m.timestamp, media_type: isReel ? 'REELS' : m.media_type,
        caption: (m.caption || '').slice(0, 2200), // CTA көбіне соңында — толық сақтаймыз permalink: m.permalink, reach: ins.reach ?? null, views: ins.views ?? null,
        shares: ins.shares ?? null, saves: ins.saved ?? null, ...reel,
        synced_at: new Date().toISOString(),
      },
      prefer: 'resolution=merge-duplicates',
    });
    found += rows.length;
  });
  log(`@${acc.username}: ${media.length} пост, ${found} триггер-коммент`);
  return { media: media.length, comments: found };
}

// 2) Әр комментатордың Директінен нөмір іздеу. recheckHours — нөмірі жоқ адамды қанша сағаттан кейін қайта тексеру.
export async function syncPhones(acc, { days = 90, recheckHours = 20, limit = 5000, log = () => {} } = {}) {
  const token = decrypt(acc.access_token, cfg.encKey);
  const sinceIso = new Date(Date.now() - days * 864e5).toISOString();
  const recheck = new Date(Date.now() - recheckHours * 3600e3).toISOString();
  const pending = await rest(
    `funnel_comments?ig_user_id=eq.${acc.ig_user_id}&phone=is.null&created_at=gte.${encodeURIComponent(sinceIso)}` +
      `&or=(checked_at.is.null,checked_at.lt.${encodeURIComponent(recheck)})&from_id=not.is.null&select=from_id&limit=${limit}`,
  );
  const users = [...new Set(pending.map((r) => r.from_id))];
  const flows = await rest2('flows?select=id,name,lead_tag');
  let leads = 0, errors = 0;
  await pool(users, 5, async (fromId) => {
    let first = null;
    try {
      const r = await get(`me/conversations?platform=instagram&user_id=${fromId}&fields=messages.limit(50){message,from,created_time}`, token);
      const msgs = (r.data?.[0]?.messages?.data || [])
        .filter((m) => m.from?.id === fromId)
        .map((m) => ({ phone: extractPhone(m.message), at: m.created_time }))
        .filter((m) => m.phone)
        .sort((a, b) => a.at.localeCompare(b.at));
      first = msgs;
    } catch {
      errors++;
      return;
    }
    try {
    const all = await rest2(`funnel_comments?ig_user_id=eq.${acc.ig_user_id}&from_id=eq.${fromId}&select=comment_id,created_at&order=created_at.asc`);
    const now = new Date().toISOString();
    // Әр нөмірге: адамның сол нөмірге дейінгі соңғы комменті (14 күн ішінде) — lead
    const leadOf = new Map();
    for (const ph of first) {
      const before = all.filter((c) => c.created_at <= ph.at && new Date(ph.at) - new Date(c.created_at) <= LEAD_WINDOW_MS);
      const c = before[before.length - 1];
      if (c && !leadOf.has(c.comment_id)) leadOf.set(c.comment_id, ph);
    }
    for (const c of all) {
      const ph = leadOf.get(c.comment_id) || first.find((p) => p.at >= c.created_at);
      const patch = { checked_at: now, is_lead: leadOf.has(c.comment_id) };
      if (ph) Object.assign(patch, { phone: ph.phone, phone_at: ph.at });
      await rest2(`funnel_comments?comment_id=eq.${encodeURIComponent(c.comment_id)}`, { method: 'PATCH', body: patch });
    }
    leads += leadOf.size;
    // Webhook кейде Директ хабарын жеткізбейді: соңғы 3 күндегі нөмір phone_leads-те жоқ болса — қосып, Telegram-ға жібереміз
    for (const [commentId, ph] of leadOf) {
      if (Date.now() - new Date(ph.at) > 3 * 864e5) continue;
      const exists = await rest2(`phone_leads?ig_user_id=eq.${acc.ig_user_id}&from_id=eq.${fromId}&phone=eq.${encodeURIComponent(ph.phone)}&select=id`);
      if (exists.length) continue;
      const c = (await rest2(`funnel_comments?comment_id=eq.${encodeURIComponent(commentId)}&select=username,flow_id,media_id`))[0] || {};
      const flow = flows.find((f) => f.id === c.flow_id);
      await rest2('phone_leads', { method: 'POST', body: { ig_user_id: acc.ig_user_id, from_id: fromId, from_username: c.username, phone: ph.phone, message: '(Директтен синхрондау арқылы табылды)', tag: flow?.lead_tag || null } });
      await tg(`📞 Жаңа нөмір (@${acc.username}) — Директтен табылды\n${flow?.lead_tag ? `🏷 ${flow.lead_tag}\n` : ''}${flow ? `Воронка: ${flow.name}\n` : ''}${ph.phone}\n@${c.username}`);
    }
    } catch {
      errors++;
    }
  });
  log(`@${acc.username}: ${users.length} адам тексерілді, ${leads} нөмір${errors ? `, ${errors} қате` : ''}`);
  return { users: users.length, leads, errors };
}

// 3) Дашбордқа: соңғы `days` күндегі посттар бойынша воронка
export async function funnelReport(acc, days) {
  const sinceIso = new Date(Date.now() - days * 864e5).toISOString();
  const [media, rows, flows] = await Promise.all([
    rest(`funnel_media?ig_user_id=eq.${acc.ig_user_id}&posted_at=gte.${encodeURIComponent(sinceIso)}&select=*&order=posted_at.desc`),
    rest(`funnel_comments?ig_user_id=eq.${acc.ig_user_id}&created_at=gte.${encodeURIComponent(new Date(Date.now() - (days + 30) * 864e5).toISOString())}&select=media_id,from_id,username,flow_id,is_lead,phone&limit=100000`),
    rest('flows?select=id,name'),
  ]);
  const flowName = Object.fromEntries(flows.map((f) => [f.id, f.name]));
  const posts = Object.fromEntries(media.map((m) => [m.media_id, { ...m, triggers: 0, people: 0, leads: 0, flows: {}, flowLeads: {} }]));
  const seen = new Set();
  for (const r of rows) {
    const p = posts[r.media_id];
    if (!p) continue;
    p.triggers++;
    const who = r.from_id || r.username;
    if (!seen.has(r.media_id + '|' + who)) {
      seen.add(r.media_id + '|' + who);
      p.people++;
      const fn = flowName[r.flow_id] || '—';
      p.flows[fn] = (p.flows[fn] || 0) + 1;
    }
    if (r.is_lead) {
      p.leads++;
      const fn = flowName[r.flow_id] || '—';
      p.flowLeads[fn] = (p.flowLeads[fn] || 0) + 1;
    }
  }
  // Тамбнейл сілтемелері ескіреді — посттар тізімінен тірі түрде аламыз.
  // Пробный Reels лентаға шықпайды (is_shared_to_feed=false); «бөлісу» басылса true болады.
  const token = decrypt(acc.access_token, cfg.encKey);
  try {
    for (let url = 'me/media?fields=id,timestamp,thumbnail_url,media_url,media_product_type,is_shared_to_feed&limit=100'; url; ) {
      const r = await get(url, token);
      let stop = false;
      for (const m of r.data || []) {
        if (m.timestamp < sinceIso.slice(0, 19)) { stop = true; break; }
        if (!posts[m.id]) continue;
        posts[m.id].thumb = m.thumbnail_url || m.media_url;
        posts[m.id].trial = m.media_product_type === 'REELS' && m.is_shared_to_feed === false;
      }
      url = stop ? null : r.paging?.next;
    }
  } catch { /* тамбнейлсіз де жұмыс істейді */ }
  return { posts: Object.values(posts), syncedAt: media.reduce((a, m) => (m.synced_at > a ? m.synced_at : a), '') };
}
