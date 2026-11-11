import { cfg } from '../lib/config.js';
import { safeEqual } from '../lib/crypto.js';
import { addError } from '../lib/db.js';
import * as att from '../lib/attendance.js';

// Telegram webhook: қызметкерлер топқа сурет жібереді → келу уақыты жазылады. Админ командалары осында.
// setWebhook кезінде secret_token = ATT_WEBHOOK_SECRET берілген, Telegram оны тақырыпта қайтарады.
export async function POST(request) {
  if (!safeEqual(request.headers.get('x-telegram-bot-api-secret-token'), cfg.attSecret)) {
    return new Response('forbidden', { status: 403 });
  }
  const update = await request.json().catch(() => null);
  const msg = update?.message || update?.channel_post;
  if (!msg) return Response.json({ ok: true });
  try {
    if (msg.photo || msg.document?.mime_type?.startsWith('image/')) await onPhoto(msg);
    else if (msg.text?.startsWith('/')) await onCommand(msg);
  } catch (e) {
    await addError('attendance', e.message);
  }
  return Response.json({ ok: true }); // қате болса да 200: әйтпесе Telegram қайта-қайта жібереді
}

async function onPhoto(msg) {
  let empKey, name;
  if (msg.from && !msg.from.is_bot) {
    empKey = String(msg.from.id);
    name = [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ');
  } else if (msg.author_signature) { // каналда "Подписывать сообщения" қосулы болса
    empKey = `sig:${msg.author_signature}`;
    name = msg.author_signature;
  } else return;

  const now = new Date(msg.date * 1000);
  const a = att.almaty(now);
  const before = await att.checkinsOfDay(a.day, empKey);
  const isNew = await att.addCheckin({ emp_key: empKey, name, day: a.day, at: now.toISOString(), chat_id: msg.chat.id, message_id: msg.message_id });
  if (!isNew || before.length) return; // бүгін бұрын тіркелген — тек алғашқы сурет есептеледі

  const late = att.lateMinutes(a.min, att.toMin(await att.workStart()), cfg.attGraceMin);
  const text = late ? `⏰ ${name} — ${a.time} келді, ${att.fmtMin(late)} кешікті` : `✅ ${name} — ${a.time} келді`;
  if (msg.chat.type !== 'channel') await att.tgApi('sendMessage', { chat_id: msg.chat.id, text, reply_to_message_id: msg.message_id });
}

async function onCommand(msg) {
  const [rawCmd, arg] = msg.text.trim().split(/\s+/);
  const cmd = rawCmd.split('@')[0].toLowerCase();
  const reply = (text) => att.tgApi('sendMessage', { chat_id: msg.chat.id, text });
  const userId = msg.from ? String(msg.from.id) : '';
  const isAdmin = cfg.attAdmins.includes(userId);

  if (cmd === '/myid') return reply(`Сіздің ID: ${userId || '—'}\nЧат ID: ${msg.chat.id}`);
  if (cmd === '/start' || cmd === '/help') {
    return reply('Жұмысқа келуді тіркейтін бот.\nТопқа сурет жіберіңіз — күннің алғашқы суреті келу уақыты болып саналады.\n\n'
      + 'Админ командалары:\n/today — бүгін кім келді\n/report — осы айдың есебі\n/report 2026-10 — көрсетілген ай\n/settime 09:00 — жұмыс басталу уақыты\n/myid — ID білу');
  }
  if (!isAdmin) return;

  if (cmd === '/settime') {
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(arg || '')) return reply('Формат: /settime 09:00');
    const t = arg.padStart(5, '0');
    await att.setWorkStart(t);
    return reply(`✅ Жұмыс басталу уақыты: ${t}`);
  }
  if (cmd === '/today') {
    const a = att.almaty(new Date());
    const rows = await att.checkinsOfDay(a.day);
    if (!rows.length) return reply('Бүгін әзірге ешкім тіркелмеді.');
    const start = await att.workStart();
    const seen = new Set();
    const lines = [`📅 Бүгін (${a.day}), басталуы ${start}:`];
    for (const r of rows) {
      if (seen.has(r.emp_key)) continue;
      seen.add(r.emp_key);
      const t = att.almaty(new Date(r.at));
      const late = att.lateMinutes(t.min, att.toMin(start), cfg.attGraceMin);
      lines.push(`${late ? '⏰' : '✅'} ${r.name} — ${t.time}${late ? ` (+${att.fmtMin(late)})` : ''}`);
    }
    return reply(lines.join('\n'));
  }
  if (cmd === '/report') {
    const now = att.almaty(new Date()).day;
    let [year, month] = now.split('-').map(Number);
    if (arg) {
      const m = /^(\d{4})-(\d{1,2})$/.exec(arg);
      if (!m) return reply('Формат: /report 2026-10');
      [year, month] = [Number(m[1]), Number(m[2])];
    }
    await att.sendReport(userId, year, month);
    if (msg.chat.type !== 'private') await reply('📩 Есеп жеке хатқа жіберілді.');
  }
}
