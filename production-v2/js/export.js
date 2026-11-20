// Production V2 — Reports → Export Excel page. Read-only: never writes to Firestore.
// Data: 3 range queries per export (prodV2_dailyPlans, prodV2_actualLogs, prodV2_lossLogs where
// date between start and end) + prodV2_lines once. Line / Shift filters are applied in the browser.
// Calculations and the workbook live in js/export-core.js (PV2ExportCore).
(() => {
  const $ = id => document.getElementById(id);
  const Core = window.PV2ExportCore;
  const CACHE_MS = 5 * 60 * 1000;                     // reuse a period's documents for 5 minutes
  const S = { allowed: false, lines: null, cache: new Map(), busy: false, cancel: false, reads: 0 };
  const z = n => String(n).padStart(2, '0');
  const localDate = (d = new Date()) => `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;

  function stat(t, c = '') { const e = $('expStatus'); e.textContent = t; e.className = 'hero-status ' + c; }
  function note(t, c = '') { const e = $('expMessage'); e.textContent = t; e.className = 'notice info-notice ' + c; }
  function progress(pct, text) { $('expProgress').hidden = false; $('expProgressBar').style.width = Math.max(0, Math.min(100, pct)) + '%'; $('expProgressText').textContent = text; }
  function setBusy(b) { S.busy = b; $('expRunBtn').disabled = b || !S.allowed; $('expCancelBtn').hidden = !b; document.querySelectorAll('#expForm select, #expForm input').forEach(x => { x.disabled = b || !S.allowed; }); }
  const friendly = e => (window.ProdV2Auth && e && /permission/i.test(e.code || e.message || '')) ? 'ไม่มีสิทธิ์อ่านข้อมูล (permission denied)' : (e && e.message) || String(e);

  function showPeriodInputs() {
    const p = $('expPeriod').value;
    $('expDailyWrap').hidden = p !== 'daily'; $('expWeeklyWrap').hidden = p !== 'weekly'; $('expMonthlyWrap').hidden = p !== 'monthly';
  }
  function params() {
    return { period: $('expPeriod').value, date: $('expDate').value, start: $('expStart').value, end: $('expEnd').value, month: $('expMonth').value, line: $('expLine').value, shift: $('expShift').value };
  }

  async function loadLines() {
    if (S.lines) return S.lines;
    const snap = await ProdV2DB.collection('prodV2_lines').get(); S.reads += Math.max(1, snap.size);
    S.lines = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const sorted = S.lines.slice().sort((a, b) => (a.active === false) - (b.active === false) || (Number(a.order) || 99) - (Number(b.order) || 99));
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    $('expLine').innerHTML = '<option value="ALL">All Lines</option>' + sorted.map(l => { const id = String(l.lineId || l.code || l.id).toUpperCase(); return `<option value="${esc(id)}">${esc(l.lineName || l.name || 'Line ' + id)}${l.active === false ? ' (inactive)' : ''}</option>`; }).join('');
    return S.lines;
  }

  async function rangeQuery(collection, start, end) {
    const snap = await ProdV2DB.collection(collection).where('date', '>=', start).where('date', '<=', end).get();
    S.reads += Math.max(1, snap.size);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  async function fetchPeriod(period) {
    const key = period.start + '|' + period.end, hit = S.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.data, cached: true, asOf: hit.asOf };
    let done = 0; const tick = name => { done++; progress(10 + done * 20, `อ่านข้อมูล ${name} แล้ว (${done}/3)`); };
    const [plans, actuals, losses] = await Promise.all([
      rangeQuery('prodV2_dailyPlans', period.start, period.end).then(r => { tick('Daily Plan'); return r; }),
      rangeQuery('prodV2_actualLogs', period.start, period.end).then(r => { tick('Production Entry'); return r; }),
      rangeQuery('prodV2_lossLogs', period.start, period.end).then(r => { tick('Loss'); return r; })]);
    const asOf = new Date().toLocaleString('en-GB', { hour12: false });
    const data = { plans, actuals, losses };
    S.cache.set(key, { at: Date.now(), asOf, data });
    return { ...data, cached: false, asOf };
  }

  // Chart images (Excel has no native charts in ExcelJS): drawn with Chart.js from the aggregated tables.
  // Chart images for the Executive Summary (ExcelJS cannot write native Excel charts). What to draw
  // and the size come from PV2ExportCore.chartSpec(); rendered at 2× for a sharp print.
  const SCALE = 2;
  async function chartImage(c) {
    if (typeof Chart === 'undefined') return null;
    const px = n => n * SCALE, navy = '#0B1F3A';
    const font = { family: 'Calibri, Arial, sans-serif', size: px(12) };
    const host = $('expChartHost'), canvas = document.createElement('canvas'); canvas.width = px(c.width); canvas.height = px(c.height); host.appendChild(canvas);
    const white = { id: 'white', beforeDraw: ch => { const x = ch.ctx; x.save(); x.fillStyle = '#ffffff'; x.fillRect(0, 0, ch.width, ch.height); x.restore(); } };
    const line = c.kind === 'line';
    // grouped (Line × Shift): Plan | Actual bars touch; a transparent spacer separates DAY from NIGHT;
    // the gap between Lines (1 − categoryPercentage) is wider than the DAY / NIGHT gap.
    const ds = sr => ({ label: sr.label, data: sr.data, backgroundColor: sr.color, borderColor: sr.color, spanGaps: false, pointRadius: line ? px(2.5) : 0, pointHoverRadius: 0,
      borderWidth: line ? px(1.8) : 0, maxBarThickness: px(c.grouped ? 16 : 30), categoryPercentage: c.grouped ? 0.74 : 0.75, barPercentage: c.grouped ? 1 : 0.85 });
    const series = c.shiftGap ? [...c.series.slice(0, 2), { label: '', data: c.labels.map(() => null), color: 'rgba(0,0,0,0)', spacer: true }, ...c.series.slice(2)] : c.series;
    // "Line X (no data)" → two-line label so the indicator is readable; every date / line label is kept (no auto-skip)
    const labels = c.labels.map(l => / \(no data\)$/.test(l) ? [l.replace(/ \(no data\)$/, ''), '(no data)'] : l);
    const value = { ticks: { font, callback: v => Number(v).toLocaleString('en-US') }, beginAtZero: true, grid: { color: '#E2E8F0' } };
    const cat = { ticks: { font: { ...font, size: px(c.trend && c.labels.length > 16 ? 11 : 12) }, autoSkip: false, maxRotation: c.trend ? 60 : 35, minRotation: 0, color: ctx => /no data/.test(String(ctx.tick && ctx.tick.label)) ? '#991B1B' : '#334155' }, grid: { display: false } };
    const chart = new Chart(canvas, { type: line ? 'line' : 'bar', data: { labels, datasets: series.map(ds) },
      options: { responsive: false, animation: false, devicePixelRatio: 1, layout: { padding: { left: px(6), right: px(10), top: px(4), bottom: px(2) } },
        plugins: { title: { display: true, text: c.title, color: navy, font: { ...font, size: px(13), weight: 'bold' }, padding: { bottom: px(c.subtitle ? 2 : 4) } },
          subtitle: { display: !!c.subtitle, text: c.subtitle || '', color: '#334155', font: { ...font, size: px(11) }, padding: { bottom: px(4) } },
          legend: { labels: { font, boxWidth: px(c.grouped ? 16 : 12), boxHeight: px(12), padding: px(c.grouped ? 14 : 10), filter: it => !!it.text } } },
        scales: { x: cat, y: value } }, plugins: [white] });
    const url = canvas.toDataURL('image/png'); chart.destroy(); host.removeChild(canvas);
    return url.replace(/^data:image\/png;base64,/, '');
  }
  async function charts(model) {
    const spec = Core.chartSpec(model);
    return { left: spec.left.labels.length ? await chartImage(spec.left) : null, right: spec.right.labels.length && spec.right.series.length ? await chartImage(spec.right) : null };
  }

  function preview(model) {
    const T = model.totals, f = n => Number(n || 0).toLocaleString('en-US');
    $('expPreview').hidden = false;
    $('expPreview').innerHTML = `<div class="exp-kpi"><small>Adjusted Plan</small><b>${f(T.plan)}</b></div><div class="exp-kpi"><small>Actual</small><b>${f(T.actual)}</b></div>`
      + `<div class="exp-kpi"><small>Achievement</small><b>${T.achievement == null ? '—' : (T.achievement * 100).toFixed(1) + '%'}</b></div><div class="exp-kpi ${T.gap < 0 ? 'is-neg' : ''}"><small>Gap</small><b>${T.gap > 0 ? '+' : ''}${f(T.gap)}</b></div>`
      + `<div class="exp-kpi"><small>Loss excl. Material · event-min sum</small><b>${f(T.lossExclMaterial)} min</b></div><div class="exp-kpi"><small>Material · event-min sum</small><b>${f(T.material)} min</b></div>`
      + `<div class="exp-complete ${model.completeness.complete ? 'is-ok' : 'is-bad'}">${model.completeness.complete ? '✓ Data complete for every Line × Shift × Date in this report' : '⚠ DATA INCOMPLETE — totals are not fully verified production totals'}${[...model.completeness.issues, ...model.completeness.notes].map(t => '<br>· ' + String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))).join('')}</div>`;
  }

  async function run() {
    if (S.busy || !S.allowed) return;
    let period; const p = params();
    try { period = Core.resolvePeriod(p); } catch (e) { note(e.message, 'plan-warn'); stat('Check input', 'err'); return; }
    if (typeof ExcelJS === 'undefined') { note('โหลดไลบรารี Excel ไม่สำเร็จ — ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วโหลดหน้าใหม่', 'plan-warn'); stat('Library missing', 'err'); return; }
    S.cancel = false; setBusy(true); stat('Exporting...'); note('กำลังสร้างรายงาน…'); progress(5, 'เตรียมข้อมูล');
    const reads0 = S.reads;
    try {
      const lines = await loadLines();
      const data = await fetchPeriod(period); if (S.cancel) throw new Error('CANCELLED');
      progress(75, 'คำนวณยอดรวม');
      const model = Core.aggregate({ lines, ...data }, period, { line: p.line, shift: p.shift });
      model.meta = { generatedAt: new Date().toLocaleString('en-GB', { hour12: false }), generatedAtIso: new Date().toISOString(), dataAsOf: data.asOf + (data.cached ? ' (reused, ≤ 5 min old)' : ''), reads: S.reads - reads0 };
      if (!model.units.length) { note('ไม่พบ Line / Shift ที่ตรงกับตัวกรองในช่วงนี้', 'plan-warn'); stat('No data', 'err'); return; }
      progress(82, 'สร้างกราฟ'); const imgs = await charts(model); if (S.cancel) throw new Error('CANCELLED');
      progress(90, 'สร้างไฟล์ Excel');
      const wb = Core.buildWorkbook(ExcelJS, model, imgs, { sample: window.PV2_EXPORT_SAMPLE_DATA === true });   // set only by test harnesses
      const buf = await wb.xlsx.writeBuffer(); if (S.cancel) throw new Error('CANCELLED');
      const name = Core.fileNameFor(model), blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      progress(100, 'เสร็จสิ้น'); preview(model);
      const q = model.quality, done = model.completeness.complete;
      note(`ดาวน์โหลด ${name} แล้ว · ${model.units.length} Line×Shift×วัน · Firestore reads ${model.meta.reads}${data.cached ? ' (ใช้ข้อมูลที่โหลดไว้)' : ''}`
        + (done ? ' · ข้อมูลครบทุกหน่วย' : ` · ⚠ ข้อมูลไม่ครบ: ไม่มีทั้งแผนและยอดผลิต ${q.noPlan} · มีแผนแต่ไม่มียอดผลิต ${q.noEntry} · มียอดผลิตแต่ไม่มีแผน ${q.actualWithoutPlan} (${q.actualWithoutPlanQty} ชิ้น ไม่นับใน Actual) — ยอดรวมยังไม่ใช่ยอดที่ยืนยันครบ`), done ? 'plan-ok' : 'plan-warn');
      stat('Exported', 'ok');
    } catch (e) {
      if (e && e.message === 'CANCELLED') { note('ยกเลิกการ Export แล้ว — ไม่ได้สร้างไฟล์', 'plan-warn'); stat('Cancelled', 'err'); }
      else { console.error(e); note('Export ไม่สำเร็จ: ' + friendly(e), 'plan-warn'); stat('Export failed', 'err'); }
    } finally { setBusy(false); }
  }

  async function onUser(user) {
    S.allowed = false; setBusy(false);
    if (!user) { $('expLocked').hidden = false; $('expLocked').textContent = 'ต้อง Login ด้วยบัญชีพนักงานที่ได้รับสิทธิ์ก่อนจึงจะ Export ได้'; $('expForm').classList.add('is-locked'); stat('Login required', 'err'); return; }
    try {
      const email = String(user.email || '').toLowerCase();
      const doc = await ProdV2DB.collection('prodV2_authorizedUsers').doc(email).get(); S.reads += 1;
      if (!doc.exists) { $('expLocked').hidden = false; $('expLocked').textContent = 'บัญชีนี้ไม่มีสิทธิ์ Export (ไม่อยู่ในรายชื่อผู้มีสิทธิ์)'; $('expForm').classList.add('is-locked'); stat('Not authorized', 'err'); return; }
      await loadLines();
      S.allowed = true; $('expLocked').hidden = true; $('expForm').classList.remove('is-locked'); setBusy(false); stat('Ready', 'ok'); note('เลือกช่วงเวลา Line และ Shift แล้วกด Export Excel');
    } catch (e) { console.error(e); note('ตรวจสิทธิ์ไม่สำเร็จ: ' + friendly(e), 'plan-warn'); stat('Error', 'err'); }
  }

  function init() {
    const today = localDate(), d = new Date();
    $('expDate').value = today; $('expEnd').value = today; $('expStart').value = Core.addDays(today, -6); $('expMonth').value = `${d.getFullYear()}-${z(d.getMonth() + 1)}`;
    $('expPeriod').onchange = showPeriodInputs; showPeriodInputs();
    $('expRunBtn').onclick = run; $('expCancelBtn').onclick = () => { S.cancel = true; $('expProgressText').textContent = 'กำลังยกเลิก…'; };
    setBusy(false);
    if (window.ProdV2Auth) ProdV2Auth.mountGate({ hostId: 'authGateHost', logoutHostId: 'authBar', onReady: onUser });
    else onUser(null);
  }
  addEventListener('DOMContentLoaded', init);
})();
