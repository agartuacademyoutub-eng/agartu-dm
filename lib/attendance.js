// Жұмысқа келу: Telegram-ға жіберілген суреттер → кешігу есебі.
import { cfg } from './config.js';
import { rest } from './db.js';

export const MONTHS_KZ = ['', 'Қаңтар', 'Ақпан', 'Наурыз', 'Сәуір', 'Мамыр', 'Маусым',
  'Шілде', 'Тамыз', 'Қыркүйек', 'Қазан', 'Қараша', 'Желтоқсан'];

const fmtParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

// Date → Алматы бойынша { day: 'YYYY-MM-DD', time: 'HH:MM', min: тәуліктің минуты }
export function almaty(date) {
  const p = Object.fromEntries(fmtParts.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, min: +p.hour * 60 + +p.minute + +p.second / 60 };
}

export const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };

export function lateMinutes(arrivalMin, startMin, grace = 0) {
  const d = Math.floor(arrivalMin - startMin);
  return d > grace ? d : 0;
}

export function fmtMin(m) {
  const h = Math.floor(m / 60), mm = m % 60;
  return h ? `${h} сағ ${mm} мин` : `${mm} мин`;
}

// rows: [{emp_key, name, day, at}] — бір айдағы барлық сурет. today: 'YYYY-MM-DD' (бүгін әлі "келмеді" саналмайды).
export function monthReport(rows, year, month, { startMin, grace = 0, workdays = [1, 2, 3, 4, 5], today }) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const days = [];
  for (let d = 1; d <= last; d++) {
    const dt = new Date(Date.UTC(year, month - 1, d));
    const iso = dt.toISOString().slice(0, 10);
    if (workdays.includes(dt.getUTCDay() || 7) && iso < today) days.push(iso);
  }
  const emps = new Map();
  for (const r of rows) {
    const e = emps.get(r.emp_key) || { name: r.name, first: new Map() };
    e.name = r.name;
    const a = almaty(new Date(r.at));
    const prev = e.first.get(r.day);
    if (!prev || a.min < prev.min) e.first.set(r.day, a);
    emps.set(r.emp_key, e);
  }
  const out = [];
  for (const e of emps.values()) {
    let total = 0, lateDays = 0;
    const details = [...e.first.entries()].sort().map(([day, a]) => {
      const late = lateMinutes(a.min, startMin, grace);
      total += late;
      if (late) lateDays++;
      return { day, time: a.time, late };
    });
    const absent = days.filter((d) => !e.first.has(d));
    out.push({ name: e.name, came: details.length, lateDays, total, absent, details });
  }
  out.sort((a, b) => b.total - a.total);
  return { data: out, workdays: days.length };
}

export function reportText(year, month, { data, workdays }, start) {
  const lines = [`📊 ${MONTHS_KZ[month]} ${year} — кешігу есебі`, `Жұмыс басталуы: ${start} | Жұмыс күндері: ${workdays}`, ''];
  if (!data.length) lines.push('Бұл айда тіркелу жоқ.');
  data.forEach((e, i) => lines.push(
    `${i + 1}. ${e.name}\n   Келді: ${e.came} күн | Кешікті: ${e.lateDays} рет\n   Жалпы кешігу: ${fmtMin(e.total)} | Келмеді: ${e.absent.length} күн`,
  ));
  return lines.join('\n');
}

// Excel-де ашылатын CSV (BOM + ; бөлгіш)
export function reportCsv({ data }) {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const lines = [['Қызметкер', 'Күні', 'Келген уақыты', 'Кешігу (мин)'].map(q).join(';')];
  for (const e of data) {
    for (const d of e.details) lines.push([e.name, d.day, d.time, d.late].map(q).join(';'));
    for (const d of e.absent) lines.push([e.name, d, 'келмеді', ''].map(q).join(';'));
    lines.push([`${e.name} — ЖИЫНЫ`, `${e.came} күн келді`, `${e.lateDays} рет кешікті`, e.total].map(q).join(';'));
  }
  return '﻿' + lines.join('\r\n');
}

// ---------- Telegram + база ----------

export async function tgApi(method, body) {
  const isForm = body instanceof FormData;
  const res = await fetch(`https://api.telegram.org/bot${cfg.attToken}/${method}`, {
    method: 'POST',
    headers: isForm ? undefined : { 'Content-Type': 'application/json' },
    body: isForm ? body : JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(`tg ${method}: ${j.description || res.status}`);
  return j.result;
}

export async function workStart() {
  const rows = await rest('att_settings?key=eq.work_start&select=value');
  return rows[0]?.value || cfg.attWorkStart;
}

export async function setWorkStart(hhmm) {
  await rest('att_settings?on_conflict=key', { method: 'POST', body: { key: 'work_start', value: hhmm }, prefer: 'resolution=merge-duplicates' });
}

// Жаңа жол болса true (бүгінгі алғашқы сурет екенін шақырушы өзі тексереді)
export async function addCheckin(row) {
  const r = await rest('checkins?on_conflict=chat_id,message_id', { method: 'POST', body: row, prefer: 'resolution=ignore-duplicates,return=representation' });
  return Boolean(r && r.length);
}

export async function checkinsOfDay(day, empKey) {
  return rest(`checkins?day=eq.${day}${empKey ? `&emp_key=eq.${encodeURIComponent(empKey)}` : ''}&select=emp_key,name,day,at&order=at.asc`);
}

export async function buildReport(year, month) {
  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const rows = await rest(`checkins?day=gte.${from}&day=lte.${to}&select=emp_key,name,day,at&order=at.asc&limit=10000`);
  const start = await workStart();
  const rep = monthReport(rows, year, month, {
    startMin: toMin(start), grace: cfg.attGraceMin, workdays: cfg.attWorkdays, today: almaty(new Date()).day,
  });
  return { rep, start };
}

export async function sendReport(chatId, year, month) {
  const { rep, start } = await buildReport(year, month);
  await tgApi('sendMessage', { chat_id: chatId, text: reportText(year, month, rep, start) });
  if (!rep.data.length) return;
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('document', new Blob([reportCsv(rep)], { type: 'text/csv' }), `kesigu_${year}-${String(month).padStart(2, '0')}.csv`);
  await tgApi('sendDocument', form);
}
