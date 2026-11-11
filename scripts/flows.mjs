// Сценарийлерді басқару (service_role арқылы):
//   node scripts/flows.mjs list
//   node scripts/flows.mjs add flow.json        — {name, keywords[], dm_text, public_reply?, priority?}
//   node scripts/flows.mjs update <id> patch.json
//   node scripts/flows.mjs off <id> | on <id>
import fs from 'node:fs';

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
);
const base = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/flows`;
const headers = {
  apikey: env.SUPABASE_SERVICE_ROLE_KEY,
  Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
};
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));

const [cmd, a, b] = process.argv.slice(2);
let res;
if (cmd === 'list') res = await fetch(`${base}?select=id,name,keywords,priority,active&order=priority.asc,id.asc`, { headers });
else if (cmd === 'add') res = await fetch(base, { method: 'POST', headers, body: JSON.stringify(readJson(a)) });
else if (cmd === 'update') res = await fetch(`${base}?id=eq.${a}`, { method: 'PATCH', headers, body: JSON.stringify(readJson(b)) });
else if (cmd === 'off' || cmd === 'on') res = await fetch(`${base}?id=eq.${a}`, { method: 'PATCH', headers, body: JSON.stringify({ active: cmd === 'on' }) });
else { console.log('commands: list | add <json> | update <id> <json> | off <id> | on <id>'); process.exit(1); }
console.log(res.status, JSON.stringify(await res.json(), null, 1));
