// Instagram API (Instagram Login арқылы, FB Page керек емес)
import { cfg } from './config.js';

const G = () => `https://graph.instagram.com/${cfg.graphVersion}`;

async function call(url, { method = 'GET', token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  } else if (form) {
    payload = new URLSearchParams(form);
  }
  const res = await fetch(url, { method, headers, body: payload });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const msg = json.error ? `${json.error.code}/${json.error.error_subcode || ''} ${json.error.message}` : res.status;
    throw new Error(`IG ${method} ${url.split('?')[0].replace(/^https:\/\/[^/]+/, '')}: ${msg}`);
  }
  return json;
}

// Мәтін, батырма болса — button template (payload: "f4" → "f4:0", "f4:0" → "f4:0.1").
export function buildMessage(text, buttons, prefix) {
  if (!buttons?.length) return { text };
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'button',
        text,
        buttons: buttons.slice(0, 3).map((b, i) => ({ type: 'postback', title: b.title, payload: prefix.includes(':') ? `${prefix}.${i}` : `${prefix}:${i}` })),
      },
    },
  };
}

// Комментке жеке жауап (Директке түседі). 7 күн ішінде, бір комментке бір рет.
export function sendPrivateReply(igUserId, commentId, message, token) {
  return call(`${G()}/${igUserId}/messages`, {
    method: 'POST',
    token,
    body: { recipient: { comment_id: commentId }, message },
  });
}

// Адам бізге жазғаннан/батырма басқаннан кейін 24 сағат ішінде кәдімгі хабарлама.
export function sendMessage(igUserId, recipientId, message, token) {
  return call(`${G()}/${igUserId}/messages`, {
    method: 'POST',
    token,
    body: { recipient: { id: recipientId }, message },
  });
}

export function replyToComment(commentId, text, token) {
  return call(`${G()}/${commentId}/replies`, { method: 'POST', token, form: { message: text } });
}

export function getUsername(userId, token) {
  return call(`${G()}/${userId}?fields=username,name`, { token }).catch(() => ({}));
}

// OAuth: code -> қысқа токен -> 60 күндік токен
export async function exchangeCode(code, redirectUri) {
  const short = await call('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    form: {
      client_id: cfg.igAppId,
      client_secret: cfg.igAppSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    },
  });
  // Кейбір аккаунтқа IG 100 «Unsupported request - method type: get» қайтарады — басқа нұсқаларын да байқаймыз
  const qs = `grant_type=ig_exchange_token&client_secret=${encodeURIComponent(cfg.igAppSecret)}&access_token=${encodeURIComponent(short.access_token)}`;
  const tries = [
    () => call(`https://graph.instagram.com/access_token?${qs}`),
    () => call(`${G()}/access_token?${qs}`),
    () => call(`https://graph.instagram.com/access_token`, { method: 'POST', form: Object.fromEntries(new URLSearchParams(qs)) }),
  ];
  const errs = [];
  for (const t of tries) {
    try {
      const long = await t();
      return { token: long.access_token, expiresIn: long.expires_in };
    } catch (e) {
      errs.push(e.message);
    }
  }
  const me = await call(`${G()}/me?fields=user_id,username,account_type`, { token: short.access_token }).then((m) => JSON.stringify(m)).catch((e) => 'me: ' + e.message);
  throw new Error(`${errs.join(' | ')} | ${me} (user_id ${short.user_id}, permissions ${short.permissions || '—'})`);
}

export function refreshToken(token) {
  return call(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`,
  ).then((r) => ({ token: r.access_token, expiresIn: r.expires_in }));
}

export function getMe(token) {
  return call(`${G()}/me?fields=user_id,username`, { token });
}

export function subscribe(token) {
  return call(`${G()}/me/subscribed_apps?subscribed_fields=comments,messages,messaging_postbacks`, { method: 'POST', token });
}

// Соңғы посттардың жоғарғы деңгейдегі комменттері (webhook жіберіп алғанын табу үшін)
// Ескі посттарға да коммент түседі (мыс. 32-ші пост) — 40 постты параллель қараймыз
export async function recentComments(token, sinceMs, posts = 40) {
  const media = await call(`${G()}/me/media?fields=id&limit=${posts}`, { token });
  const lists = await Promise.all(
    (media.data || []).map((m) =>
      call(`${G()}/${m.id}/comments?fields=id,text,timestamp,from&limit=50`, { token })
        .then((j) => (j.data || []).map((c) => ({ ...c, mediaId: m.id })))
        .catch(() => []),
    ),
  );
  return lists.flat().filter((c) => new Date(c.timestamp).getTime() >= sinceMs);
}
