// Воронканы толтыру: комменттер + Директтегі нөмірлер.
// Қолдану: node scripts/funnel-sync.mjs [күн саны, әдепкі 90]
import fs from 'node:fs';

for (const l of fs.readFileSync('.env.local', 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  if (/^[A-Z0-9_]+=/.test(l)) process.env[l.slice(0, l.indexOf('='))] = l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '');
}
const { listAccounts } = await import('../lib/db.js');
const { syncComments, syncPhones } = await import('../lib/funnel.js');

const days = Number(process.argv[2]) || 90;
for (const acc of await listAccounts()) {
  const t0 = Date.now();
  await syncComments(acc, days, console.log);
  await syncPhones(acc, { days, recheckHours: 6, log: console.log });
  console.log(`  ${Math.round((Date.now() - t0) / 1000)} с`);
}
