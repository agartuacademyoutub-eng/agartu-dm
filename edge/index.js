// Supabase Edge Function «api»: Vercel-дегі api/*.js-ті бір функцияда жолы бойынша шақырамыз.
// URL: https://<ref>.supabase.co/functions/v1/api/<жол>, мыс. /functions/v1/api/webhook
// Бет (dashboard.html т.б.) — GitHub Pages-та; ол осы API-ді CORS арқылы шақырады.
import './shim.js';
import * as webhook from './api/webhook.js';
import * as telegram from './api/telegram.js';
import * as authStart from './api/auth/start.js';
import * as authCallback from './api/auth/callback.js';
import * as dashboard from './api/dashboard.js';
import * as stats from './api/stats.js';
import * as funnel from './api/funnel.js';
import * as deauthorize from './api/deauthorize.js';
import * as watch from './api/cron/watch.js';
import * as health from './api/cron/health.js';
import * as funnelCron from './api/cron/funnel.js';

const routes = {
  webhook, telegram, deauthorize, dashboard, stats, funnel,
  'auth/start': authStart,
  'auth/callback': authCallback,
  'cron/watch': watch,
  'cron/health': health,
  'cron/funnel': funnelCron,
};

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type' };

export async function handle(request) {
  if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const path = new URL(request.url).pathname.replace(/^.*?\/api\/?/, '').replace(/\/$/, '');
  const fn = routes[path]?.[request.method];
  if (!fn) return new Response('not found', { status: 404 });
  const res = await fn(request);
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
  return out;
}

Deno.serve(handle);
