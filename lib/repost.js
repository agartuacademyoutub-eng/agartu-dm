// Ескі Reels-ті пробный Reels етіп қайта салу: күніне daily (cfg.repostDaily), Алматы 09–23, күн бойы біркелкі (кемі GAP_MIN).
// Түпнұсқа тек Instagram-да (720p) — 1080x1920-ға үлкейтіп, жоғары битрейтпен жүктейміз, сонда IG қайта сыққанда сапа түспейді.
// Instagram файлды сілтемеден алады: Supabase Storage (public "repost" bucket) уақытша, жарияланған соң өшеді.
// Бір шақыруда бір қадам: не дайын контейнерді жариялаймыз, не келесі видеоны дайындаймыз.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cfg } from './config.js';
import { decrypt } from './crypto.js';
import { rest } from './db.js';
import { mvhdSeconds } from './funnel.js';

const GAP_MIN = 80;
const HOURS = [9, 23]; // Алматы уақыты
const TZ_MS = 5 * 3600e3;
const G = () => `https://graph.instagram.com/${cfg.graphVersion}`;
const S = () => `${cfg.supabaseUrl}/storage/v1`;
const SH = () => ({ apikey: cfg.supabaseKey, Authorization: `Bearer ${cfg.supabaseKey}` });

async function api(p, token, form) {
  const res = await fetch(`${G()}/${p}`, {
    method: form ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}` },
    body: form ? new URLSearchParams(form) : undefined,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.error) throw new Error(j.error ? `${p.split('?')[0]}: ${j.error.code}/${j.error.error_subcode || ''} ${j.error.message}` : String(res.status));
  return j;
}

const patch = (id, body) =>
  rest(`repost_queue?source_id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: { ...body, updated_at: new Date().toISOString() } });
const dropFile = (key) => key && fetch(`${S()}/object/repost/${key}`, { method: 'DELETE', headers: SH() }).catch(() => {});

// Supabase Storage бір файлға 50 МБ қабылдайды: битрейтті ұзақтыққа қарай шектейміз (45 МБ, ең көбі 8 Мбит/с)
async function upscale(src, dst) {
  const ffmpeg = (await import('ffmpeg-static')).default;
  const sec = mvhdSeconds(fs.readFileSync(src)) || 90;
  const kbps = Math.min(8000, Math.floor((45e6 * 8) / sec / 1000) - 200);
  await promisify(execFile)(ffmpeg, ['-y', '-v', 'error', '-i', src, '-vf', 'scale=1080:1920:flags=lanczos,unsharp=5:5:0.35',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '16', '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`, // fast 90 с видеоға ~250 с алды (лимит 300) '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
    '-c:a', 'aac', '-b:a', '192k', dst], { maxBuffer: 16e6 });
}

// Күйі: { action, ... } — watch/cron есебі үшін
// prepare=false — тек дайын контейнерді жариялаймыз (бір шақыруда бір аккаунт қана видео өңдейді, 300 с лимит)
export async function repostStep(acc, { daily, force = false, prepare = true } = {}) {
  const token = decrypt(acc.access_token, cfg.encKey);
  const q = (f) => rest(`repost_queue?ig_user_id=eq.${acc.ig_user_id}&${f}`);

  // 1) IG өңдеп жатқан контейнер болса — дайын ба, жариялаймыз
  const [pending] = await q('status=eq.container&select=*&limit=1');
  if (pending && !pending.container_id) {
    // Дайындау кезінде функция үзілді (300 с лимит): 10 минуттан кейін өткізіп, келесіге көшеміз
    if (Date.now() - new Date(pending.started_at).getTime() < 10 * 60e3) return { action: 'preparing' };
    await dropFile(pending.storage_key);
    await patch(pending.source_id, { status: 'error', error: 'дайындау үзілді (уақыт лимиті)', storage_key: null });
    return { action: 'error', source: pending.source_permalink, error: 'timeout' };
  }
  if (pending) {
    const s = await api(`${pending.container_id}?fields=status_code,status`, token);
    if (s.status_code === 'FINISHED') {
      const p = await api(`${acc.ig_user_id}/media_publish`, token, { creation_id: pending.container_id });
      const m = await api(`${p.id}?fields=permalink`, token).catch(() => ({}));
      await dropFile(pending.storage_key);
      await patch(pending.source_id, { status: 'done', new_media_id: p.id, new_permalink: m.permalink || null, published_at: new Date().toISOString(), storage_key: null });
      return { action: 'published', source: pending.source_permalink, permalink: m.permalink };
    }
    const stale = Date.now() - new Date(pending.started_at).getTime() > 3 * 3600e3;
    if (s.status_code === 'ERROR' || s.status_code === 'EXPIRED' || stale) {
      await dropFile(pending.storage_key);
      await patch(pending.source_id, { status: 'error', error: `container ${s.status_code}: ${s.status || ''}`.slice(0, 500), storage_key: null });
      return { action: 'error', source: pending.source_permalink, error: s.status_code };
    }
    return { action: 'waiting', status: s.status_code };
  }

  // 2) Келесі видеоны бастау керек пе: уақыт терезесі, күндік лимит, аралық
  if (!prepare) return { action: 'deferred' };
  const gap = cfg.repostGap[acc.username] || Math.max(GAP_MIN, Math.floor(((HOURS[1] - HOURS[0]) * 60) / daily));
  const local = new Date(Date.now() + TZ_MS);
  const hour = local.getUTCHours();
  if (!force && (hour < HOURS[0] || hour >= HOURS[1])) return { action: 'off_hours' };
  const dayStart = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - TZ_MS).toISOString();
  const today = await q(`status=eq.done&published_at=gte.${encodeURIComponent(dayStart)}&select=published_at&order=published_at.desc`);
  if (!force && today.length >= daily) return { action: 'daily_limit', today: today.length };
  if (!force && today[0] && Date.now() - new Date(today[0].published_at).getTime() < gap * 60e3) return { action: 'gap', today: today.length };

  const [next] = await q('status=eq.queued&select=*&order=rank.desc.nullslast&limit=1');
  if (!next) return { action: 'queue_empty' };
  await patch(next.source_id, { status: 'container', started_at: new Date().toISOString(), container_id: null });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repost-'));
  let key = null;
  try {
    const m = await api(`${next.source_id}?fields=caption,media_url,media_product_type,is_shared_to_feed`, token);
    if (m.media_product_type !== 'REELS' || m.is_shared_to_feed === false || !m.media_url) {
      await patch(next.source_id, { status: 'skip', error: 'Reels емес немесе бұрын пробный' });
      return { action: 'skip', source: next.source_permalink };
    }
    const src = path.join(dir, 'in.mp4'), dst = path.join(dir, 'out.mp4');
    fs.writeFileSync(src, Buffer.from(await (await fetch(m.media_url)).arrayBuffer()));
    await upscale(src, dst);
    key = `${next.source_id}-${Date.now()}.mp4`;
    const up = await fetch(`${S()}/object/repost/${key}`, { method: 'POST', headers: { ...SH(), 'Content-Type': 'video/mp4' }, body: fs.readFileSync(dst) });
    if (!up.ok) throw new Error(`storage ${up.status} ${(await up.text()).slice(0, 200)}`);
    const c = await api(`${acc.ig_user_id}/media`, token, {
      media_type: 'REELS',
      video_url: `${S()}/object/public/repost/${key}`,
      caption: m.caption || '',
      share_to_feed: 'false',
      trial_params: JSON.stringify({ graduation_strategy: 'MANUAL' }),
    });
    await patch(next.source_id, { container_id: c.id, storage_key: key });
    return { action: 'started', source: next.source_permalink };
  } catch (e) {
    await dropFile(key);
    await patch(next.source_id, { status: 'error', error: e.message.slice(0, 500), storage_key: null });
    throw e;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
