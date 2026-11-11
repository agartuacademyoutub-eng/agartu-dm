// Сторис статистикасы: IG белсенді (24 сағаттық) сторисьтің ғана insights-ын береді,
// сондықтан watch cron сағат сайын жинап, story_stats-қа жаңартып отырады.
import { cfg } from './config.js';
import { decrypt } from './crypto.js';
import { rest } from './db.js';

const G = () => `https://graph.instagram.com/${cfg.graphVersion}`;
const METRICS = ['reach', 'views', 'replies', 'shares', 'total_interactions', 'follows', 'profile_visits'];

async function get(path, token) {
  const res = await fetch(`${G()}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error ? `${json.error.code} ${json.error.message}` : String(res.status));
  return json;
}

const val = (d) => d?.values?.[0]?.value ?? d?.total_value?.value ?? null;

export async function collectStories(acc) {
  const token = decrypt(acc.access_token, cfg.encKey);
  const list = await get('me/stories?fields=id,timestamp,media_type,permalink', token);
  let n = 0;
  for (const s of list.data || []) {
    const row = { story_id: s.id, ig_user_id: acc.ig_user_id, posted_at: s.timestamp, media_type: s.media_type, permalink: s.permalink, updated_at: new Date().toISOString() };
    try {
      const r = await get(`${s.id}/insights?metric=${METRICS.join(',')}`, token);
      const by = Object.fromEntries((r.data || []).map((d) => [d.name, val(d)]));
      Object.assign(row, { reach: by.reach, views: by.views, replies: by.replies, shares: by.shares, interactions: by.total_interactions, follows: by.follows, profile_visits: by.profile_visits });
      const nav = await get(`${s.id}/insights?metric=navigation&breakdown=story_navigation_action_type&metric_type=total_value`, token);
      for (const b of nav.data?.[0]?.total_value?.breakdowns?.[0]?.results || []) {
        const k = b.dimension_values?.[0];
        if (['tap_forward', 'tap_back', 'tap_exit', 'swipe_forward'].includes(k)) row[k] = b.value;
      }
    } catch {
      continue; // жаңа сторис — insights әлі дайын емес; келесі сағатта аламыз
    }
    await rest('story_stats?on_conflict=story_id', { method: 'POST', body: row, prefer: 'resolution=merge-duplicates' });
    n++;
  }
  return n;
}
