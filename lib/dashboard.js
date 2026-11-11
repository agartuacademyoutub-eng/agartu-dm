// «Дашборд» беті: бір қарағанда воронка көрінсін — KPI карточкалары (7 күн, алдыңғы 7 күнмен салыстыру),
// жалпы воронка, әр сценарий (воронка) бойынша кесте + график, күндік графиктер, үздік посттар.
// Графиктер әр жаңартуда өшіріліп, қайта салынады (кесте жолдары өзгеруі мүмкін).
const ALMATY_MS = 5 * 3600e3;
const almatyDate = (iso) => new Date(new Date(iso).getTime() + ALMATY_MS).toISOString().slice(0, 10);
const txt = (s) => (s == null || s === '' ? '' : "'" + String(s));
const firstLine = (s) => (s || '').split('\n')[0].trim() || '(жазусыз)';
const link = (url, label) => (url ? `=HYPERLINK("${url}","${label.slice(0, 70).replace(/"/g, '""')}")` : txt(label));
const ratio = (a, b) => (b ? a / b : '');
const since = (days) => Date.now() - days * 864e5;

const TEAL = { red: 0.05, green: 0.41, blue: 0.52 };
const LIGHT = { red: 0.91, green: 0.96, blue: 0.97 };
const GREEN = { red: 0.13, green: 0.55, blue: 0.27 };
const RED = { red: 0.8, green: 0.2, blue: 0.2 };
const GREY = { red: 0.45, green: 0.45, blue: 0.45 };

function change(cur, prev, isRate) {
  // Конверсия үшін пайыздық тармақ (п.п.) — «пайыздың пайызы» шатастырмасын
  if (isRate) {
    const d = (cur - prev) * 100;
    return Math.abs(d) < 0.05 ? '— алдыңғы 7 күндей' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)} п.п. алдыңғы 7 күнге`;
  }
  if (!prev) return cur ? '▲ жаңа' : '—';
  const d = (cur - prev) / prev;
  return `${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d * 100))}% алдыңғы 7 күнге`;
}

export async function writeDashboard(sh, { acc, posts, stats, perDay, now }) {
  const win = (from, to = Date.now()) => {
    const ps = posts.filter((p) => { const t = new Date(p.posted_at).getTime(); return t >= from && t < to; });
    const d0 = almatyDate(new Date(from).toISOString()), d1 = almatyDate(new Date(to).toISOString());
    const ss = stats.filter((s) => s.day >= d0 && (to === Date.now() || s.day < d1));
    const sum = (f) => ss.reduce((a, s) => a + (s[f] || 0), 0);
    const people = ps.reduce((a, p) => a + p.people, 0), leads = ps.reduce((a, p) => a + p.leads, 0);
    return { ps, people, leads, reach: sum('reach'), net: sum('new_followers') - sum('unfollows') };
  };
  const cur = win(since(7)), prev = win(since(14), since(7)), m = win(since(30));

  const rows = [];
  const headerRows = [], sectionRows = [], cellFormats = [];
  const push = (...r) => { rows.push(...r); return rows.length - r.length; };

  push([txt(`@${acc.username} · Воронка дашборды`)], [txt(`Жаңартылды: ${now} (Алматы) · күн сайын 09:00-де автоматты`)], []);
  // KPI: 5 карточка (A..E)
  const kpi = [
    ['Reach · 7 күн', cur.reach, prev.reach, '#,##0'],
    ['«+» жазған адам · 7 күн', cur.people, prev.people, '#,##0'],
    ['Нөмір қалдырды · 7 күн', cur.leads, prev.leads, '#,##0'],
    ['Конверсия «+» → нөмір', ratio(cur.leads, cur.people), ratio(prev.leads, prev.people), '0.0%'],
    ['Жазылушы өсімі · 7 күн', cur.net, prev.net, '+#,##0;-#,##0;0'],
  ];
  const kpiRow = push(kpi.map((k) => txt(k[0])), kpi.map((k) => k[1]), kpi.map((k) => txt(change(Number(k[1]) || 0, Number(k[2]) || 0, k[3] === '0.0%'))), []);
  kpi.forEach((k, i) => cellFormats.push([kpiRow + 1, kpiRow + 2, i, i + 1, k[3]]));

  // Жалпы воронка · 30 күн
  sectionRows.push(push([txt('Жалпы воронка · 30 күн')]));
  headerRows.push(push(['Кезең', 'Саны', 'Алдыңғы кезеңнен өтті']));
  const f0 = push(
    [txt('Reach (аккаунт, күндік қосынды)'), m.reach, ''],
    [txt('Триггер бар пост'), m.ps.filter((p) => p.people).length, txt(`${m.ps.length} посттың`)],
    [txt('«+» жазған адам'), m.people, ratio(m.people, m.reach)],
    [txt('Нөмір қалдырды'), m.leads, ratio(m.leads, m.people)],
  );
  cellFormats.push([f0, f0 + 4, 1, 2, '#,##0'], [f0 + 2, f0 + 3, 2, 3, '0.000%'], [f0 + 3, f0 + 4, 2, 3, '0.0%']);
  push([]);

  // Сценарийлер (воронкалар) · 30 күн
  const flows = {};
  for (const p of m.ps) {
    for (const [name, n] of Object.entries(p.flows || {})) {
      const f = (flows[name] ||= { posts: 0, people: 0, leads: 0 });
      f.posts++; f.people += n; f.leads += p.flowLeads?.[name] || 0;
    }
  }
  const flowList = Object.entries(flows).sort((a, b) => b[1].people - a[1].people);
  sectionRows.push(push([txt('Воронкалар (сценарий) бойынша · 30 күн')]));
  const flowHead = push(['Сценарий', 'Пост', '«+» адам', 'Нөмір', 'Конверсия']);
  headerRows.push(flowHead);
  for (const [name, f] of flowList) push([txt(name === '—' ? 'Сценарийсіз' : name), f.posts, f.people, f.leads, ratio(f.leads, f.people)]);
  if (!flowList.length) push([txt('30 күнде триггер-коммент болмады')]);
  const flowEnd = rows.length;
  cellFormats.push([flowHead + 1, flowEnd, 4, 5, '0.0%']);
  push([]);

  // Күн сайын · 30 күн (графиктерге дерек)
  sectionRows.push(push([txt('Күн сайын · 30 күн')]));
  const dayHead = push(['Күн', 'Reach', '«+» адам', 'Нөмір', 'Жаңа жазылушы']);
  headerRows.push(dayHead);
  const days = stats.filter((s) => s.day >= almatyDate(new Date(since(30)).toISOString())).sort((a, b) => a.day.localeCompare(b.day));
  for (const s of days) {
    const f = perDay[s.day] || { people: 0, leads: 0 };
    push([s.day, s.reach || 0, f.people, f.leads, (s.new_followers || 0) - (s.unfollows || 0)]);
  }
  const dayEnd = rows.length;
  cellFormats.push([dayHead + 1, dayEnd, 1, 2, '#,##0'], [dayHead + 1, dayEnd, 4, 5, '+#,##0;-#,##0;0']);
  push([]);

  // Үздік 5 пост · 30 күн
  sectionRows.push(push([txt('Үздік 5 пост · 30 күн (нөмір, сосын «+» бойынша)')]));
  const topHead = push(['Күні', 'Пост', '«+» адам', 'Нөмір', 'Конверсия']);
  headerRows.push(topHead);
  for (const p of [...m.ps].sort((a, b) => b.leads - a.leads || b.people - a.people).slice(0, 5)) {
    push([almatyDate(p.posted_at), link(p.permalink, (p.trial ? '[ПРОБНЫЙ] ' : '') + firstLine(p.caption)), p.people, p.leads, ratio(p.leads, p.people)]);
  }
  cellFormats.push([topHead + 1, rows.length, 4, 5, '0.0%']);

  const TITLE = 'Дашборд';
  const id = await sh.writeTab(TITLE, rows, { widths: [250, 150, 150, 150, 150, 30], filter: false, headerRows, cellFormats });

  // Безендіру: тақырып, KPI карточкалары, бөлім аттары; бетті бірінші орынға
  const meta = await sh.call('?fields=sheets(properties(sheetId,title),charts(chartId))');
  const old = meta.sheets.find((s) => s.properties.sheetId === id)?.charts || [];
  const cell = (r0, r1, c0, c1, fmt, fields) => ({ repeatCell: { range: { sheetId: id, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 }, cell: { userEnteredFormat: fmt }, fields: `userEnteredFormat(${fields})` } });
  const requests = [
    ...old.map((c) => ({ deleteEmbeddedObject: { objectId: c.chartId } })),
    { updateSheetProperties: { properties: { sheetId: id, index: 0, gridProperties: { hideGridlines: true } }, fields: 'index,gridProperties.hideGridlines' } },
    cell(0, 1, 0, 1, { textFormat: { bold: true, fontSize: 18, foregroundColor: TEAL } }, 'textFormat'),
    cell(1, 2, 0, 1, { textFormat: { italic: true, foregroundColor: GREY } }, 'textFormat'),
    cell(kpiRow, kpiRow + 3, 0, 5, { backgroundColor: LIGHT, horizontalAlignment: 'CENTER', wrapStrategy: 'WRAP' }, 'backgroundColor,horizontalAlignment,wrapStrategy'),
    cell(kpiRow, kpiRow + 1, 0, 5, { textFormat: { bold: true, foregroundColor: TEAL } }, 'textFormat'),
    cell(kpiRow + 1, kpiRow + 2, 0, 5, { textFormat: { bold: true, fontSize: 22 } }, 'textFormat'),
    { updateDimensionProperties: { range: { sheetId: id, dimension: 'ROWS', startIndex: kpiRow + 1, endIndex: kpiRow + 2 }, properties: { pixelSize: 44 }, fields: 'pixelSize' } },
    ...kpi.map((k, i) => {
      const c = Number(k[1]) || 0, p = Number(k[2]) || 0;
      return cell(kpiRow + 2, kpiRow + 3, i, i + 1, { textFormat: { fontSize: 9, foregroundColor: c > p ? GREEN : c < p ? RED : GREY } }, 'textFormat');
    }),
    ...sectionRows.map((r) => cell(r, r + 1, 0, 1, { textFormat: { bold: true, fontSize: 13, foregroundColor: TEAL } }, 'textFormat')),
    { updateBorders: { range: { sheetId: id, startRowIndex: kpiRow, endRowIndex: kpiRow + 3, startColumnIndex: 0, endColumnIndex: 5 }, innerVertical: { style: 'SOLID_THICK', color: { red: 1, green: 1, blue: 1 } } } },
  ];

  // Графиктер оң жақта (G бағанынан)
  const src = (r0, r1, c) => ({ sourceRange: { sources: [{ sheetId: id, startRowIndex: r0, endRowIndex: r1, startColumnIndex: c, endColumnIndex: c + 1 }] } });
  const chart = (title, type, r0, r1, series, anchorRow, extra = {}) => ({
    addChart: { chart: {
      spec: { title, basicChart: {
        chartType: type, legendPosition: 'BOTTOM_LEGEND', headerCount: 1,
        domains: [{ domain: src(r0, r1, 0) }],
        series: series.map(([c, color, axis]) => ({ series: src(r0, r1, c), targetAxis: axis || (type === 'BAR' ? 'BOTTOM_AXIS' : 'LEFT_AXIS'), color })),
        ...extra,
      } },
      position: { overlayPosition: { anchorCell: { sheetId: id, rowIndex: anchorRow, columnIndex: 6 }, widthPixels: 620, heightPixels: 300 } },
    } },
  });
  if (flowList.length) requests.push(chart('Воронкалар: «+» адам және нөмір (30 күн)', 'BAR', flowHead, flowEnd, [[2, TEAL], [3, GREEN]], kpiRow));
  if (days.length) {
    requests.push(chart('Күн сайын: «+» адам және нөмір', 'LINE', dayHead, dayEnd, [[2, TEAL], [3, GREEN]], kpiRow + 17));
    requests.push(chart('Күн сайын: Reach', 'COLUMN', dayHead, dayEnd, [[1, { red: 0.55, green: 0.75, blue: 0.82 }]], kpiRow + 34));
  }
  await sh.call(':batchUpdate', 'POST', { requests });
  return { flows: flowList.length, days: days.length };
}
