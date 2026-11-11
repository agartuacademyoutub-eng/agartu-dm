// Google Sheets есебін қолмен жаңарту: node scripts/sheet-update.mjs
import fs from 'node:fs';

for (const l of fs.readFileSync('.env.local', 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  if (/^[A-Z0-9_]+=/.test(l)) process.env[l.slice(0, l.indexOf('='))] = l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '');
}
const { mainAccount } = await import('../lib/db.js');
const { updateSheet } = await import('../lib/report.js');
const acc = await mainAccount();
console.log(await updateSheet(acc));
