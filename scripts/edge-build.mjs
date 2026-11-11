// edge/ + api/ + lib/ → supabase/functions/api/ (Supabase CLI тек functions ішіндегі файлдарды жинайды)
import fs from 'node:fs';
const out = 'supabase/functions/api';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync('edge', out, { recursive: true });
fs.cpSync('lib', `${out}/lib`, { recursive: true });
fs.cpSync('api', `${out}/api`, { recursive: true, filter: (p) => !/[\\/]cron[\\/]repost\.js$/.test(p) });
fs.rmSync(`${out}/lib/repost.js`);
fs.renameSync(`${out}/index.js`, `${out}/index.ts`); // CLI index.ts күтеді
console.log('built', out);
