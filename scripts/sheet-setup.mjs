// Google Sheets кестесін пайдаланушы атынан құрып, service account-қа өңдеу рұқсатын береді.
// Қолдану: node scripts/sheet-setup.mjs <user_access_token (drive scope)> <service_account_email>
const [token, saEmail] = process.argv.slice(2);
if (!token || !saEmail) { console.log('usage: sheet-setup.mjs <token> <sa_email>'); process.exit(1); }
const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const r = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
  method: 'POST', headers: h,
  body: JSON.stringify({ properties: { title: 'AĞARTU · Instagram воронка', locale: 'en_US', timeZone: 'Asia/Almaty' } }),
});
const s = await r.json();
if (!s.spreadsheetId) { console.log('create failed', JSON.stringify(s).slice(0, 400)); process.exit(1); }
const p = await fetch(`https://www.googleapis.com/drive/v3/files/${s.spreadsheetId}/permissions?sendNotificationEmail=false`, {
  method: 'POST', headers: h, body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: saEmail }),
});
console.log('share', p.status);
console.log('SHEET_ID=' + s.spreadsheetId);
