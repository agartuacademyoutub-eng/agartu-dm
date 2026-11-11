// Контент талдауы: тақырып пен CTA (caption кілт сөздері бойынша), жариялау уақыты, Reels көру.
const ALMATY_MS = 5 * 3600e3;

// CTA жолдары тақырыпқа кірмейді
const CTA_LINE = /\+|қалдыр|жазыңыз|сақта|бөліс/i;
const TOPICS = [
  ['Мереке / ресми', /құтты болсын|құттықта|көңіл айт|республика күні|қарттар күні|меморандум|ынтымақтас|құрметті ұстаздар/i],
  ['Шәкірт тарихы / отзыв', /шәкірт|студент|жасында|жастағы|жасы \d|медбике|қонақта|емтихан|ағамыз|ханым/i],
  ['Намаз / фиқһ', /намаз|фиқһ|дәрет|тазалық|таһарат|жамағат/i],
  ['Дұға', /дұға|истиғфар|роббир|раббир|раббым/i],
  ['Сұрақ / тест', /сұраққа|жауап бердіңіз|келесі қай|қандай сүре|қандай тақырып|білесіз бе|білдіңіз бе/i],
  ['Сүре / аят / хадис', /сүре|аят|хадис|ﷺ|пайғамбар|\d+:\d+/i],
  ['Әзіл / тегтеу', /кімге жібер|белгіле|бәкөш|😂|😅|жіберіп қойыңыз|досыңа жібер/i],
  ['Тарих / тұлға', /абай|байтұрсын|медресе|ғарыш/i],
  ['Курс / қосымша', /курс|методика|қосымша|agartu|ағарту|академия/i],
];
export function topicOf(caption) {
  const hook = (caption || '').split('\n').filter((l) => l.trim() && !CTA_LINE.test(l)).join('\n');
  if (!hook.trim()) return 'Жазуда тек CTA (тақырып видеода)';
  return TOPICS.find(([, re]) => re.test(hook))?.[0] || 'Мотивация / Құран';
}

export function ctaOf(caption) {
  const c = caption || '';
  if (/«\s*намаз\s*»/i.test(c)) return '«НАМАЗ» сөзі';
  if (/(^|[\s“"«(])\+([\s”"»)!.,]|$)/.test(c)) return '«+»';
  if (/[«“"][^»”"\n]{1,15}[»”"]\s*(сөзін|санын|деп)/i.test(c)) return 'Басқа сөз («Құран», «7»…)';
  if (/сақта|бөліс/i.test(c)) return 'Тек сақта / бөліс';
  return 'CTA жоқ';
}

export function ctaFormula(caption) {
  const c = caption || '';
  if (/тегін/i.test(c)) return 'Тегін бонус (чек-лист, сабақ)';
  if (/жеңілдік/i.test(c)) return 'Жеңілдік';
  if (/сатып ал/i.test(c)) return 'Тікелей сату («курсын сатып алу»)';
  if (/\d+\s*(-\s*\d+\s*)?мину/i.test(c)) return '«Күніне N минут»';
  if (/толық ақ|толығырақ/i.test(c)) return '«Толық ақпарат»';
  return 'Басқа';
}

export const asksSave = (caption) => /сақта|бөліс/i.test(caption || '');

const median = (a) => {
  const s = a.filter((x) => x != null).sort((x, y) => x - y);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const avg = (a) => { const s = a.filter((x) => x != null); return s.length ? s.reduce((x, y) => x + y, 0) / s.length : null; };

// Топ бойынша жиынтық: медиана reach/views (бір вирал орташаны бұзбасын), нөмір/пост, конверсия
export function group(posts, keyFn, order) {
  const g = {};
  for (const p of posts) (g[keyFn(p)] ||= []).push(p);
  const rows = Object.entries(g).map(([key, ps]) => {
    const people = ps.reduce((a, p) => a + p.people, 0), leads = ps.reduce((a, p) => a + p.leads, 0);
    return {
      key, n: ps.length, reach: median(ps.map((p) => p.reach)), views: median(ps.map((p) => p.views)),
      saves: avg(ps.map((p) => p.saves)), shares: avg(ps.map((p) => p.shares)),
      people, leads, leadsPer: leads / ps.length, conv: people ? leads / people : null,
    };
  });
  return order ? rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) : rows.sort((a, b) => b.leadsPer - a.leadsPer || b.n - a.n);
}

const almaty = (iso) => new Date(new Date(iso).getTime() + ALMATY_MS);
export const SLOTS = ['00–06', '06–09', '09–12', '12–15', '15–18', '18–21', '21–24'];
export const slotOf = (iso) => { const h = almaty(iso).getUTCHours(); return h < 6 ? SLOTS[0] : SLOTS[Math.min(6, Math.floor((h - 6) / 3) + 1)]; };
export const WEEKDAYS = ['Дүйсенбі', 'Сейсенбі', 'Сәрсенбі', 'Бейсенбі', 'Жұма', 'Сенбі', 'Жексенбі'];
export const weekdayOf = (iso) => WEEKDAYS[(almaty(iso).getUTCDay() + 6) % 7];

export const DURATIONS = ['< 15 с', '15–30 с', '30–60 с', '60+ с', 'белгісіз'];
export const durationOf = (p) => (p.duration_s == null ? 'белгісіз' : p.duration_s < 15 ? DURATIONS[0] : p.duration_s < 30 ? DURATIONS[1] : p.duration_s < 60 ? DURATIONS[2] : DURATIONS[3]);
// Орташа көру уақыты ÷ ұзақтық. Қайта көргендер есебінен 100%-дан асуы мүмкін.
export const retention = (p) => (p.avg_watch_ms != null && p.duration_s ? p.avg_watch_ms / 1000 / p.duration_s : null);

export { median, avg };
