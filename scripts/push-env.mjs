// .env.local-дағы кілттерді Vercel production env-ке жүктейді (мәнде бос орын/BOM болмасын).
// Қолдану: node scripts/push-env.mjs KEY1 KEY2 ...   (аргументсіз — бәрі, VERCEL_* қоспағанда)
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').replace(/^﻿/, '').split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
);
const keys = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(env).filter((k) => !k.startsWith('VERCEL_'));
for (const k of keys) {
  if (!env[k]) { console.log(`skip ${k} (жоқ)`); continue; }
  spawnSync('vercel env rm ' + k + ' production --yes', { shell: true, stdio: 'ignore' });
  const r = spawnSync('vercel env add ' + k + ' production', { shell: true, input: env[k], encoding: 'utf8' });
  console.log(`${k}: ${r.status === 0 ? 'ok' : 'FAIL ' + (r.stderr || '').split('\n').filter(Boolean).slice(-1)[0]}`);
}
