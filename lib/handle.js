// Webhook оқиғаларын өңдеу.
import { cfg } from './config.js';
import { decrypt } from './crypto.js';
import * as db from './db.js';
import * as ig from './ig.js';
import { pickFlow, extractPhone } from './match.js';
import { tg } from './tg.js';

// Payload-тан оқиғаларды бөліп алу (тест үшін бөлек).
export function parseEvents(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const ch of entry.changes || []) {
      if (ch.field === 'comments' && ch.value?.id) {
        out.push({
          type: 'comment',
          igUserId: String(entry.id),
          commentId: String(ch.value.id),
          fromId: String(ch.value.from?.id || ''),
          fromUsername: ch.value.from?.username || null,
          mediaId: ch.value.media?.id || null,
          text: ch.value.text || '',
        });
      }
    }
    for (const m of entry.messaging || []) {
      if (m.postback?.payload) {
        out.push({
          type: 'postback',
          igUserId: String(entry.id),
          fromId: String(m.sender?.id || ''),
          payload: String(m.postback.payload),
          title: m.postback.title || '',
        });
      } else if (m.message?.text && !m.message.is_echo) {
        out.push({
          type: 'message',
          igUserId: String(entry.id),
          fromId: String(m.sender?.id || ''),
          mid: m.message.mid,
          text: m.message.text,
        });
      }
    }
  }
  return out;
}

async function tokenFor(igUserId) {
  const acc = await db.getAccount(igUserId);
  if (!acc) return null;
  return { acc, token: decrypt(acc.access_token, cfg.encKey) };
}

// Сценарийлер базадағы flows кестесінде; кесте бос болса env-тегі «+» сценарийі.
export async function loadFlows() {
  const flows = await db.listFlows().catch(() => []);
  if (flows.length) return flows;
  return [{ id: null, keywords: cfg.triggers, dm_text: cfg.dmText, public_reply: cfg.publicReply }];
}

export async function handleComment(ev, flows) {
  if (ev.fromId === ev.igUserId) return 'own'; // өз жауабымызға реакция жасамаймыз
  const own = (flows || (await loadFlows())).filter((f) => !(f.skip_accounts || []).includes(ev.igUserId));
  const flow = pickFlow(ev.text, own);
  if (!flow) return 'no-match';

  const claimed = await db.claimComment({
    comment_id: ev.commentId,
    ig_user_id: ev.igUserId,
    from_id: ev.fromId,
    from_username: ev.fromUsername,
    media_id: ev.mediaId,
    text: ev.text.slice(0, 500),
    flow_id: flow.id,
  });
  if (!claimed) return 'duplicate';

  const t = await tokenFor(ev.igUserId);
  if (!t) {
    await db.updateLog(ev.commentId, { status: 'error', error: 'account not connected' });
    return 'no-account';
  }

  const sentLastHour = await db.countSentSince(ev.igUserId, new Date(Date.now() - 3600e3).toISOString());
  if (sentLastHour >= cfg.hourlyLimit) {
    await db.updateLog(ev.commentId, { status: 'rate_limited' });
    await tg(`⚠️ Сағаттық лимит (${cfg.hourlyLimit}) толды — @${ev.fromUsername || ev.fromId} DM алмады.`);
    return 'rate_limited';
  }

  try {
    const msg = ig.buildMessage(flow.dm_text, flow.dm_buttons, `f${flow.id}`);
    await ig.sendPrivateReply(ev.igUserId, ev.commentId, msg, t.token);
  } catch (e) {
    await db.updateLog(ev.commentId, { status: 'error', error: e.message.slice(0, 1000) });
    throw e;
  }
  await db.updateLog(ev.commentId, { status: 'sent', sent_at: new Date().toISOString() });

  if (flow.public_reply) {
    try {
      await ig.replyToComment(ev.commentId, flow.public_reply, t.token);
    } catch (e) {
      // DM кетті — ашық жауаптың қатесі маңызды емес, бірақ тіркейміз
      await db.addError('public_reply', e.message);
    }
  }
  return 'sent';
}

export async function handleMessage(ev) {
  if (ev.fromId === ev.igUserId) return 'own';
  const phone = extractPhone(ev.text);
  if (!phone) return 'no-phone';

  const t = await tokenFor(ev.igUserId).catch(() => null);
  const prof = t ? await ig.getUsername(ev.fromId, t.token) : {};
  const who = prof.username ? `@${prof.username}` : `id ${ev.fromId}`;
  const flow = await db.lastFlowForUser(ev.igUserId, ev.fromId, prof.username).catch(() => null);
  const tag = flow?.lead_tag || null;
  const answers = await db.recentAnswers(ev.igUserId, ev.fromId).catch(() => []);
  const picked = answers.filter((a) => !flow || a.flow_id === flow.id).map((a) => a.title);

  await db.addLead({
    ig_user_id: ev.igUserId,
    from_id: ev.fromId,
    from_username: prof.username || null,
    phone,
    message: ev.text.slice(0, 1000),
    tag,
  });
  const acc = t?.acc?.username ? ` (@${t.acc.username})` : '';
  const tagLine = tag ? `🏷 ${tag}\n` : '';
  const src = flow ? `Воронка: ${flow.name}\n` : '';
  const ans = picked.length ? `Жауаптары: ${picked.join(' → ')}\n` : '';
  if (flow?.phone_reply && t) {
    await ig.sendMessage(ev.igUserId, ev.fromId, { text: flow.phone_reply }, t.token).catch((e) => db.addError('phone_reply', e.message));
  }
  await tg(`📞 Жаңа нөмір${acc}\n${tagLine}${src}${ans}${phone}\n${who}${prof.name ? ' — ' + prof.name : ''}\n\n«${ev.text.slice(0, 300)}»`);
  return 'lead';
}

// Батырмалар ағашы: {title, reply?, text?, buttons?}. payload "f<flowId>:0.2" — әр деңгейдегі индекс.
export function findButton(flow, path) {
  let node = { buttons: flow?.dm_buttons };
  for (const i of path.split('.')) node = node?.buttons?.[Number(i)];
  return node || null;
}

// DM-дегі батырма басылды → reply (жай мәтін, сілтеме басылатындай), сосын келесі сұрақ батырмаларымен.
export async function handlePostback(ev) {
  const m = /^f(\d+):(\d+(?:\.\d+)*)$/.exec(ev.payload);
  if (!m) return 'unknown-postback';
  const flow = (await loadFlows()).find((f) => String(f.id) === m[1]);
  const btn = findButton(flow, m[2]);
  if (!btn) return 'unknown-button';
  const t = await tokenFor(ev.igUserId);
  if (!t) return 'no-account';
  await db.addAnswer({ ig_user_id: ev.igUserId, from_id: ev.fromId, flow_id: flow.id, path: m[2], title: btn.title });
  if (btn.reply) await ig.sendMessage(ev.igUserId, ev.fromId, { text: btn.reply }, t.token);
  if (btn.text) {
    await ig.sendMessage(ev.igUserId, ev.fromId, ig.buildMessage(btn.text, btn.buttons, ev.payload), t.token);
  }
  return 'postback';
}

const handlers = { comment: handleComment, message: handleMessage, postback: handlePostback };

export async function processPayload(payload) {
  const results = [];
  const events = parseEvents(payload);
  const flows = events.some((e) => e.type === 'comment') ? await loadFlows() : [];
  for (const ev of events) {
    try {
      results.push(await handlers[ev.type](ev, flows));
    } catch (e) {
      results.push('error');
      await db.addError(ev.type, e.message);
      await tg(`🚨 agartu-dm қатесі (${ev.type}):\n${e.message.slice(0, 500)}`);
    }
  }
  return results;
}
