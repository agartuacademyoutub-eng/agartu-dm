import { cfg } from '../lib/config.js';
import { safeEqual } from '../lib/crypto.js';
import * as db from '../lib/db.js';
import { funnelReport } from '../lib/funnel.js';
import * as ct from '../lib/content.js';
import * as au from '../lib/audience.js';
import { advise } from '../lib/advice.js';

// Толық дашборд (/dashboard) үшін дерек: /api/dashboard?key=<STATS_KEY>&account=<username>
// 180 күн жібереміз — бет 7/30/90 күнді және алдыңғы кезеңмен салыстыруды өзі есептейді.
const DAYS = 180;
const ALMATY_MS = 5 * 3600e3;
const almatyDate = (iso) => new Date(new Date(iso).getTime() + ALMATY_MS).toISOString().slice(0, 10);

export async function GET(request) {
  const u = new URL(request.url);
  if (!safeEqual(u.searchParams.get('key'), cfg.statsKey)) return Response.json({ error: 'forbidden' }, { status: 403 });
  const accounts = await db.listAccounts();
  const acc = accounts.find((a) => a.username === u.searchParams.get('account')) || accounts.find((a) => a.username === cfg.mainAccount) || accounts[0];
  if (!acc) return Response.json({ error: 'Аккаунт қосылмаған' }, { status: 404 });

  const since = new Date(Date.now() - DAYS * 864e5).toISOString();
  const [{ posts }, stats, comments, stories, demo, queue] = await Promise.all([
    funnelReport(acc, DAYS),
    db.rest(`ig_stats_daily?ig_user_id=eq.${acc.ig_user_id}&day=gte.${almatyDate(since)}&select=*&order=day.asc`),
    db.rest(`funnel_comments?ig_user_id=eq.${acc.ig_user_id}&created_at=gte.${since}&select=from_id,media_id,created_at,is_lead,phone_at&limit=100000`),
    db.rest(`story_stats?ig_user_id=eq.${acc.ig_user_id}&posted_at=gte.${since}&select=*&order=posted_at.desc`),
    au.demographics(acc).catch(() => ({})),
    db.rest(`repost_queue?ig_user_id=eq.${acc.ig_user_id}&select=status,source_permalink,new_permalink,published_at&order=published_at.desc.nullslast&limit=2000`),
  ]);

  // Күн сайын: «+» жазған бірегей адам (коммент күні) және нөмір (нөмір күні)
  const perDay = {};
  const seen = new Set();
  for (const c of comments) {
    const d = almatyDate(c.created_at);
    const k = d + c.media_id + c.from_id;
    const o = (perDay[d] ||= { people: 0, leads: 0 });
    if (!seen.has(k)) { seen.add(k); o.people++; }
    if (c.is_lead && c.phone_at) (perDay[almatyDate(c.phone_at)] ||= { people: 0, leads: 0 }).leads++;
  }

  const named = (obj, nameFn) => Object.fromEntries(Object.entries(obj || {}).map(([k, v]) => [nameFn ? nameFn(k) : k, v]));
  const audience = {};
  for (const [kind, b] of Object.entries(demo || {})) {
    audience[kind] = {
      gender: named(b.gender, (k) => au.GENDER[k] || k),
      age: b.age || {},
      country: named(b.country, au.countryName),
      city: named(b.city, au.cityName),
    };
  }

  const count = (s) => queue.filter((q) => q.status === s).length;
  const body = {
      username: acc.username,
      accounts: accounts.map((a) => a.username),
      generatedAt: new Date().toISOString(),
      posts: posts.map((p) => ({
        id: p.media_id, at: p.posted_at, day: almatyDate(p.posted_at), type: p.trial ? 'TRIAL' : p.media_type, permalink: p.permalink,
        title: (p.caption || '').split('\n')[0].trim().slice(0, 140) || '(жазусыз)', thumb: p.thumb || null,
        reach: p.reach, views: p.views, likes: p.likes, comments: p.comments_total, saves: p.saves, shares: p.shares,
        people: p.people, leads: p.leads, flows: p.flows, flowLeads: p.flowLeads,
        duration: p.duration_s, retention: ct.retention(p), skip: p.skip_rate, avgWatch: p.avg_watch_ms == null ? null : p.avg_watch_ms / 1000,
        topic: ct.topicOf(p.caption), cta: ct.ctaOf(p.caption), slot: ct.slotOf(p.posted_at), weekday: ct.weekdayOf(p.posted_at), durBucket: ct.durationOf(p),
      })),
      days: stats.map(({ ig_user_id, updated_at, ...s }) => ({ ...s, people: perDay[s.day]?.people || 0, leads: perDay[s.day]?.leads || 0 })),
      stories: stories.map((s) => ({
        at: s.posted_at, type: s.media_type, permalink: s.permalink, reach: s.reach, views: s.views, replies: s.replies, shares: s.shares,
        profile: s.profile_visits, follows: s.follows, forward: s.tap_forward, back: s.tap_back, exit: s.tap_exit, next: s.swipe_forward,
      })),
      audience,
      repost: cfg.repostDaily[acc.username] ? {
        daily: cfg.repostDaily[acc.username], done: count('done'), queued: count('queued'), skip: count('skip'), error: count('error'),
        last: queue.filter((q) => q.status === 'done').slice(0, 6).map((q) => ({ at: q.published_at, src: q.source_permalink, link: q.new_permalink })),
      } : null,
      meta: { slots: ct.SLOTS, weekdays: ct.WEEKDAYS, durations: ct.DURATIONS, ages: au.AGES },
  };
  body.advice = advise(body);
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
