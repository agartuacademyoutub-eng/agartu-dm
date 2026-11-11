// Пробный қайта салу кезегін толтырады: node scripts/repost-seed.mjs [username]
// Аккаунттың (әдепкі — негізгі) лентадағы барлық Reels-і (бұрын пробный болғандары кірмейді), rank = reach.
// Қайта іске қосуға болады: бар жолдар өзгермейді, тек жаңа видеолар қосылады.
import fs from 'node:fs';

for (const l of fs.readFileSync('.env.local', 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  if (/^[A-Z0-9_]+=/.test(l)) process.env[l.slice(0, l.indexOf('='))] = l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '');
}
const { cfg } = await import('../lib/config.js');
const db = await import('../lib/db.js');
const { decrypt } = await import('../lib/crypto.js');

const name = process.argv[2];
const acc = name ? (await db.listAccounts()).find((a) => a.username === name) : await db.mainAccount();
if (!acc) throw new Error(`@${name} ботқа қосылмаған`);
const token = decrypt(acc.access_token, cfg.encKey);
const G = `https://graph.instagram.com/${cfg.graphVersion}`;
const get = async (p) => (await fetch(`${G}/${p}${p.includes('?') ? '&' : '?'}access_token=${token}`)).json();

const known = new Map((await db.rest(`funnel_media?ig_user_id=eq.${acc.ig_user_id}&select=media_id,reach`)).map((r) => [r.media_id, r.reach]));
const reels = [];
let page = await get(`${acc.ig_user_id}/media?fields=id,permalink,timestamp,media_product_type,is_shared_to_feed&limit=100`);
while (page?.data) {
  reels.push(...page.data.filter((m) => m.media_product_type === 'REELS' && m.is_shared_to_feed !== false));
  page = page.paging?.next ? await (await fetch(page.paging.next)).json() : null;
}
for (const m of reels) {
  if (known.get(m.id) == null) {
    const j = await get(`${m.id}/insights?metric=reach`);
    known.set(m.id, j.data?.[0]?.values?.[0]?.value ?? null);
  }
}
const rows = reels.map((m) => ({
  source_id: m.id, ig_user_id: acc.ig_user_id, source_permalink: m.permalink, source_posted_at: m.timestamp, rank: known.get(m.id),
}));
for (let i = 0; i < rows.length; i += 200) {
  await db.rest('repost_queue?on_conflict=source_id', { method: 'POST', body: rows.slice(i, i + 200), prefer: 'resolution=ignore-duplicates' });
}
console.log(`@${acc.username}: ${rows.length} Reels кезекте`);
