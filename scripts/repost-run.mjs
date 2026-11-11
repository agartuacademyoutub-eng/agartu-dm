// GitHub Actions-та пробный қайта салу (Supabase Edge-те ffmpeg жоқ): api/cron/repost қадамын
// контейнер дайын болып жарияланғанша минут сайын қайталаймыз (ең көбі ~15 мин).
import { GET } from '../api/cron/repost.js';
import { cfg } from '../lib/config.js';

const step = async () =>
  (await GET(new Request('http://local/api/cron/repost', { headers: { authorization: `Bearer ${cfg.cronSecret}` } }))).json();

for (let i = 0; i < 15; i++) {
  const { report = [] } = await step();
  console.log(new Date().toISOString(), JSON.stringify(report));
  if (!report.some((r) => ['started', 'waiting', 'preparing'].includes(r.action))) break;
  await new Promise((r) => setTimeout(r, 60e3));
}
