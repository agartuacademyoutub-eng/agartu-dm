// Маркетолог ұсыныстары: дашборд дерегінен (api/dashboard.js posts/days/stories) ережемен есептеледі.
// Соңғы 14 күн алдыңғы 14 күнмен салыстырылады; тақырып/уақыт/ұзақтық сияқты заңдылықтар — 90 күн бойынша.
// Әр ереже тек дерек жеткілікті болса шығады (аз постпен «заңдылық» айтпаймыз).
import { median } from './content.js';

const DAY = 864e5;
const R = 14;
const sum = (a, f) => a.reduce((s, x) => s + (Number(f(x)) || 0), 0);
const pct = (v) => `${Math.round(v * 100)}%`;
const n = (v) => new Intl.NumberFormat('ru-RU').format(Math.round(v || 0));
const short = (t) => (t.length > 60 ? t.slice(0, 57) + '…' : t);

function bestGroup(posts, keyFn, valFn, minN = 3) {
  const g = {};
  for (const p of posts) { const k = keyFn(p); if (k && k !== 'белгісіз') (g[k] ||= []).push(p); }
  return Object.entries(g).filter(([, ps]) => ps.length >= minN).map(([key, ps]) => ({ key, n: ps.length, v: valFn(ps) }))
    .filter((x) => x.v != null).sort((a, b) => b.v - a.v);
}

export function advise({ posts, days, stories }, now = Date.now()) {
  const out = [];
  const add = (kind, area, title, text, links) => out.push({ kind, area, title, text, links: links || [] });
  const link = (p) => ({ href: p.permalink || null, text: short(p.title) });
  const inRange = (p, from, to) => { const t = Date.parse(p.at); return t >= from && t < to; };
  const cur = posts.filter((p) => inRange(p, now - R * DAY, now + DAY));
  const prev = posts.filter((p) => inRange(p, now - 2 * R * DAY, now - R * DAY));
  const q90 = posts.filter((p) => inRange(p, now - 90 * DAY, now + DAY) && p.type !== 'TRIAL');
  const reels90 = q90.filter((p) => p.type === 'REELS');

  // 1. Конверсия «+» → нөмір
  const pc = sum(cur, (p) => p.people), lc = sum(cur, (p) => p.leads);
  const pp = sum(prev, (p) => p.people), lp = sum(prev, (p) => p.leads);
  if (pc >= 15 && pp >= 15) {
    const c1 = lc / pc, c0 = lp / pp, d = (c1 - c0) * 100;
    if (d <= -5) add('warn', 'Воронка', `Конверсия түсті: ${pct(c0)} → ${pct(c1)}`,
      `Соңғы ${R} күнде «+» жазған ${n(pc)} адамның ${n(lc)}-і ғана нөмір қалдырды. DM мәтінін қысқартып, нөмір сұрауды бірінші сөйлемге шығарыңыз. Менеджер нөмірге 1 сағат ішінде хабарласса, келесі жолы да сенім артады.`);
    else if (d >= 5) add('good', 'Воронка', `Конверсия өсті: ${pct(c0)} → ${pct(c1)}`, `Соңғы ${R} күндегі DM мәтіні мен посттар жақсы жұмыс істеп тұр — қазір сценарий мәтінін өзгертпеңіз.`);
  }
  // Нөмір азайса — қай жерде үзілгенін айтамыз: «+» жазғандар азайды ма (контент/CTA), әлде DM-нен кейін (мәтін/менеджер)
  if (lp >= 5 && lc <= lp * 0.7) add('warn', 'Воронка', `Нөмір азайды: ${n(lp)} → ${n(lc)}`,
    pc < pp * 0.8
      ? `«+» жазғандар да азайды (${n(pp)} → ${n(pc)}). Мәселе контентте: «+» сұрайтын Reels көбірек салыңыз және CTA-ны видеоның өзінде де айтыңыз, тек жазуда емес.`
      : `«+» жазғандар азайған жоқ (${n(pp)} → ${n(pc)}), бірақ нөмірді аз қалдырады. Мәселе DM-нен кейін: соңғы өзгерген DM мәтінін тексеріңіз және менеджер директке тез жауап беріп жүр ме, қараңыз.`);

  // 2. Ең көп нөмір әкелген пост
  const topLead = [...cur].filter((p) => p.leads >= 2).sort((a, b) => b.leads - a.leads)[0];
  if (topLead) add('good', 'Контент', `Ең көп нөмір әкелген пост: ${topLead.leads} нөмір`,
    `«${topLead.topic}» тақырыбы, CTA: ${topLead.cta}. Осы ойды басқа бастамамен (hook) тағы 1–2 видео етіп түсіріңіз — дәлелденген тақырып жаңадан ойлап тапқаннан сенімдірек.`, [link(topLead)]);

  // 3. Көп көрілген, бірақ CTA жоқ посттар — закреп коммент
  const medReach = median(cur.filter((p) => p.type !== 'TRIAL').map((p) => p.reach));
  const noCta = cur.filter((p) => p.type !== 'TRIAL' && p.cta === 'CTA жоқ' && medReach && p.reach >= medReach * 1.5 && p.reach >= 3000)
    .sort((a, b) => b.reach - a.reach).slice(0, 3);
  if (noCta.length) add('idea', 'Воронка', `${noCta.length} көп көрілген постта CTA жоқ`,
    `Бұл посттарды көп адам көрді, бірақ «+» жазуды ешкім сұрамады. Әрқайсысына «Курс туралы білгіңіз келсе, + жазыңыз» деген коммент жазып, оны закрепке қойыңыз — бот ескі посттағы «+»-қа да жауап береді.`, noCta.map(link));

  // 4. Пробныйды профильге шығару
  const medViews = median(reels90.map((p) => p.views));
  const trials = cur.filter((p) => p.type === 'TRIAL' && now - Date.parse(p.at) >= 2 * DAY && p.views >= Math.max(5000, (medViews || 0) * 1.5))
    .sort((a, b) => b.views - a.views).slice(0, 3);
  if (trials.length) add('idea', 'Пробный Reels', `${trials.length} пробный видео жақсы көрілді — профильге шығарыңыз`,
    `Жазылмағандар арасында ${n(trials[0].views)}-ға дейін көрілді (сіздің әдеттегі Reels медианасы ${n(medViews)}). Instagram-да видеоны ашып, «Профильде бөлісу» басыңыз — жазылушыларыңыз да көреді.`, trials.map(link));

  // 5. Тақырып: нөмір / пост
  const topics = bestGroup(q90, (p) => p.topic, (ps) => sum(ps, (p) => p.leads) / ps.length);
  const avgLeads = q90.length ? sum(q90, (p) => p.leads) / q90.length : 0;
  if (topics[0] && avgLeads > 0 && topics[0].v >= avgLeads * 1.5) add('idea', 'Контент', `«${topics[0].key}» тақырыбы көбірек нөмір әкеледі`,
    `90 күнде бұл тақырыптағы ${topics[0].n} пост орта есеппен ${topics[0].v.toFixed(1)} нөмір әкелді, жалпы орташа — ${avgLeads.toFixed(1)}. Аптасына кемінде 2 рет осы тақырыпта салыңыз.`);
  const dead = topics.filter((t) => t.n >= 5 && t.v === 0 && t.key !== topics[0]?.key)[0];
  if (dead) add('idea', 'Контент', `«${dead.key}» нөмір әкелмейді`,
    `90 күнде ${dead.n} пост, бірде-бір нөмір жоқ. Бұл тақырып қамту (reach) үшін керек болса, қалдырыңыз, бірақ соңына курсқа апаратын CTA қосыңыз.`);

  // 6. Жариялау уақыты (медиана reach)
  const all90 = median(q90.map((p) => p.reach));
  const slots = bestGroup(q90, (p) => p.slot, (ps) => median(ps.map((p) => p.reach)));
  const wd = bestGroup(q90, (p) => p.weekday, (ps) => median(ps.map((p) => p.reach)));
  if (slots[0] && all90 && slots[0].v >= all90 * 1.3) add('idea', 'Уақыт', `Ең тиімді уақыт: ${slots[0].key}${wd[0] && wd[0].v >= all90 * 1.2 ? `, әсіресе ${wd[0].key}` : ''}`,
    `Бұл уақытта салынған ${slots[0].n} посттың медиана reach-і ${n(slots[0].v)}, жалпы медиана — ${n(all90)}. Ең күшті видеоңызды осы уақытқа қалдырыңыз.`);

  // 7. Reels ұзақтығы
  const durs = bestGroup(reels90, (p) => p.durBucket, (ps) => median(ps.map((p) => p.views)));
  if (durs[0] && medViews && durs[0].v >= medViews * 1.3) add('idea', 'Reels', `${durs[0].key} Reels көбірек көріледі`,
    `90 күнде бұл ұзақтықтағы ${durs[0].n} Reels медианасы ${n(durs[0].v)} көру, барлық Reels — ${n(medViews)}. Монтажда осы ұзақтыққа сыйғызыңыз.`);

  // 8. Алғашқы 3 секунд (skip) және көрілу
  const curReels = cur.filter((p) => p.type === 'REELS' || p.type === 'TRIAL');
  const skip = median(curReels.map((p) => p.skip));
  const ret = median(curReels.map((p) => p.retention));
  if (curReels.length >= 4 && skip != null && skip >= 50) add('warn', 'Reels', `Көрерменнің ${Math.round(skip)}%-ы алғашқы 3 секундта өтіп кетеді`,
    `Видеоны ең қызықты сөйлеммен немесе сұрақпен бастаңыз («Құранды 30 күнде оқуға бола ма?»), бірінші кадрда үлкен мәтін болсын, амандасу мен кіріспені алып тастаңыз.`);
  else if (curReels.length >= 4 && ret != null && ret < 0.3) add('idea', 'Reels', `Reels орта есеппен ${pct(ret)}-ға ғана көріледі`,
    `Видеоны қысқартыңыз, әр 3–4 секунд сайын кадр не мәтін ауыссын, негізгі ойды соңына емес, ортасына дейін айтыңыз.`);

  // 9. Сақтау / бөлісу көп пост — серия
  const saver = cur.filter((p) => p.reach >= 1000).map((p) => ({ p, r: ((p.saves || 0) + (p.shares || 0)) / p.reach })).sort((a, b) => b.r - a.r)[0];
  const medSave = median(cur.filter((p) => p.reach >= 1000).map((p) => ((p.saves || 0) + (p.shares || 0)) / p.reach));
  if (saver && medSave && saver.r >= medSave * 2 && saver.r >= 0.01) add('idea', 'Контент', 'Көп сақталған/бөліскен пост — серия жасаңыз',
    `Әр 100 көрген адамның ${(saver.r * 100).toFixed(1)}-і сақтады не бөлісті (әдетте ${(medSave * 100).toFixed(1)}). Мұндай пайдалы контентті «1-бөлім, 2-бөлім» етіп жалғастырыңыз — сериялар жазылушы әкеледі.`, [link(saver.p)]);

  // 10. Сценарийлер: ең әлсізі ең күштісімен салыстыру
  // Соңғы 3 күнде іске қосылмаған сценарийді салыстырмаймыз (өшірілген не аккаунтта жоқ болуы мүмкін)
  const live = new Set(cur.filter((p) => now - Date.parse(p.at) < 3 * DAY).flatMap((p) => Object.keys(p.flows || {})));
  const flows = {};
  for (const p of cur) for (const [k, v] of Object.entries(p.flows || {})) { const o = (flows[k] ||= { people: 0, leads: 0 }); o.people += v; o.leads += (p.flowLeads || {})[k] || 0; }
  const fl = Object.entries(flows).filter(([k, o]) => k !== '—' && live.has(k) && o.people >= 10).map(([k, o]) => ({ k, c: o.leads / o.people, ...o })).sort((a, b) => b.c - a.c);
  if (fl.length >= 2 && fl.at(-1).c < fl[0].c / 2) add('idea', 'Воронка', `«${fl.at(-1).k}» сценарийі әлсіз: ${pct(fl.at(-1).c)}`,
    `«${fl[0].k}» сценарийінде ${pct(fl[0].c)} нөмір қалдырады. «${fl.at(-1).k}» DM мәтінін соның құрылымына жақындатыңыз (қысқа, бір сұрақ, нақты пайда).`);

  // 11. Жариялау жиілігі
  const lastMain = posts.filter((p) => p.type !== 'TRIAL').map((p) => Date.parse(p.at)).sort((a, b) => b - a)[0];
  const gapDays = lastMain ? Math.floor((now - lastMain) / DAY) : null;
  if (gapDays != null && gapDays >= 3) add('warn', 'Жиілік', `${gapDays} күннен бері негізгі пост жоқ`,
    'Алгоритм тұрақты жариялауды ұнатады: пробныйлардан бөлек, профильге аптасына кемінде 3–4 Reels салыңыз.');
  const wc = cur.filter((p) => p.type !== 'TRIAL').length, wp = prev.filter((p) => p.type !== 'TRIAL').length;
  if (wp >= 4 && wc <= wp * 0.6 && !(gapDays >= 3)) add('warn', 'Жиілік', `Пост саны азайды: ${wp} → ${wc}`, `Соңғы ${R} күнде негізгі пост алдыңғы кезеңнен аз. Reach пен «+» соған ілесе түседі.`);

  // 12. Жазылушылар
  const d7 = days.filter((d) => d.day >= new Date(now - 7 * DAY + 5 * 3600e3).toISOString().slice(0, 10));
  const net7 = sum(d7, (d) => d.new_followers) - sum(d7, (d) => d.unfollows);
  if (d7.length >= 5 && net7 < 0) add('warn', 'Жазылушылар', `7 күнде жазылушы ${n(-net7)}-ға азайды`,
    `Кеткендер ${n(sum(d7, (d) => d.unfollows))}, келгендер ${n(sum(d7, (d) => d.new_followers))}. Соңғы аптада жарнамалық/сату посттары көбейген болса, арасына пайдалы контент қосыңыз.`);

  // 13. Сторис
  const lastStory = stories.map((s) => Date.parse(s.at)).sort((a, b) => b - a)[0];
  const sGap = lastStory ? Math.floor((now - lastStory) / DAY) : null;
  if (sGap == null || sGap >= 2) add('idea', 'Сторис', sGap == null ? 'Сторис салынбаған' : `${sGap} күннен бері сторис жоқ`,
    'Күніне 2–3 сторис жазылушыны «жылы» ұстайды: сауалнама, сабақтан үзінді, шәкірт пікірі. Стористе жаңа Reels-ке сілтеме беріңіз — оның алғашқы қамтуын көтереді.');

  const order = { warn: 0, idea: 1, good: 2 };
  return out.sort((a, b) => order[a.kind] - order[b.kind]).slice(0, 8);
}
