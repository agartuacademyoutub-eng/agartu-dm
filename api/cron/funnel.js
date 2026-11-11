import { cfg } from '../../lib/config.js';
import { safeEqual } from '../../lib/crypto.js';
import * as db from '../../lib/db.js';
import { syncComments, syncPhones } from '../../lib/funnel.js';

// Күнде 03:00 UTC: соңғы 14 күндегі посттардың комменттері + 30 күндік комментаторлардың Директі.
export async function GET(request) {
  if (!safeEqual(request.headers.get('authorization'), `Bearer ${cfg.cronSecret}`)) {
    return new Response('forbidden', { status: 403 });
  }
  const out = [];
  for (const acc of await db.listAccounts()) {
    try {
      const c = await syncComments(acc, 14);
      const p = await syncPhones(acc, { days: 30, recheckHours: 20, limit: 3000 });
      out.push({ account: acc.username, ...c, ...p });
    } catch (e) {
      await db.addError('funnel_sync', e.message);
      out.push({ account: acc.username, error: e.message });
    }
  }
  return Response.json({ ok: true, out });
}
