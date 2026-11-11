// Instagram статистикасы (instagram_business_basic + instagram_business_manage_insights).
// Әр метриканы бөлек сұраймыз: біреуі қате берсе (рұқсат жоқ, тип сәйкес емес) қалғаны бәрібір келеді.
import { cfg } from './config.js';

const G = () => `https://graph.instagram.com/${cfg.graphVersion}`;
const ALMATY_MS = 5 * 3600e3;

async function get(path, token) {
  const res = await fetch(`${G()}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error ? `${json.error.code} ${json.error.message}` : String(res.status));
  return json;
}

// Алматы күні: offset=0 — бүгін, -1 — кеше. since/until — unix секунд.
export function almatyDay(offset = 0) {
  const local = new Date(Date.now() + ALMATY_MS);
  local.setUTCHours(0, 0, 0, 0);
  local.setUTCDate(local.getUTCDate() + offset);
  const since = (local.getTime() - ALMATY_MS) / 1000;
  return { day: local.toISOString().slice(0, 10), since, until: since + 86400 };
}

export function profile(token) {
  return get('me?fields=user_id,username,name,profile_picture_url,followers_count,follows_count,media_count', token);
}

const DAY_METRICS = [
  'reach', 'views', 'accounts_engaged', 'total_interactions',
  'likes', 'comments', 'shares', 'saves', 'profile_links_taps',
];

// Бір күндегі аккаунт метрикалары. Рұқсат жоқ болса { error } қайтарады.
export async function accountDay(igUserId, token, since, until) {
  const out = {};
  let lastError = null;
  await Promise.all(
    DAY_METRICS.map(async (m) => {
      try {
        const r = await get(`${igUserId}/insights?metric=${m}&period=day&metric_type=total_value&since=${since}&until=${until}`, token);
        out[m] = r.data?.[0]?.total_value?.value ?? null;
      } catch (e) {
        lastError = e.message;
      }
    }),
  );
  try {
    const r = await get(
      `${igUserId}/insights?metric=follows_and_unfollows&period=day&metric_type=total_value&breakdown=follow_type&since=${since}&until=${until}`,
      token,
    );
    const res = r.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
    const pick = (t) => res.find((x) => x.dimension_values?.[0] === t)?.value ?? 0;
    out.new_followers = pick('FOLLOWER');
    out.unfollows = pick('NON_FOLLOWER');
  } catch (e) {
    lastError = e.message;
  }
  if (!Object.keys(out).length) return { error: lastError };
  return out;
}

const MEDIA_METRICS = ['reach', 'views', 'likes', 'comments', 'shares', 'saved', 'total_interactions'];

// Соңғы посттар + әрқайсысының insights-ы.
export async function recentMedia(token, limit = 24) {
  const list = await get(
    `me/media?fields=id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp,like_count,comments_count,is_shared_to_feed&limit=${limit}`,
    token,
  );
  return Promise.all(
    (list.data || []).map(async (m) => {
      const metrics = m.media_product_type === 'REELS' ? [...MEDIA_METRICS, 'ig_reels_avg_watch_time'] : MEDIA_METRICS;
      const ins = {};
      await Promise.all(
        metrics.map(async (k) => {
          try {
            const r = await get(`${m.id}/insights?metric=${k}`, token);
            ins[k] = r.data?.[0]?.values?.[0]?.value ?? r.data?.[0]?.total_value?.value ?? null;
          } catch {
            /* бұл метрика бұл типке жоқ немесе рұқсат жоқ */
          }
        }),
      );
      return {
        id: m.id,
        type: m.media_product_type === 'REELS' ? 'REELS' : m.media_type,
        trial: m.media_product_type === 'REELS' && m.is_shared_to_feed === false, // пробный Reels
        caption: (m.caption || '').slice(0, 140),
        permalink: m.permalink,
        thumb: m.thumbnail_url || m.media_url,
        timestamp: m.timestamp,
        likes: ins.likes ?? m.like_count ?? 0,
        comments: ins.comments ?? m.comments_count ?? 0,
        reach: ins.reach ?? null,
        views: ins.views ?? null,
        shares: ins.shares ?? null,
        saves: ins.saved ?? null,
        interactions: ins.total_interactions ?? null,
        avg_watch_ms: ins.ig_reels_avg_watch_time ?? null,
      };
    }),
  );
}
