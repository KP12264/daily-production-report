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
  async function chartImage(config) {
    if (typeof Chart === 'undefined') return null;
    const host = $('expChartHost'), canvas = document.createElement('canvas'); canvas.width = 1120; canvas.height = 560; host.appendChild(canvas);
    const white = { id: 'white', beforeDraw: c => { const x = c.ctx; x.save(); x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.restore(); } };
    const chart = new Chart(canvas, { ...config, options: { ...config.options, responsive: false, animation: false, devicePixelRatio: 1 }, plugins: [white] });
    const url = canvas.toDataURL('image/png'); chart.destroy(); host.removeChild(canvas);
    return url.replace(/^data:image\/png;base64,/, '');
  }
  async function charts(model) {
    const navy = '#0B1F3A', blue = '#3B82F6';
    const font = { family: 'Calibri, Arial, sans-serif', size: 14 };
    const opts = title => ({ plugins: { title: { display: true, text: title, color: navy, font: { ...font, size: 18, weight: 'bold' } }, legend: { labels: { font } } }, scales: { x: { ticks: { font } }, y: { beginAtZero: true, ticks: { font } } } });
    const byLine = model.byLine.length ? await chartImage({ type: 'bar', data: { labels: model.byLine.map(g => g.lineName), datasets: [{ label: 'Adjusted Plan', data: model.byLine.map(g => g.plan), backgroundColor: navy }, { label: 'Actual', data: model.byLine.map(g => g.actual), backgroundColor: blue }] }, options: opts('Plan vs Actual by Line (pcs)') }) : null;
    const trend = model.byDate.length > 1 ? await chartImage({ type: 'line', data: { labels: model.byDate.map(g => g.date.slice(5)), datasets: [{ label: 'Adjusted Plan', data: model.byDate.map(g => g.planned ? g.plan : null), borderColor: navy, backgroundColor: navy, spanGaps: false }, { label: 'Actual', data: model.byDate.map(g => g.entered ? g.actual : null), borderColor: blue, backgroundColor: blue, spanGaps: false }] }, options: opts('Production Trend by Production Date (pcs)') }) : null;
    return { byLine, trend };
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
      const wb = Core.buildWorkbook(ExcelJS, model, imgs);
      const buf = await wb.xlsx.writeBuffer(); if (S.cancel) throw new Error('CANCELLED');
      const name = Core.fileNameFor(model), blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      progress(100, 'เสร็จสิ้น'); preview(model);
      const q = model.quality, done = model.completeness.complete;
      note(`ดาวน์โหลด ${name} แล้ว · ${model.units.length} Line×Shift×วัน · Firestore reads ${model.meta.reads}${data.cached ? ' (ใช้ข้อมูลที่โหลดไว้)' : ''}`
        + (done ? ' · ข้อมูลครบทุกหน่วย' : ` · ⚠ ข้อมูลไม่ครบ: ไม่มีแผน ${q.noPlan} · มีแผนแต่ไม่มียอดผลิต ${q.noEntry} · มียอดผลิตแต่ไม่มีแผน ${q.actualWithoutPlan} — ยอดรวมยังไม่ใช่ยอดที่ยืนยันครบ`), done ? 'plan-ok' : 'plan-warn');
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
