// Күнделікті Google Sheets есебі: Қорытынды / Посттар / Күндер / Reels көру / Сторис / Уақыт / Тақырып.
import { cfg } from './config.js';
import { rest } from './db.js';
import { funnelReport } from './funnel.js';
import { client } from './sheets.js';
import * as ct from './content.js';
import * as au from './audience.js';
import { writeDashboard } from './dashboard.js';

const ALMATY_MS = 5 * 3600e3;
const almatyDate = (iso) => new Date(new Date(iso).getTime() + ALMATY_MS).toISOString().slice(0, 10);
const almatyTime = (iso) => new Date(new Date(iso).getTime() + ALMATY_MS).toISOString().slice(11, 16);
const txt = (s) => (s == null || s === '' ? '' : "'" + String(s)); // "+" / "=" формула болып кетпесін
const firstLine = (s) => (s || '').split('\n')[0].trim() || '(жазусыз)';
const link = (url, label) => (url ? `=HYPERLINK("${url}","${label.slice(0, 90).replace(/"/g, '""')}")` : txt(label));
const ratio = (a, b) => (b ? a / b : '');
const num = (v) => (v == null ? '' : v);
const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const fmt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('ru-RU'));
const short = (p, n = 45) => `«${firstLine(p.caption).slice(0, n)}»`;
const typeName = (t) => ({ REELS: 'Reels', TRIAL: 'Пробный Reels', CAROUSEL_ALBUM: 'Карусель', IMAGE: 'Сурет', VIDEO: 'Видео' })[t] || t || '';
const typeKey = (p) => (p.trial ? 'TRIAL' : p.media_type);
const since = (days) => Date.now() - days * 864e5;

export function insights(posts) {
  const people = posts.reduce((a, p) => a + p.people, 0);
  const leads = posts.reduce((a, p) => a + p.leads, 0);
  const avg = people ? leads / people : 0;
  const out = [];
  const byLeads = [...posts].sort((a, b) => b.leads - a.leads || b.people - a.people);
  const top = byLeads[0];
  if (top?.leads) out.push(`Ең көп нөмір: «${firstLine(top.caption).slice(0, 70)}» — ${top.leads} нөмір (${top.people} адамнан, ${Math.round((top.leads / top.people) * 100)}%).`);
  const solid = posts.filter((p) => p.people >= 10);
  const best = [...solid].sort((a, b) => b.leads / b.people - a.leads / a.people)[0];
  if (best && best !== top) out.push(`Ең жоғары конверсия (10+ адам): «${firstLine(best.caption).slice(0, 70)}» — ${Math.round((best.leads / best.people) * 100)}%.`);
  const leaky = solid.filter((p) => avg && p.leads / p.people < avg / 2).sort((a, b) => b.people - a.people).slice(0, 3);
  if (leaky.length) out.push(`«+» көп, нөмір аз: ${leaky.map((p) => `«${firstLine(p.caption).slice(0, 40)}» (${p.people} → ${p.leads})`).join('; ')}. DM мәтінін/ұсынысты тексеру керек.`);
  const byType = {};
  for (const p of posts) { const t = (byType[typeKey(p)] ||= { n: 0, leads: 0 }); t.n++; t.leads += p.leads; }
  const types = Object.entries(byType).filter(([, t]) => t.n >= 2);
  if (types.length > 1) out.push('Бір постқа орташа нөмір: ' + types.map(([k, t]) => `${typeName(k)} ${(t.leads / t.n).toFixed(1)} (${t.n} пост)`).join(', ') + '.');
  const zero = posts.filter((p) => p.people === 0).length;
  if (zero) out.push(`${zero} постта бірде-бір триггер-коммент жоқ — CTA («+ қалдырыңыз») жоқ немесе әлсіз.`);
  return out;
}

export function reelsInsights(reels) {
  const out = [];
  if (!reels.length) return out;
  const ret = ct.median(reels.map(ct.retention)), skip = ct.median(reels.map((p) => p.skip_rate));
  out.push(`${reels.length} Reels: видеоның орта есеппен ${pct(ret)} бөлігі көріледі (медиана), алғашқы 3 секундта ${skip == null ? '—' : Math.round(skip) + '%'} адам өткізіп жібереді.`);
  const buckets = ct.group(reels, ct.durationOf).filter((b) => b.n >= 3 && b.key !== 'белгісіз').sort((a, b) => b.views - a.views);
  if (buckets.length > 1) out.push(`Ең көп көрілетін ұзақтық: ${buckets[0].key} (медиана ${fmt(buckets[0].views)} views, ${buckets[0].n} Reels). Ең азы: ${buckets.at(-1).key} (${fmt(buckets.at(-1).views)}).`);
  const seen = reels.filter((p) => (p.views || 0) >= 300);
  if (skip != null) {
    const weak = seen.filter((p) => p.skip_rate != null && p.skip_rate > skip + 10).sort((a, b) => b.views - a.views).slice(0, 3);
    if (weak.length) out.push(`Басы әлсіз (skip жоғары): ${weak.map((p) => `${short(p, 35)} — ${Math.round(p.skip_rate)}%`).join('; ')}. Алғашқы 1–2 секундты күшейту керек.`);
  }
  // Өте қысқа видео қайталанып көрсетіледі (100%+) — салыстыруға 15 с-тан ұзынын ғана аламыз
  const strong = [...seen].filter((p) => ct.retention(p) != null && p.duration_s >= 15).sort((a, b) => ct.retention(b) - ct.retention(a))[0];
  if (strong) out.push(`Ең ұзақ көрілген: ${short(strong)} — ${pct(ct.retention(strong))} (${strong.duration_s} с видео).`);
  return out;
}

export function timeInsights(posts) {
  const out = [];
  const slots = ct.group(posts, (p) => ct.slotOf(p.posted_at)).filter((s) => s.n >= 3);
  const days = ct.group(posts, (p) => ct.weekdayOf(p.posted_at)).filter((s) => s.n >= 3);
  const byReach = [...slots].sort((a, b) => b.reach - a.reach);
  if (byReach.length > 1) out.push(`Ең көп reach: ${byReach[0].key} аралығында (медиана ${fmt(byReach[0].reach)}, ${byReach[0].n} пост). Ең азы: ${byReach.at(-1).key} (${fmt(byReach.at(-1).reach)}).`);
  const byLeads = [...slots].sort((a, b) => b.leadsPer - a.leadsPer);
  if (byLeads[0]?.leadsPer) out.push(`Ең көп нөмір: ${byLeads[0].key} аралығы — бір постқа ${byLeads[0].leadsPer.toFixed(1)} нөмір.`);
  const dReach = [...days].sort((a, b) => b.reach - a.reach);
  if (dReach.length > 1) out.push(`Апта күні: ${dReach[0].key} ең жақсы (медиана reach ${fmt(dReach[0].reach)}), ${dReach.at(-1).key} ең әлсіз (${fmt(dReach.at(-1).reach)}).`);
  return out;
}

export function topicInsights(posts) {
  const out = [];
  const topics = ct.group(posts, (p) => ct.topicOf(p.caption)).filter((t) => t.n >= 3);
  if (topics[0]?.leadsPer) out.push(`Ең көп нөмір әкелетін тақырып: ${topics[0].key} — бір постқа ${topics[0].leadsPer.toFixed(1)} нөмір (${topics[0].n} пост).`);
  const tReach = [...topics].sort((a, b) => b.reach - a.reach);
  if (tReach[0] && tReach[0] !== topics[0]) out.push(`Ең көп reach жинайтын тақырып: ${tReach[0].key} (медиана ${fmt(tReach[0].reach)}).`);
  const forms = ct.group(posts.filter((p) => p.people > 0), (p) => ct.ctaFormula(p.caption)).filter((f) => f.people >= 20).sort((a, b) => b.conv - a.conv);
  if (forms.length > 1) out.push(`CTA формуласы: ${forms[0].key} ең жақсы конверсия береді (${pct(forms[0].conv)}), ${forms.at(-1).key} — ең төмен (${pct(forms.at(-1).conv)}).`);
  const save = ct.group(posts, (p) => (ct.asksSave(p.caption) ? 'бар' : 'жоқ'));
  const yes = save.find((s) => s.key === 'бар'), no = save.find((s) => s.key === 'жоқ');
  if (yes?.n >= 3 && no?.n >= 3 && yes.saves != null && no.saves != null) out.push(`«Сақтап алыңыз / бөлісіңіз» деп жазылған посттар орта есеппен ${yes.saves.toFixed(0)} сақтау, ${yes.shares.toFixed(0)} бөлісу жинайды; жазылмағандары ${no.saves.toFixed(0)} / ${no.shares.toFixed(0)}.`);
  return out;
}

export function storyInsights(stories) {
  const out = [];
  if (!stories.length) return ['Әзірге дерек жоқ: сторис статистикасы 2026-10-30 бастап жиналады (сағат сайын).'];
  const reach = ct.avg(stories.map((s) => s.reach));
  const exit = ct.avg(stories.map((s) => (s.views ? (s.tap_exit || 0) / s.views : null)));
  out.push(`${stories.length} сторис: орташа reach ${fmt(reach)}, көргендердің ${pct(exit)} сторисьтен шығып кетеді.`);
  const best = [...stories].sort((a, b) => (b.reach || 0) - (a.reach || 0))[0];
  if (best) out.push(`Ең көп reach: ${almatyDate(best.posted_at)} ${almatyTime(best.posted_at)} сторисі — ${fmt(best.reach)}.`);
  const acts = stories.reduce((a, s) => a + (s.replies || 0) + (s.profile_visits || 0), 0);
  out.push(`Барлығы ${fmt(acts)} әрекет: жауап және профильге өту.`);
  return out;
}

// Әр бөліністің үлесі: жалпы сан — жыныс бөлінісінің қосындысы (ол толық, қала/ел — тек топ-45)
const totalOf = (m) => Object.values(m?.gender || {}).reduce((a, v) => a + v, 0);
const shareOf = (demo, k, b, key) => { const t = totalOf(demo[k]); const v = demo[k]?.[b]?.[key]; return t && v != null ? v / t : null; };

export function audienceInsights(demo) {
  const out = [];
  const f = demo.followers;
  if (!f?.gender) return ['Демография алынбады (insights рұқсаты немесе жазылушы 100-ден аз).'];
  const s = (b, key, k = 'followers') => shareOf(demo, k, b, key);
  out.push(`Жазылушылардың ${pct(s('gender', 'M'))} — ер, ${pct(s('gender', 'F'))} — әйел, ${pct(s('gender', 'U'))} жынысын көрсетпеген.`);
  const ages = Object.entries(f.age || {}).sort((a, b) => b[1] - a[1]);
  if (ages.length > 1) out.push(`Негізгі жас: ${ages[0][0]} (${pct(s('age', ages[0][0]))}) және ${ages[1][0]} (${pct(s('age', ages[1][0]))}). 25–44 жас бірге — ${pct((s('age', '25-34') || 0) + (s('age', '35-44') || 0))}.`);
  const cities = Object.entries(f.city || {}).sort((a, b) => b[1] - a[1]);
  if (cities.length) out.push(`Ең көп жазылушы: ${cities.slice(0, 5).map(([c]) => `${au.cityName(c)} ${pct(s('city', c))}`).join(', ')}. Топ-5 қала бірге — ${pct(cities.slice(0, 5).reduce((a, [c]) => a + (s('city', c) || 0), 0))}.`);
  const abroad = Object.entries(f.country || {}).filter(([c]) => c !== 'KZ').sort((a, b) => b[1] - a[1]);
  if (abroad.length) out.push(`Қазақстаннан тыс — ${pct(1 - (s('country', 'KZ') || 0))}: ${abroad.slice(0, 3).map(([c]) => `${au.countryName(c)} ${pct(s('country', c))}`).join(', ')}.`);
  // Қамтылған аудитория жазылушылардан қатты өзгеше болса — контент кімге жетіп жатқанын көрсетеді
  for (const [k, label, lead] of [['reached', 'reach-тің', 'Контент жазылушыларға қарағанда көбірек жетіп жатқан топтар'], ['engaged', 'белсенділердің', 'Жазылушылар ішіндегі үлесінен белсендірек топтар (лайк, коммент, сақтау)']]) {
    const gaps = [];
    for (const [b, name] of [['country', au.countryName], ['age', (x) => x + ' жас'], ['gender', (x) => au.GENDER[x]]]) {
      for (const key of Object.keys(demo[k]?.[b] || {})) {
        const fr = s(b, key) || 0, rr = s(b, key, k);
        if (rr != null && rr - fr >= 0.05) gaps.push([rr - fr, `${name(key)}: ${label} ${pct(rr)}, жазылушылардың ${pct(fr)}`]);
      }
    }
    if (gaps.length) out.push(`${lead} (30 күн): ${gaps.sort((a, b) => b[0] - a[0]).slice(0, 3).map((g) => g[1]).join('; ')}.`);
  }
  const fe = s('gender', 'F'), ee = s('gender', 'F', 'engaged');
  if (fe != null && ee != null && ee - fe >= 0.05) out.push(`Әйелдер белсендірек: жазылушылардың ${pct(fe)}, бірақ лайк/коммент/сақтау жасағандардың ${pct(ee)}.`);
  return out;
}

function audienceTab(demo) {
  const cols = ['Жазылушы', '% жазылушы', '% белсенді (30 күн)', '% қамтылған (30 күн)'];
  const fm = { 1: '#,##0', 2: '0.0%', 3: '0.0%', 4: '0.0%' };
  const rowsFor = (b, keys, label) => keys.map((k) => [txt(label(k)), num(demo.followers?.[b]?.[k]), num(shareOf(demo, 'followers', b, k)), num(shareOf(demo, 'engaged', b, k)), num(shareOf(demo, 'reached', b, k))]);
  const sorted = (b) => Object.entries(demo.followers?.[b] || {}).sort((a, x) => x[1] - a[1]).map(([k]) => k);
  const ag = demo.followers?.['age,gender'] || {};
  const total = totalOf(demo.followers);
  return stack([
    { title: `Жыныс · барлығы ${fmt(total)} жазылушы`, header: ['Жыныс', ...cols], rows: rowsFor('gender', ['M', 'F', 'U'], (k) => au.GENDER[k]), formats: fm },
    { title: 'Жас', header: ['Жас', ...cols], rows: rowsFor('age', au.AGES.filter((a) => demo.followers?.age?.[a] != null), (k) => k), formats: fm },
    {
      title: 'Жас × жыныс (жазылушылар)', header: ['Жас', 'Ер', 'Әйел', 'Көрсетілмеген', 'Ер %', 'Әйел %', 'Көрсетілмеген %'],
      rows: au.AGES.filter((a) => ['M', 'F', 'U'].some((g) => ag[`${a}|${g}`] != null)).map((a) => {
        const v = ['M', 'F', 'U'].map((g) => ag[`${a}|${g}`] || 0);
        return [txt(a), ...v, ...v.map((x) => (total ? x / total : ''))];
      }),
      formats: { 1: '#,##0', 2: '#,##0', 3: '#,##0', 4: '0.0%', 5: '0.0%', 6: '0.0%' },
    },
    { title: 'Ел (топ-20)', header: ['Ел', ...cols], rows: rowsFor('country', sorted('country').slice(0, 20), au.countryName), formats: fm },
    {
      title: 'Қала (топ-45)', header: ['Қала', ...cols], rows: rowsFor('city', sorted('city'), au.cityName), formats: fm,
      note: 'Instagram әр бөліністе тек топ-45-ті береді, сондықтан қала/ел үлестерінің қосындысы 100% емес. Белсенді — лайк, коммент, сақтау, бөлісу жасағандар; қамтылған — контентті көргендер (жазылмағандар да). «Астана» Instagram-да Tselinograd деп тұрады.',
    },
  ]);
}

// Бір бетке бірнеше кесте: тақырып → баған атаулары → жолдар → бос жол
function stack(tables) {
  const rows = [], headerRows = [], cellFormats = [];
  for (const t of tables) {
    if (rows.length) rows.push([]);
    rows.push([txt('▸ ' + t.title)]);
    headerRows.push(rows.length);
    rows.push(t.header);
    const start = rows.length;
    rows.push(...t.rows);
    for (const [c, pat] of Object.entries(t.formats || {})) cellFormats.push([start, rows.length, Number(c), Number(c) + 1, pat]);
    if (t.note) rows.push([txt(t.note)]);
  }
  return { rows, headerRows, cellFormats };
}

const GROUP_HEADER = ['Пост', 'Медиана reach', 'Медиана views', 'Орт. сақтау', 'Орт. бөлісу', '«+» адам', 'Нөмір', 'Нөмір / пост', 'Конверсия'];
const GROUP_FMT = { 2: '#,##0', 3: '#,##0', 4: '0.0', 5: '0.0', 8: '0.00', 9: '0.0%' };
const groupTable = (title, label, groups, note) => ({
  title, note, formats: GROUP_FMT, header: [label, ...GROUP_HEADER],
  rows: groups.map((g) => [txt(g.key), g.n, num(g.reach), num(g.views), num(g.saves), num(g.shares), g.people, g.leads, g.leadsPer, num(g.conv)]),
});

export async function updateSheet(acc) {
  if (!cfg.googleSa || !cfg.sheetId) return { skipped: 'GOOGLE_SA_JSON / SHEET_ID жоқ' };
  const sh = client(cfg.googleSa, cfg.sheetId);
  const { posts } = await funnelReport(acc, 90);
  const since90 = almatyDate(new Date(since(90)).toISOString());
  const [stats, comments, stories, demo] = await Promise.all([
    rest(`ig_stats_daily?ig_user_id=eq.${acc.ig_user_id}&day=gte.${since90}&select=*&order=day.desc`),
    rest(`funnel_comments?ig_user_id=eq.${acc.ig_user_id}&created_at=gte.${since90}&select=from_id,media_id,created_at,is_lead,phone_at&limit=100000`),
    rest(`story_stats?ig_user_id=eq.${acc.ig_user_id}&posted_at=gte.${since90}&select=*&order=posted_at.desc`),
    au.demographics(acc).catch(() => ({})),
  ]);
  const byDate = (a, b) => b.posted_at.localeCompare(a.posted_at);
  // Пробный Reels тек жазылмағандарға көрсетіледі — уақыт/тақырып салыстыруына қоспаймыз
  const regular = posts.filter((p) => !p.trial);
  const reels = posts.filter((p) => p.media_type === 'REELS').sort(byDate);

  // --- Посттар ---
  const postRows = [['Күні', 'Түрі', 'Пост', 'Reach', 'Views', 'Лайк', 'Коммент', '«+» адам', 'Нөмір', 'Конверсия', '«+» / 1000 reach', 'Нөмір / 1000 reach', 'Сценарий', 'Сақтау', 'Бөлісу', 'Тақырып', 'CTA']];
  for (const p of [...posts].sort(byDate)) {
    postRows.push([
      almatyDate(p.posted_at), typeName(typeKey(p)), link(p.permalink, (p.trial ? '[ПРОБНЫЙ] ' : '') + firstLine(p.caption)), num(p.reach), num(p.views), num(p.likes),
      num(p.comments_total), p.people, p.leads, ratio(p.leads, p.people),
      p.reach ? (p.people / p.reach) * 1000 : '', p.reach ? (p.leads / p.reach) * 1000 : '',
      txt(Object.entries(p.flows).map(([k, v]) => `${k} ${v}`).join(', ')), num(p.saves), num(p.shares), txt(ct.topicOf(p.caption)), txt(ct.ctaOf(p.caption)),
    ]);
  }

  // --- Күндер ---
  const perDay = {};
  const seen = new Set();
  for (const c of comments) {
    const d = almatyDate(c.created_at);
    const k = d + c.media_id + c.from_id;
    const o = (perDay[d] ||= { people: 0, leads: 0 });
    if (!seen.has(k)) { seen.add(k); o.people++; }
    if (c.is_lead && c.phone_at) (perDay[almatyDate(c.phone_at)] ||= { people: 0, leads: 0 }).leads++;
  }
  const dayRows = [['Күн', 'Жазылушы', 'Жаңа', 'Кетті', 'Reach', 'Views', 'Әрекет', 'Лайк', 'Коммент', 'Бөлісу', 'Сақтау', '«+» адам', 'Нөмір', 'Конверсия']];
  for (const s of stats) {
    const f = perDay[s.day] || { people: 0, leads: 0 };
    dayRows.push([s.day, num(s.followers), num(s.new_followers), num(s.unfollows), num(s.reach), num(s.views), num(s.total_interactions), num(s.likes), num(s.comments), num(s.shares), num(s.saves), f.people, f.leads, ratio(f.leads, f.people)]);
  }

  // --- Reels көру ---
  const durGroups = ct.DURATIONS.map((key) => reels.filter((p) => ct.durationOf(p) === key)).filter((ps) => ps.length).map((ps) => [
    txt(ct.durationOf(ps[0])), ps.length, num(ct.median(ps.map((p) => p.views))), num(ct.median(ps.map(ct.retention))),
    num(ct.median(ps.map((p) => (p.skip_rate == null ? null : p.skip_rate / 100)))), num(ct.avg(ps.map((p) => p.saves))), ps.reduce((a, p) => a + p.leads, 0) / ps.length,
  ]);
  const reelsTab = stack([
    {
      title: 'Ұзақтық бойынша (90 күн)', header: ['Ұзақтығы', 'Reels', 'Медиана views', 'Көрілу % (медиана)', 'Skip rate (медиана)', 'Орт. сақтау', 'Нөмір / Reels'],
      rows: durGroups, formats: { 2: '#,##0', 3: '0%', 4: '0.0%', 5: '0.0', 6: '0.00' },
    },
    {
      title: 'Әр Reels', header: ['Күні', 'Түрі', 'Reels', 'Ұзақтығы (с)', 'Views', 'Reach', 'Орт. көру (с)', 'Көрілу %', 'Skip rate', 'Жалпы көру (сағ)', 'Сақтау', 'Бөлісу', 'Сақтау / 1000 reach', '«+» адам', 'Нөмір'],
      rows: reels.map((p) => [
        almatyDate(p.posted_at), p.trial ? 'Пробный' : 'Reels', link(p.permalink, firstLine(p.caption)), num(p.duration_s), num(p.views), num(p.reach),
        p.avg_watch_ms == null ? '' : p.avg_watch_ms / 1000, num(ct.retention(p)), p.skip_rate == null ? '' : p.skip_rate / 100,
        p.total_watch_ms == null ? '' : p.total_watch_ms / 3600e3, num(p.saves), num(p.shares), p.reach && p.saves != null ? (p.saves / p.reach) * 1000 : '', p.people, p.leads,
      ]),
      formats: { 3: '0.0', 4: '#,##0', 5: '#,##0', 6: '0.0', 7: '0%', 8: '0.0%', 9: '#,##0.0', 12: '0.0' },
      note: 'Көрілу % — орташа көру уақыты ÷ видео ұзақтығы (қайта көргендер есебінен 100%-дан асуы мүмкін). Skip rate — алғашқы 3 секундта өткізіп жібергендер үлесі.',
    },
  ]);

  // --- Сторис ---
  const storyRows = [['Күні', 'Уақыты', 'Түрі', 'Сторис', 'Reach', 'Views', 'Жауап', 'Бөлісу', 'Профильге өту', 'Жазылды', 'Алға басты', 'Артқа басты', 'Шығып кетті', 'Келесі аккаунтқа өтті', 'Шығу %', 'Соңғы жаңарту']];
  for (const s of stories) {
    storyRows.push([
      almatyDate(s.posted_at), almatyTime(s.posted_at), s.media_type === 'VIDEO' ? 'Видео' : 'Сурет', link(s.permalink, 'ашу'), num(s.reach), num(s.views), num(s.replies), num(s.shares),
      num(s.profile_visits), num(s.follows), num(s.tap_forward), num(s.tap_back), num(s.tap_exit), num(s.swipe_forward), s.views ? (s.tap_exit || 0) / s.views : '',
      s.updated_at ? `${almatyDate(s.updated_at)} ${almatyTime(s.updated_at)}` : '',
    ]);
  }

  // --- Уақыт ---
  const timeTab = stack([
    groupTable('Сағат бойынша (Алматы уақыты, 90 күн, пробныйсыз)', 'Уақыт', ct.group(regular, (p) => ct.slotOf(p.posted_at), ct.SLOTS)),
    groupTable('Апта күні бойынша', 'Күн', ct.group(regular, (p) => ct.weekdayOf(p.posted_at), ct.WEEKDAYS),
      'Медиана — бір вирал пост нәтижені бұрмаламасын деп. 3-тен аз посты бар топқа сенім аз.'),
  ]);

  // --- Тақырып ---
  const withTrigger = regular.filter((p) => ['«+»', '«НАМАЗ» сөзі', 'Басқа сөз («Құран», «7»…)'].includes(ct.ctaOf(p.caption)));
  const topicTab = stack([
    groupTable('Тақырып бойынша (90 күн, пробныйсыз)', 'Тақырып', ct.group(regular, (p) => ct.topicOf(p.caption))),
    groupTable('CTA: не жазуды сұрайды', 'CTA', ct.group(regular, (p) => ct.ctaOf(p.caption))),
    groupTable('CTA формуласы (триггер сұрайтын посттар)', 'Формула', ct.group(withTrigger, (p) => ct.ctaFormula(p.caption))),
    groupTable('«Сақтап алыңыз / бөлісіңіз» шақыруы', 'Шақыру', ct.group(regular, (p) => (ct.asksSave(p.caption) ? 'бар' : 'жоқ'))),
  ]);
  topicTab.rows.push([], [txt('Тақырып пен CTA пост жазуындағы кілт сөздер бойынша автоматты анықталады (видеоның өзі емес). Әр посттың тақырыбы «Посттар» бетінде.')]);

  // --- Қорытынды ---
  const win = (days) => {
    const from = since(days);
    const ps = posts.filter((p) => new Date(p.posted_at) >= from);
    const ss = stats.filter((s) => s.day >= almatyDate(new Date(from).toISOString()));
    const sum = (f) => ss.reduce((a, s) => a + (s[f] || 0), 0);
    const people = ps.reduce((a, p) => a + p.people, 0), leads = ps.reduce((a, p) => a + p.leads, 0);
    return { ps, people, leads, reach: sum('reach'), views: sum('views'), net: sum('new_followers') - sum('unfollows') };
  };
  const w = [7, 30, 90].map(win);
  const now = new Date(Date.now() + ALMATY_MS).toISOString().replace('T', ' ').slice(0, 16);
  const sumRows = [
    ['Көрсеткіш', '7 күн', '30 күн', '90 күн'],
    ['Пост саны', ...w.map((x) => x.ps.length)],
    ['  оның ішінде пробный Reels', ...w.map((x) => x.ps.filter((p) => p.trial).length)],
    ['Триггер бар пост', ...w.map((x) => x.ps.filter((p) => p.people).length)],
    ['«+» жазған адам', ...w.map((x) => x.people)],
    ['Нөмір қалдырды', ...w.map((x) => x.leads)],
    ['Конверсия', ...w.map((x) => ratio(x.leads, x.people))],
    ['Reach (күндік қосынды)', ...w.map((x) => x.reach)],
    ['Views', ...w.map((x) => x.views)],
    ['Жазылушы таза өсімі', ...w.map((x) => x.net)],
  ];
  const boldRows = [];
  const section = (title, lines) => {
    if (!lines.length) return;
    sumRows.push([]);
    boldRows.push(sumRows.length);
    sumRows.push([txt(title)], ...lines.map((s) => [txt('• ' + s)]));
  };
  section(`Қорытынды · соңғы 30 күн · @${acc.username}`, insights(w[1].ps));
  section('Аудитория («Аудитория» беті)', audienceInsights(demo));
  section('Reels көру · 30 күн («Reels көру» беті)', reelsInsights(reels.filter((p) => new Date(p.posted_at) >= since(30))));
  section('Сторис · 7 күн («Сторис» беті)', storyInsights(stories.filter((s) => new Date(s.posted_at) >= since(7))));
  section('Жариялау уақыты · 90 күн, пробныйсыз («Уақыт» беті)', timeInsights(regular));
  section('Тақырып пен CTA · 90 күн, пробныйсыз («Тақырып» беті)', topicInsights(regular));
  sumRows.push(
    [],
    [txt(`Жаңартылды: ${now} (Алматы). Күн сайын 09:00-де автоматты жаңарады.`)],
    [txt('«+» адам — постқа «+», «дұға», «намаз» жазған бірегей адам. Нөмір — сол адам комментінен кейін 14 күн ішінде Директке жазған нөмір; бірнеше постқа жазса, нөмірге дейінгі соңғы постқа есептеледі.')],
  );

  await sh.writeTab('Қорытынды', sumRows, { widths: [260, 110, 110, 110], filter: false, cellFormats: [[6, 7, 1, 4, '0.0%'], [7, 10, 1, 4, '#,##0']] });
  await sh.writeTab('Посттар', postRows, { widths: [95, 80, 380, 80, 80, 70, 80, 80, 70, 95, 110, 120, 200, 75, 75, 170, 150], numberFormats: { 3: '#,##0', 4: '#,##0', 9: '0.0%', 10: '0.00', 11: '0.00' } });
  await sh.writeTab('Күндер', dayRows, { widths: [95, 95, 70, 70, 90, 90, 80, 70, 80, 70, 70, 80, 70, 95], numberFormats: { 1: '#,##0', 4: '#,##0', 5: '#,##0', 13: '0.0%' } });
  await sh.writeTab('Reels көру', reelsTab.rows, { widths: [95, 75, 340, 90, 85, 85, 90, 85, 85, 95, 75, 75, 100, 75, 70], filter: false, headerRows: reelsTab.headerRows, cellFormats: reelsTab.cellFormats });
  await sh.writeTab('Сторис', storyRows, { widths: [95, 65, 65, 70, 75, 75, 70, 70, 95, 75, 85, 85, 90, 110, 75, 120], numberFormats: { 4: '#,##0', 5: '#,##0', 14: '0.0%' } });
  await sh.writeTab('Уақыт', timeTab.rows, { widths: [300, 60, 105, 105, 90, 90, 80, 70, 95, 90], filter: false, headerRows: timeTab.headerRows, cellFormats: timeTab.cellFormats });
  await sh.writeTab('Тақырып', topicTab.rows, { widths: [300, 60, 105, 105, 90, 90, 80, 70, 95, 90], filter: false, headerRows: topicTab.headerRows, cellFormats: topicTab.cellFormats });
  const aud = audienceTab(demo);
  await sh.writeTab('Аудитория', aud.rows, { widths: [230, 95, 95, 130, 140, 95, 115], filter: false, headerRows: aud.headerRows, cellFormats: aud.cellFormats });
  await writeDashboard(sh, { acc, posts, stats, perDay, now });
  await sh.removeDefaultTab();
  await boldSummary(sh, boldRows);
  return { posts: posts.length, days: stats.length, reels: reels.length, stories: stories.length };
}

async function boldSummary(sh, rows) {
  const meta = await sh.call('?fields=sheets.properties');
  const id = meta.sheets.find((s) => s.properties.title === 'Қорытынды')?.properties.sheetId;
  if (id == null || !rows.length) return;
  await sh.call(':batchUpdate', 'POST', {
    requests: rows.map((r) => ({ repeatCell: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1 }, cell: { userEnteredFormat: { textFormat: { bold: true } } }, fields: 'userEnteredFormat.textFormat' } })),
  });
}
