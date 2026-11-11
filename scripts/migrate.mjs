// supabase/schema.sql-ды базаға жүргізеді. Қолдану: node scripts/migrate.mjs
// pg пакеті жобаға қосылмайды: npx -y -p pg node scripts/migrate.mjs
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pg = require(require.resolve('pg', { paths: [process.cwd(), ...(process.env.NODE_PATH || '').split(';')] }));

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim().replace(/^"|"$/g, '')]),
);
const url = env.POSTGRES_URL_NON_POOLING.replace(/[?&]sslmode=[^&]*/, '');
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
for (const f of ['supabase/schema.sql', 'supabase/flows.sql']) {
  await client.query(fs.readFileSync(f, 'utf8'));
}
const { rows } = await client.query(
  "select table_name from information_schema.tables where table_schema='public' order by 1",
);
console.log('tables:', rows.map((r) => r.table_name).join(', '));
await client.end();
