// Google Sheets API: service account (GOOGLE_SA_JSON) арқылы. SDK керек емес — JWT-ті өзіміз қолтаңбалаймыз.
import crypto from 'node:crypto';

const b64u = (s) => Buffer.from(s).toString('base64url');
let cached = null;

async function accessToken(sa) {
  if (cached && cached.exp > Date.now() + 60e3) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${claim}`), sa.private_key).toString('base64url');
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${sig}` }),
  });
  const j = await res.json();
  if (!j.access_token) throw new Error(`google token: ${JSON.stringify(j).slice(0, 200)}`);
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

export function client(saJson, spreadsheetId) {
  const sa = typeof saJson === 'string' ? JSON.parse(saJson) : saJson;
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const call = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, {
      method,
      headers: { Authorization: `Bearer ${await accessToken(sa)}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`sheets ${method} ${path.split('?')[0]}: ${res.status} ${JSON.stringify(j.error || j).slice(0, 300)}`);
    return j;
  };

  // Бетті толық қайта жазу: жоқ болса құрамыз, тазалаймыз, жазамыз, тақырып жолын безендіреміз.
  // Бір бетте бірнеше кесте болса: headerRows — әр кестенің тақырып жолы, filter: false.
  async function writeTab(title, rows, { widths = [], numberFormats = {}, headerRows = [0], filter = true, cellFormats = [] } = {}) {
    const meta = await call('?fields=sheets.properties');
    let sheet = meta.sheets.find((s) => s.properties.title === title);
    if (!sheet) {
      const r = await call(':batchUpdate', 'POST', { requests: [{ addSheet: { properties: { title } } }] });
      sheet = { properties: r.replies[0].addSheet.properties };
    }
    const id = sheet.properties.sheetId;
    const cols = Math.max(...rows.map((r) => r.length));
    await call(`/values/${encodeURIComponent(`'${title}'`)}:clear`, 'POST', {});
    await call(':batchUpdate', 'POST', { requests: [
      { clearBasicFilter: { sheetId: id } },
      { repeatCell: { range: { sheetId: id }, cell: { userEnteredFormat: {} }, fields: 'userEnteredFormat' } }, // ескі пішімдер қалмасын
    ] });
    await call(`/values/${encodeURIComponent(`'${title}'!A1`)}?valueInputOption=USER_ENTERED`, 'PUT', { values: rows });
    const requests = [
      { updateSheetProperties: { properties: { sheetId: id, gridProperties: { frozenRowCount: filter ? 1 : 0 } }, fields: 'gridProperties.frozenRowCount' } },
      ...headerRows.map((r) => ({ repeatCell: { range: { sheetId: id, startRowIndex: r, endRowIndex: r + 1, startColumnIndex: 0, endColumnIndex: Math.max(1, rows[r]?.length || 1) }, cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } }, backgroundColor: { red: 0.05, green: 0.41, blue: 0.52 }, wrapStrategy: 'WRAP', verticalAlignment: 'MIDDLE' } }, fields: 'userEnteredFormat(textFormat,backgroundColor,wrapStrategy,verticalAlignment)' } })),
      ...cellFormats.map(([r0, r1, c0, c1, pattern]) => ({ repeatCell: { range: { sheetId: id, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern } } }, fields: 'userEnteredFormat.numberFormat' } })),
      ...widths.map((px, i) => ({ updateDimensionProperties: { range: { sheetId: id, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: 'pixelSize' } })),
      ...Object.entries(numberFormats).map(([col, pattern]) => ({
        repeatCell: { range: { sheetId: id, startRowIndex: 1, startColumnIndex: Number(col), endColumnIndex: Number(col) + 1 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern } } }, fields: 'userEnteredFormat.numberFormat' },
      })),
    ];
    if (cols && filter) requests.push({ setBasicFilter: { filter: { range: { sheetId: id, startRowIndex: 0, endRowIndex: rows.length, startColumnIndex: 0, endColumnIndex: cols } } } });
    await call(':batchUpdate', 'POST', { requests });
    return id;
  }

  async function removeDefaultTab() {
    const meta = await call('?fields=sheets.properties');
    const def = meta.sheets.find((s) => ['Sheet1', 'Лист1', 'Парақ1'].includes(s.properties.title));
    if (def && meta.sheets.length > 1) await call(':batchUpdate', 'POST', { requests: [{ deleteSheet: { sheetId: def.properties.sheetId } }] });
  }

  return { writeTab, removeDefaultTab, call };
}
