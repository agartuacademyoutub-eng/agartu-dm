// GitHub Actions-та пробный қайта салу (Supabase Edge-те ffmpeg жоқ): api/cron/repost қадамын минут сайын қайталаймыз.
// GitHub schedule шамамен сағатына бір рет қана іске қосады, сондықтан бір run ~55 мин жұмыс істеп, аралығы біткен
// аккаунтқа бірден келесі видеоны салады. Бәрінде күндік лимит/түн/кезек бос болса — ерте тоқтаймыз.
import { GET } from '../api/cron/repost.js';
import { cfg } from '../lib/config.js';

const step = async () =>
  (await GET(new Request('http://local/api/cron/repost?all=1', { headers: { authorization: `Bearer ${cfg.cronSecret}` } }))).json();

const end = Date.now() + 55 * 60e3;
while (Date.now() < end) {
  const { report = [] } = await step();
  console.log(new Date().toISOString(), JSON.stringify(report));
  if (report.every((r) => ['daily_limit', 'off_hours', 'queue_empty', 'api_down'].includes(r.action))) break;
  await new Promise((r) => setTimeout(r, 60e3));
}
