// Өткен күндердің статистикасын бірден толтыру (insights рұқсаты болса).
// Қолдану: node scripts/stats-backfill.mjs [күн саны, әдепкі 30]
import fs from 'node:fs';

for (const l of fs.readFileSync('.env.local', 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
  if (/^[A-Z0-9_]+=/.test(l)) process.env[l.slice(0, l.indexOf('='))] = l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '');
}
const { listAccounts } = await import('../lib/db.js');
const { collectDay } = await import('../lib/collect.js');

const days = Number(process.argv[2]) || 30;
for (const acc of await listAccounts()) {
  let ok = 0, err = null;
  for (let i = 1; i <= days; i++) {
    const r = await collectDay(acc, -i, { withProfile: i === 1 });
    if (r.insightsError) err = r.insightsError; else ok++;
  }
  console.log(`@${acc.username}: ${ok}/${days} күн insights${err ? ` · соңғы қате: ${err}` : ''}`);
}
