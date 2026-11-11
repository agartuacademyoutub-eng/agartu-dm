import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { matchesTrigger, extractPhone, pickFlow } from '../lib/match.js';
import { encrypt, decrypt, validSignature } from '../lib/crypto.js';
import { parseEvents } from '../lib/handle.js';

test('"+" триггері', () => {
  for (const t of ['+', '++', ' + ', '+🔥', 'маған +']) assert.ok(matchesTrigger(t, ['+']), t);
  for (const t of ['', 'керемет', 'рахмет!']) assert.ok(!matchesTrigger(t, ['+']), t);
});

test('сөз триггері регистрсіз, жеке сөз', () => {
  assert.ok(matchesTrigger('Гайд беріңізші', ['гайд']));
  assert.ok(matchesTrigger('бағасы?', ['бағасы']));
  assert.ok(!matchesTrigger('гайдтар', ['гайд']));
});

test('сценарий таңдау: priority реті, сәйкес келмесе null', () => {
  const flows = [
    { id: 1, keywords: ['гайд'] },
    { id: 2, keywords: ['бағасы', 'баға'] },
    { id: 3, keywords: ['+'] },
  ];
  assert.equal(pickFlow('Гайд керек', flows).id, 1);
  assert.equal(pickFlow('бағасы қанша?', flows).id, 2);
  assert.equal(pickFlow('+', flows).id, 3);
  assert.equal(pickFlow('гайд +', flows).id, 1);
  assert.equal(pickFlow('керемет видео', flows), null);
});

test('нөмір табу', () => {
  assert.equal(extractPhone('менің нөмірім 8 701 234 56 78'), '+77012345678');
  assert.equal(extractPhone('+7 (777) 123-45-67'), '+77771234567');
  assert.equal(extractPhone('7071234567'), '+77071234567');
  assert.equal(extractPhone('87011234567 жазыңыз'), '+77011234567');
  assert.equal(extractPhone('сәлем, 2024 жыл'), null);
  assert.equal(extractPhone('123 456 789 01'), null);
});

test('шифрлау', () => {
  const key = crypto.randomBytes(32).toString('base64');
  const blob = encrypt('IGAAtoken123', key);
  assert.notEqual(blob, 'IGAAtoken123');
  assert.equal(decrypt(blob, key), 'IGAAtoken123');
});

test('webhook қолтаңбасы', () => {
  const raw = '{"a":1}';
  const sig = 'sha256=' + crypto.createHmac('sha256', 's3cret').update(raw).digest('hex');
  assert.ok(validSignature(raw, sig, 's3cret'));
  assert.ok(!validSignature(raw, sig, 'other'));
  assert.ok(!validSignature(raw, null, 's3cret'));
});

test('payload талдау: коммент және DM, echo өткізіледі', () => {
  const ev = parseEvents({
    object: 'instagram',
    entry: [
      {
        id: '17841400000000000',
        changes: [{ field: 'comments', value: { id: 'c1', text: '+', from: { id: 'u1', username: 'aidana' }, media: { id: 'm1' } } }],
        messaging: [
          { sender: { id: 'u1' }, recipient: { id: '17841400000000000' }, message: { mid: 'x', text: '87011234567' } },
          { sender: { id: '17841400000000000' }, recipient: { id: 'u1' }, message: { mid: 'y', text: 'echo', is_echo: true } },
        ],
      },
    ],
  });
  assert.equal(ev.length, 2);
  assert.deepEqual(
    [ev[0].type, ev[0].commentId, ev[0].fromUsername, ev[1].type, ev[1].text],
    ['comment', 'c1', 'aidana', 'message', '87011234567'],
  );
});

import { almaty, lateMinutes, monthReport, reportCsv } from '../lib/attendance.js';

test('кешігу: Алматы уақыты, тек күннің алғашқы суреті, келмеген жұмыс күндері', () => {
  assert.equal(almaty(new Date('2026-10-01T04:17:30Z')).time, '09:17'); // UTC+5
  assert.equal(lateMinutes(9 * 60 + 17.5, 9 * 60), 17);
  assert.equal(lateMinutes(9 * 60 + 3, 9 * 60, 5), 0);
  const rows = [
    { emp_key: '1', name: 'Айгүл', day: '2026-10-01', at: '2026-10-01T03:55:00Z' },
    { emp_key: '1', name: 'Айгүл', day: '2026-10-02', at: '2026-10-02T04:40:00Z' },
    { emp_key: '1', name: 'Айгүл', day: '2026-10-02', at: '2026-10-02T04:17:30Z' },
    { emp_key: '2', name: 'Ерлан', day: '2026-10-01', at: '2026-10-01T05:05:00Z' },
  ];
  const r = monthReport(rows, 2026, 10, { startMin: 540, today: '2026-11-01' });
  assert.equal(r.workdays, 22);
  assert.deepEqual(r.data.map((e) => [e.name, e.total, e.lateDays, e.came, e.absent.length]), [['Ерлан', 65, 1, 1, 21], ['Айгүл', 17, 1, 2, 20]]);
  assert.ok(reportCsv(r).includes('"Айгүл";"2026-10-02";"09:17";"17"'));
});

import { findButton } from '../lib/handle.js';
import { buildMessage } from '../lib/ig.js';

test('батырмалар ағашы: payload жолы және келесі деңгей', () => {
  const flow = { dm_buttons: [{ title: 'Иә', text: 'Сұрақ', buttons: [{ title: 'А' }, { title: 'Б' }] }] };
  assert.equal(findButton(flow, '0').title, 'Иә');
  assert.equal(findButton(flow, '0.1').title, 'Б');
  assert.equal(findButton(flow, '0.5'), null);
  assert.deepEqual(buildMessage('x', null, 'f4'), { text: 'x' });
  const p1 = buildMessage('x', flow.dm_buttons, 'f4').attachment.payload.buttons.map((b) => b.payload);
  assert.deepEqual(p1, ['f4:0']);
  const p2 = buildMessage('x', flow.dm_buttons[0].buttons, 'f4:0').attachment.payload.buttons.map((b) => b.payload);
  assert.deepEqual(p2, ['f4:0.0', 'f4:0.1']);
});
