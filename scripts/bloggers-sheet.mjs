// «Блогерлер» бетін Google Sheet-те бір рет құрады: node scripts/bloggers-sheet.mjs <bloggers.json> [--force]
// Бет бар болса тоқтайды — қолмен толтырылған Статус/Бағасы/Байланыс өшіп қалмасын. Күнделікті есеп бұл бетке тимейді.
import fs from 'node:fs';

for (const l of fs.readFileSync('.env.local', 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  if (/^[A-Z0-9_]+=/.test(l)) process.env[l.slice(0, l.indexOf('='))] = l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '');
}
const { cfg } = await import('../lib/config.js');
const { client } = await import('../lib/sheets.js');

const TITLE = 'Блогерлер';
const STATUSES = ['Жаңа', 'Хабарластық', 'Бағасын білдік', 'Келістік', 'Бас тартты'];
export const BLOGGER_COLS = [
  '№', 'Ұсынылған', 'Топ', 'Блогер', 'Instagram', 'Жазылушы (дереккөз бойынша)', 'Дереккөз', 'Бағыты', 'Неге сәйкес',
  'Жазылушы (қазір)', 'Өсім, 7 күн', 'Орт. лайк (12 пост)', 'Орт. коммент', 'ER %', 'Соңғы пост', 'Жаңартылды',
  'Статус', 'Бағасы (₸)', 'Байланыс', 'Ескерту',
];
const AUTO = [9, 15]; // J..P — бот толтырады
const MANUAL = [16, 19]; // Q..T — өзіңіз толтырасыз

const [file, flag] = process.argv.slice(2);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const sh = client(cfg.googleSa, cfg.sheetId);
const meta = await sh.call('?fields=sheets.properties');
if (meta.sheets.some((s) => s.properties.title === TITLE) && flag !== '--force') {
  console.log(`«${TITLE}» беті бар — қолмен енгізілгендер өшпеуі үшін тоқтадым (--force қайта жазады).`);
  process.exit(0);
}

const txt = (s) => (s === '' || s == null ? '' : "'" + String(s));
const ig = (h) => (String(h).startsWith('@') ? `=HYPERLINK("https://www.instagram.com/${h.slice(1)}/","${h}")` : txt(h || 'табылмады'));
const rows = [BLOGGER_COLS];
let n = 0;
// xlsx бағандары: Ұсынылған [№,Топ,Блогер,IG,Жазылушы,Дереккөз,Бағыты,Неге,Статус,...]; Басқа [№,Топ,Блогер,IG,Жазылушы,Дереккөз,Бағыты]
for (const r of data['Ұсынылған']) rows.push([++n, 'иә', txt(r[1]), txt(r[2]), ig(r[3]), txt(r[4]), txt(r[5]), txt(r[6]), txt(r[7]), '', '', '', '', '', '', '', r[8] || 'Жаңа', r[9] || '', txt(r[10]), txt(r[11])]);
for (const r of data['Басқа блогерлер']) rows.push([++n, 'жоқ', txt(r[1]), txt(r[2]), ig(r[3]), txt(r[4]), txt(r[5]), txt(r[6]), '', '', '', '', '', '', '', '', 'Жаңа', '', '', '']);

const id = await sh.writeTab(TITLE, rows, {
  widths: [40, 85, 85, 200, 190, 170, 170, 230, 250, 110, 90, 100, 95, 70, 95, 120, 130, 100, 170, 200],
  numberFormats: { 9: '#,##0', 10: '+#,##0;-#,##0;0', 11: '#,##0', 12: '#,##0', 13: '0.00%', 17: '#,##0' },
});
const last = rows.length;
const range = (c0, c1) => ({ sheetId: id, startRowIndex: 1, endRowIndex: last, startColumnIndex: c0, endColumnIndex: c1 + 1 });
const fill = (rgb) => ({ userEnteredFormat: { backgroundColor: rgb } });
await sh.call(':batchUpdate', 'POST', {
  requests: [
    { repeatCell: { range: range(...MANUAL), cell: fill({ red: 1, green: 0.97, blue: 0.8 }), fields: 'userEnteredFormat.backgroundColor' } },
    { repeatCell: { range: range(...AUTO), cell: fill({ red: 0.93, green: 0.96, blue: 0.97 }), fields: 'userEnteredFormat.backgroundColor' } },
    { setDataValidation: { range: range(16, 16), rule: { condition: { type: 'ONE_OF_LIST', values: STATUSES.map((v) => ({ userEnteredValue: v })) }, showCustomUi: true, strict: true } } },
    { addConditionalFormatRule: { index: 0, rule: { ranges: [range(0, 19)], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=$Q2="Келістік"' }] }, format: { backgroundColor: { red: 0.85, green: 0.95, blue: 0.85 } } } } } },
    { addConditionalFormatRule: { index: 1, rule: { ranges: [range(0, 19)], booleanRule: { condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: '=$Q2="Бас тартты"' }] }, format: { textFormat: { strikethrough: true, foregroundColor: { red: 0.6, green: 0.6, blue: 0.6 } } } } } } },
    { updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: 1, frozenColumnCount: 4 } }, fields: 'gridProperties(frozenRowCount,frozenColumnCount)' } },
  ],
});
console.log(`«${TITLE}» құрылды: ${last - 1} блогер`);
