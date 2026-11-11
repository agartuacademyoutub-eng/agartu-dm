// Батырма басып, бірақ нөмір қалдырмаған адамға бір реттік еске салу (мыс. жеңілдік туралы).
// Instagram ережесі: адам соңғы рет әрекет еткеннен (батырма басу да кіреді) кейін 24 сағат ішінде ғана жаза аламыз,
// сондықтан followup_after_min өткен соң, бірақ 23.5 сағаттан бұрын жібереміз.
import * as db from './db.js';
import * as ig from './ig.js';

const WINDOW_MS = 23.5 * 3600e3;

export async function runFollowups(acc, token, flows) {
  const sent = [];
  for (const flow of flows.filter((f) => f.id && f.followup_text)) {
    const after = (flow.followup_after_min ?? 1200) * 60e3;
    const now = Date.now();
    const taps = await db.rest(
      `dm_answers?ig_user_id=eq.${acc.ig_user_id}&flow_id=eq.${flow.id}&created_at=gte.${new Date(now - WINDOW_MS).toISOString()}&select=from_id,created_at&order=created_at.desc`,
    );
    // Әр адамның соңғы басуы: соңғы әрекеттен бері after өтпесе — әлі ерте
    const last = new Map();
    for (const t of taps) if (!last.has(t.from_id)) last.set(t.from_id, Date.parse(t.created_at));
    for (const [fromId, at] of last) {
      if (now - at < after) continue;
      const enc = encodeURIComponent(fromId);
      if ((await db.rest(`phone_leads?ig_user_id=eq.${acc.ig_user_id}&from_id=eq.${enc}&select=id&limit=1`)).length) continue;
      const claimed = await db.rest('dm_followups?on_conflict=ig_user_id,from_id,flow_id', {
        method: 'POST',
        body: { ig_user_id: acc.ig_user_id, from_id: fromId, flow_id: flow.id },
        prefer: 'resolution=ignore-duplicates,return=representation',
      });
      if (!claimed.length) continue; // бұрын жіберілген
      try {
        await ig.sendMessage(acc.ig_user_id, fromId, { text: flow.followup_text }, token);
        sent.push(fromId);
      } catch (e) {
        await db.rest(`dm_followups?ig_user_id=eq.${acc.ig_user_id}&from_id=eq.${enc}&flow_id=eq.${flow.id}`, {
          method: 'PATCH',
          body: { error: e.message.slice(0, 500) },
        });
      }
    }
  }
  return sent;
}
