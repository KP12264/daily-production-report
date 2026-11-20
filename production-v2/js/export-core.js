// Production V2 — Excel export core (pure functions; no Firestore, no DOM).
// Used by js/export.js in the browser and by the Node tests. Reads nothing, writes nothing.
//
// Calculation contract (matches Production Entry / Daily Plan, see EXPORT-README in the PR):
//  - Unit = one Production Date × Line × Shift (DAY / NIGHT). The Production Date is the
//    `date` stored on the documents, so a Night shift after midnight stays on its date.
//  - Adjusted Plan = plan.adjustedPlan ?? plan.totalPlan ?? 0  (what Entry shows).
//    Original Plan  = plan.originalPlan ?? plan.totalPlan ?? 0.
//  - Actual = sum of actualByCell values whose exact key "blockIndex|||model|||door" exists
//    in plan.blocks[].cells (Entry actualTotal()). Other keys = "Unplanned / stale actual",
//    reported separately and never added to Actual.
//  - Gap = Actual − Adjusted Plan. Achievement = Actual ÷ Adjusted Plan (blank when Plan = 0).
//    Every total re-computes Achievement from summed Actual and Plan; percentages are never added.
//  - Missing data stays missing: no plan document = "NO PLAN", no actual document = "NO ENTRY".
//  - Loss = Pallet Change (plan.masterSnapshot.palletChangeLosses) + Manual (prodV2_lossLogs).
//    Material is reported separately: "Loss excl. Material" and "Material"; "Total incl. Material".
//    Manual loss that overlaps a Pallet Change interval is flagged, not removed.
(function (root) {
  'use strict';
  const SHIFTS = ['DAY', 'NIGHT'];
  const MAX_DAYS = 31;
  const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const up = v => String(v == null ? '' : v).trim().toUpperCase();

  function addDays(d, n) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
  function daysBetween(a, b) { return Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 86400000); }
  function lastDayOfMonth(ym) { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }

  // Period → {start, end, dates[]}; throws a readable error for invalid input.
  function resolvePeriod({ period, date, start, end, month }) {
    let s, e;
    if (period === 'daily') { if (!isDate(date)) throw new Error('เลือก Production Date'); s = e = date; }
    else if (period === 'weekly') { if (!isDate(start) || !isDate(end)) throw new Error('เลือกช่วงวันที่ให้ครบ'); s = start; e = end; }
    else if (period === 'monthly') { if (!/^\d{4}-\d{2}$/.test(month || '')) throw new Error('เลือกเดือน'); s = month + '-01'; e = lastDayOfMonth(month); }
    else throw new Error('Report Period ไม่ถูกต้อง');
    if (e < s) throw new Error('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่ม');
    const n = daysBetween(s, e) + 1;
    if (n > MAX_DAYS) throw new Error(`ช่วงวันที่ยาวเกินไป (${n} วัน) — สูงสุด ${MAX_DAYS} วัน`);
    const dates = []; for (let d = s; d <= e; d = addDays(d, 1)) dates.push(d);
    return { period, start: s, end: e, dates };
  }

  // Identify date / line / shift of a document from its fields, falling back to its id.
  function unitOf(doc, prefix) {
    let date = doc.date, line = doc.lineId, shift = doc.shift;
    const m = String(doc.id || '').match(new RegExp('^' + prefix + '_(\\d{4}-\\d{2}-\\d{2})_(.+)_(DAY|NIGHT)$'));
    if (m) { date = date || m[1]; line = line || m[2]; shift = shift || m[3]; }
    return { date, line: up(line), shift: up(shift) };
  }
  const ukey = (d, l, s) => `${d}|${l}|${s}`;

  function minutesOf(t) { const m = String(t || '').match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  function intervalsOverlap(a, b) { // HH:MM intervals; an end before its start crosses midnight
    const iv = x => { let s = minutesOf(x.start), e = minutesOf(x.end); if (s == null || e == null) return null; if (e <= s) e += 1440; return [s, e]; };
    const p = iv(a), q = iv(b); if (!p || !q) return false;
    for (const sh of [0, 1440, -1440]) if (p[0] < q[1] + sh && q[0] + sh < p[1]) return true;
    return false;
  }
  // Minutes shared by two HH:MM intervals (0 when they do not overlap); midnight-aware.
  function overlapMinutes(a, b) {
    const iv = x => { let s = minutesOf(x.start), e = minutesOf(x.end); if (s == null || e == null) return null; if (e <= s) e += 1440; return [s, e]; };
    const p = iv(a), q = iv(b); if (!p || !q) return 0;
    let best = 0; for (const sh of [0, 1440, -1440]) best = Math.max(best, Math.min(p[1], q[1] + sh) - Math.max(p[0], q[0] + sh));
    return Math.max(0, best);
  }

  // Core aggregation. data = {lines, plans, actuals, losses} (plain objects with id), period from resolvePeriod.
  function aggregate(data, period, filter) {
    const lineFilter = up(filter && filter.line), shiftFilter = up(filter && filter.shift);
    const shifts = shiftFilter && shiftFilter !== 'BOTH' ? [shiftFilter] : SHIFTS.slice();
    const inRange = d => isDate(d) && d >= period.start && d <= period.end;
    const master = new Map();
    (data.lines || []).forEach(l => { const id = up(l.lineId || l.code || l.id); if (id) master.set(id, { id, name: String(l.lineName || l.name || ('Line ' + id)), order: num(l.order) || 999, active: l.active !== false }); });

    const plans = new Map(), actuals = new Map(), manual = new Map(), seenLines = new Set();
    const keep = u => inRange(u.date) && shifts.includes(u.shift) && (!lineFilter || lineFilter === 'ALL' || u.line === lineFilter);
    (data.plans || []).forEach(p => { const u = unitOf(p, 'plan'); if (keep(u)) { plans.set(ukey(u.date, u.line, u.shift), p); seenLines.add(u.line); } });
    (data.actuals || []).forEach(a => { const u = unitOf(a, 'actual'); if (keep(u)) { actuals.set(ukey(u.date, u.line, u.shift), a); seenLines.add(u.line); } });
    (data.losses || []).forEach(x => { const u = { date: x.date, line: up(x.lineId), shift: up(x.shift) }; if (keep(u)) { const k = ukey(u.date, u.line, u.shift); if (!manual.has(k)) manual.set(k, []); manual.get(k).push(x); seenLines.add(u.line); } });

    // Lines: active master lines (respecting the filter) + any line that has data in the period
    // (inactive or no longer in Master), so history is never understated.
    const lineIds = new Set();
    master.forEach((l, id) => { if (l.active && (!lineFilter || lineFilter === 'ALL' || id === lineFilter)) lineIds.add(id); });
    seenLines.forEach(id => lineIds.add(id));
    if (lineFilter && lineFilter !== 'ALL') lineIds.add(lineFilter);
    const lines = [...lineIds].map(id => master.get(id) || { id, name: 'Line ' + id + ' (not in Master)', order: 9999, active: false })
      .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));

    const units = [], blocks = [], cells = new Map(), lossRows = [], rawCells = [], quality = { noPlan: 0, noEntry: 0, actualWithoutPlan: 0, staleKeys: 0, staleQty: 0, planMismatch: 0, overlaps: 0, overlapMinutes: 0, zeroPlan: 0 };
    for (const date of period.dates) for (const line of lines) for (const shift of shifts) {
      const k = ukey(date, line.id, shift), p = plans.get(k) || null, a = actuals.get(k) || null, man = manual.get(k) || [];
      if (!p && !a && !man.length && !line.active) continue;          // inactive line, nothing recorded that day
      const u = { date, lineId: line.id, lineName: line.name, shift, hasPlan: !!p, hasActual: !!a, planId: p ? p.id : '', actualId: a ? a.id : '', planVersion: p ? (p.version ?? '') : '' };
      const valid = new Map(); let cellsPlanSum = 0, cellsOrigSum = 0;
      const pblocks = p && Array.isArray(p.blocks) ? p.blocks : [];
      pblocks.forEach((b, bi) => (Array.isArray(b.cells) ? b.cells : []).forEach(c => {
        const key = `${bi}|||${c.model}|||${c.door}`; valid.set(key, c); cellsPlanSum += num(c.plan); cellsOrigSum += num(c.originalPlan);
      }));
      u.adjustedPlan = p ? num(p.adjustedPlan ?? p.totalPlan ?? 0) : null;
      u.originalPlan = p ? num(p.originalPlan ?? p.totalPlan ?? 0) : null;
      u.cellsPlan = p ? cellsPlanSum : null;
      if (p && Math.round(cellsPlanSum) !== Math.round(u.adjustedPlan)) quality.planMismatch++;
      let act = 0, stale = 0, staleKeys = [];
      const byCell = a && a.actualByCell && typeof a.actualByCell === 'object' ? a.actualByCell : {};
      Object.entries(byCell).forEach(([key, v]) => {
        const q = num(v), parts = key.split('|||'), planned = valid.has(key);
        rawCells.push({ date, lineId: line.id, shift, blockIndex: parts.length >= 3 ? Number(parts[0]) : '', model: parts[1] || '', door: parts[2] || '', qty: q, planned: planned ? 'YES' : 'NO', key });
        if (planned) act += q; else { stale += q; if (q) staleKeys.push(key); }
      });
      u.actual = a ? act : null; u.unplannedActual = stale; u.staleKeys = staleKeys;
      if (!p) quality.noPlan++; if (p && !a) quality.noEntry++; if (!p && a) quality.actualWithoutPlan++;
      if (staleKeys.length) { quality.staleKeys += staleKeys.length; quality.staleQty += stale; }
      if (p && !u.adjustedPlan) quality.zeroPlan++;
      u.status = !p ? (a ? 'ACTUAL WITHOUT PLAN' : 'NO PLAN') : (!a ? 'NO ENTRY' : 'OK');
      // blocks (Time Block production)
      let cumP = 0, cumA = 0;
      pblocks.forEach((b, bi) => {
        let bp = 0, ba = 0;
        (Array.isArray(b.cells) ? b.cells : []).forEach(c => {
          const key = `${bi}|||${c.model}|||${c.door}`, cp = num(c.plan), ca = num(byCell[key]);
          bp += cp; ba += ca;
          const ck = `${line.id}|||${c.model}|||${c.door}`; if (!cells.has(ck)) cells.set(ck, { lineId: line.id, lineName: line.name, model: String(c.model ?? ''), door: String(c.door ?? ''), plan: 0, actual: 0 });
          const cc = cells.get(ck); cc.plan += cp; cc.actual += ca;
        });
        cumP += bp; cumA += ba;
        blocks.push({ date, lineId: line.id, lineName: line.name, shift, blockNo: bi + 1, start: String(b.start || ''), end: String(b.end || ''), type: String(b.type || 'WORK').toUpperCase(), plan: bp, actual: a ? ba : null, cumPlan: cumP, cumActual: a ? cumA : null });
      });
      // losses
      const pc = (p && p.masterSnapshot && Array.isArray(p.masterSnapshot.palletChangeLosses)) ? p.masterSnapshot.palletChangeLosses : [];
      const pcRows = pc.map(x => ({ date, lineId: line.id, lineName: line.name, shift, source: 'Pallet Change (Daily Plan)', category: String(x.category || 'Pallet Change'), detail: x.palletId ? 'Pallet ' + x.palletId : '', start: String(x.start || ''), end: String(x.end || ''), minutes: num(x.minutes), remark: '', overlap: '' }));
      const manRows = man.map(x => ({ date, lineId: line.id, lineName: line.name, shift, source: 'Manual (Loss page)', category: String(x.category || 'Other'), detail: x.detailCause === 'Other' ? ('Other' + (x.customCause ? ': ' + x.customCause : '')) : String(x.detailCause ? (x.detailCauseTh ? `${x.detailCauseTh} (${x.detailCause})` : x.detailCause) : 'Unspecified'), start: String(x.start || ''), end: String(x.end || ''), minutes: num(x.minutes), remark: String(x.remark || ''), overlap: '' }));
      // Event records are kept as entered; an overlap is only flagged and measured (never removed).
      manRows.forEach(m => { const om = Math.min(m.minutes, pcRows.reduce((t, q) => t + overlapMinutes(m, q), 0));
        if (pcRows.some(q => intervalsOverlap(m, q))) { m.overlap = `OVERLAPS PALLET CHANGE (${om} min)`; m.overlapMinutes = om; quality.overlaps++; quality.overlapMinutes += om; } });
      const ls = [...pcRows, ...manRows];
      u.lossExclMaterial = ls.filter(x => x.category !== 'Material').reduce((s, x) => s + x.minutes, 0);
      u.material = ls.filter(x => x.category === 'Material').reduce((s, x) => s + x.minutes, 0);
      u.palletChangeLoss = pcRows.reduce((s, x) => s + x.minutes, 0);
      u.manualLoss = manRows.reduce((s, x) => s + x.minutes, 0);
      lossRows.push(...ls);
      units.push(u);
    }

    const sum = (arr, f) => arr.reduce((s, x) => s + (x[f] == null ? 0 : x[f]), 0);
    const ratio = (a, p) => p > 0 ? a / p : null;
    const totals = { plan: sum(units, 'adjustedPlan'), originalPlan: sum(units, 'originalPlan'), actual: sum(units, 'actual'), unplannedActual: sum(units, 'unplannedActual'), lossExclMaterial: sum(units, 'lossExclMaterial'), material: sum(units, 'material') };
    totals.gap = totals.actual - totals.plan; totals.achievement = ratio(totals.actual, totals.plan); totals.lossInclMaterial = totals.lossExclMaterial + totals.material;
    const group = (keyFn, labelFn) => { const m = new Map(); units.forEach(u => { const k = keyFn(u); if (!m.has(k)) m.set(k, { ...labelFn(u), plan: 0, actual: 0, units: 0, planned: 0, entered: 0, lossExclMaterial: 0, material: 0 }); const g = m.get(k); g.plan += u.adjustedPlan || 0; g.actual += u.actual || 0; g.units++; if (u.hasPlan) g.planned++; if (u.hasActual) g.entered++; g.lossExclMaterial += u.lossExclMaterial; g.material += u.material; });
      return [...m.values()].map(g => ({ ...g, gap: g.actual - g.plan, achievement: ratio(g.actual, g.plan) })); };
    const byLine = group(u => u.lineId, u => ({ lineId: u.lineId, lineName: u.lineName }));
    const byDate = group(u => u.date, u => ({ date: u.date }));
    const byLineShift = group(u => u.lineId + '|' + u.shift, u => ({ lineId: u.lineId, lineName: u.lineName, shift: u.shift }));
    const modelDoor = [...cells.values()].map(c => ({ ...c, gap: c.actual - c.plan, achievement: ratio(c.actual, c.plan) })).sort((a, b) => a.lineId.localeCompare(b.lineId) || a.model.localeCompare(b.model) || a.door.localeCompare(b.door));
    const lossByCat = new Map(); lossRows.forEach(x => { if (!lossByCat.has(x.category)) lossByCat.set(x.category, { category: x.category, minutes: 0, events: 0, material: x.category === 'Material' }); const g = lossByCat.get(x.category); g.minutes += x.minutes; g.events++; });
    const lossByDetail = new Map(); lossRows.forEach(x => { const k = x.category + '|' + x.detail; if (!lossByDetail.has(k)) lossByDetail.set(k, { category: x.category, detail: x.detail || '—', minutes: 0, events: 0 }); const g = lossByDetail.get(k); g.minutes += x.minutes; g.events++; });
    return { period, filter: { line: lineFilter && lineFilter !== 'ALL' ? lineFilter : 'ALL', shift: shifts.length === 2 ? 'BOTH' : shifts[0] }, lines, units, blocks, modelDoor, lossRows,
      lossByCategory: [...lossByCat.values()].sort((a, b) => b.minutes - a.minutes), lossByDetail: [...lossByDetail.values()].sort((a, b) => b.minutes - a.minutes),
      rawCells, totals, byLine, byDate, byLineShift, quality, completeness: completenessOf(quality) };
  }
  // Data completeness: incomplete units mean the totals are NOT fully verified production totals.
  function completenessOf(q) {
    const issues = [];
    if (q.noPlan) issues.push(`NO PLAN: ${q.noPlan} Line×Shift×Date unit(s) without a saved Daily Plan (can include non-production days or dates not reached yet)`);
    if (q.noEntry) issues.push(`NO ENTRY: ${q.noEntry} unit(s) with a plan but no Production Entry — their Plan is in the totals, their Actual is missing`);
    if (q.actualWithoutPlan) issues.push(`ACTUAL WITHOUT PLAN: ${q.actualWithoutPlan} unit(s) with Production Entry but no Daily Plan — that Actual is NOT counted`);
    const notes = [];
    if (q.staleKeys) notes.push(`${q.staleKeys} unplanned / stale actual key(s), ${q.staleQty} pcs, not counted in Actual`);
    if (q.overlaps) notes.push(`${q.overlaps} manual loss event(s) overlap Pallet Change Loss: up to ${q.overlapMinutes} min may be counted twice in the loss event-minute sums`);
    return { complete: issues.length === 0, issues, notes };
  }

  // ---------- workbook ----------
  const C = { navy: 'FF0B1F3A', blue: 'FF1D4ED8', sky: 'FFDBEAFE', pale: 'FFF1F5F9', white: 'FFFFFFFF', grey: 'FF64748B', line: 'FFCBD5E1', good: 'FFDCFCE7', goodT: 'FF166534', warn: 'FFFEF3C7', warnT: 'FF92400E', bad: 'FFFEE2E2', badT: 'FF991B1B' };
  const fill = c => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
  const thin = { style: 'thin', color: { argb: C.line } };
  const border = { top: thin, left: thin, bottom: thin, right: thin };
  // Text from users is always written as a string cell, never as a formula. Control characters
  // are removed, and text starting with = + - @ gets a visible leading "'" so it cannot turn
  // into a formula if the sheet is later copied or saved as CSV.
  function safeText(v) {
    let s = String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[\r\n\t]+/g, ' ');
    if (/^[=+\-@]/.test(s)) s = "'" + s;
    return s.slice(0, 1000);
  }
  function safeFileName(s) { return String(s).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 120); }
  function fileNameFor(model) {
    const p = model.period, per = p.period[0].toUpperCase() + p.period.slice(1);
    const when = p.period === 'daily' ? p.start : p.period === 'monthly' ? p.start.slice(0, 7) : `${p.start}_to_${p.end}`;
    return safeFileName(`PV2_${per}_Report_${when}_${model.filter.line === 'ALL' ? 'AllLines' : 'Line-' + model.filter.line}_${model.filter.shift === 'BOTH' ? 'DAY-NIGHT' : model.filter.shift}`) + '.xlsx';
  }
  const periodLabel = p => p.period === 'daily' ? `Daily · ${p.start}` : p.period === 'monthly' ? `Monthly · ${p.start.slice(0, 7)} (${p.start} – ${p.end})` : `Weekly / Range · ${p.start} – ${p.end}`;

  function setupSheet(ws, title, model, cols, opts = {}) {
    ws.properties.defaultRowHeight = 18;
    ws.pageSetup = { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 }, horizontalCentered: true };
    ws.headerFooter = { oddFooter: `&L${safeText('Production V2 · ' + title)}&RPage &P / &N` };
    ws.columns = cols.map(w => ({ width: w }));
    const last = cols.length;
    ws.mergeCells(1, 1, 1, last); ws.mergeCells(2, 1, 2, last);
    const t = ws.getCell(1, 1); t.value = title; t.font = { name: 'Calibri', size: 16, bold: true, color: { argb: C.white } }; t.fill = fill(C.navy); t.alignment = { vertical: 'middle', indent: 1 }; ws.getRow(1).height = 30;
    const s = ws.getCell(2, 1); s.value = `${periodLabel(model.period)}   |   Line: ${model.filter.line === 'ALL' ? 'All Lines' : model.filter.line}   |   Shift: ${model.filter.shift === 'BOTH' ? 'DAY + NIGHT' : model.filter.shift}   |   Generated: ${model.meta.generatedAt}`;
    s.font = { size: 10, color: { argb: C.white } }; s.fill = fill(C.blue); s.alignment = { vertical: 'middle', indent: 1 }; ws.getRow(2).height = 20;
    return last;
  }
  function header(ws, row, labels) {
    const r = ws.getRow(row); labels.forEach((l, i) => { const c = r.getCell(i + 1); c.value = l; c.font = { bold: true, color: { argb: C.white }, size: 10 }; c.fill = fill(C.navy); c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; c.border = border; }); r.height = 30;
  }
  function bodyCell(c, fmt) { c.border = border; c.font = { size: 10 }; if (fmt) c.numFmt = fmt; }
  const NUM = '#,##0;[Red]-#,##0', PCT = '0.0%', MIN = '#,##0" min"';
  // Colour rules apply to numbers only: a blank cell (no plan / no entry) is never coloured.
  function achFormatting(ws, ref) {
    const c = ref.split(':')[0];
    ws.addConditionalFormatting({ ref, rules: [
      { type: 'expression', formulae: [`AND(ISNUMBER(${c}),${c}>=1)`], style: { fill: fill(C.good), font: { color: { argb: C.goodT }, bold: true } }, priority: 1 },
      { type: 'expression', formulae: [`AND(ISNUMBER(${c}),${c}>=0.95,${c}<1)`], style: { fill: fill(C.warn), font: { color: { argb: C.warnT }, bold: true } }, priority: 2 },
      { type: 'expression', formulae: [`AND(ISNUMBER(${c}),${c}<0.95)`], style: { fill: fill(C.bad), font: { color: { argb: C.badT }, bold: true } }, priority: 3 }] });
  }
  function gapFormatting(ws, ref) {
    const c = ref.split(':')[0];
    ws.addConditionalFormatting({ ref, rules: [
      { type: 'expression', formulae: [`AND(ISNUMBER(${c}),${c}<0)`], style: { font: { color: { argb: C.badT }, bold: true } }, priority: 4 },
      { type: 'expression', formulae: [`AND(ISNUMBER(${c}),${c}>0)`], style: { font: { color: { argb: C.goodT }, bold: true } }, priority: 5 }] });
  }
  const colL = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  // A data table with header, rows, optional total row (formulas), freeze + AutoFilter.
  function table(ws, top, labels, rows, spec) {
    header(ws, top, labels);
    rows.forEach((vals, i) => { const r = ws.getRow(top + 1 + i); vals.forEach((v, j) => { const c = r.getCell(j + 1); c.value = (typeof v === 'string') ? safeText(v) : v; bodyCell(c, spec.fmt[j]); if (i % 2) c.fill = fill(C.pale); }); });
    const first = top + 1, last = top + rows.length;
    if (spec.total && rows.length) {
      const tr = ws.getRow(last + 1);
      labels.forEach((_, j) => { const c = tr.getCell(j + 1), col = colL(j + 1), t = spec.total[j];
        if (t === 'label') c.value = 'TOTAL';
        else if (t === 'sum') c.value = { formula: `SUBTOTAL(9,${col}${first}:${col}${last})`, result: rows.reduce((s, r) => s + (typeof r[j] === 'number' ? r[j] : 0), 0) };
        else if (t && t.ach) { const a = colL(t.ach[0]), p = colL(t.ach[1]); const av = rows.reduce((s, r) => s + (typeof r[t.ach[0] - 1] === 'number' ? r[t.ach[0] - 1] : 0), 0), pv = rows.reduce((s, r) => s + (typeof r[t.ach[1] - 1] === 'number' ? r[t.ach[1] - 1] : 0), 0); c.value = { formula: `IF(${p}${last + 1}>0,${a}${last + 1}/${p}${last + 1},"")`, result: pv > 0 ? av / pv : '' }; }
        else if (t && t.gap) { const a = colL(t.gap[0]), p = colL(t.gap[1]); c.value = { formula: `${a}${last + 1}-${p}${last + 1}`, result: rows.reduce((s, r) => s + (typeof r[t.gap[0] - 1] === 'number' ? r[t.gap[0] - 1] : 0), 0) - rows.reduce((s, r) => s + (typeof r[t.gap[1] - 1] === 'number' ? r[t.gap[1] - 1] : 0), 0) }; }
        bodyCell(c, spec.fmt[j]); c.font = { bold: true, size: 10, color: { argb: C.navy } }; c.fill = fill(C.sky); });
    }
    if (spec.filter !== false && rows.length) ws.autoFilter = { from: { row: top, column: 1 }, to: { row: last, column: labels.length } };
    if (spec.freeze) ws.views = [{ state: 'frozen', xSplit: spec.freezeCols || 0, ySplit: top, topLeftCell: `${colL((spec.freezeCols || 0) + 1)}${top + 1}`, activeCell: 'A1' }];
    if (spec.ach) spec.ach.forEach(j => achFormatting(ws, `${colL(j)}${first}:${colL(j)}${last + (spec.total ? 1 : 0)}`));
    if (spec.gap) spec.gap.forEach(j => gapFormatting(ws, `${colL(j)}${first}:${colL(j)}${last + (spec.total ? 1 : 0)}`));
    ws.pageSetup.printTitlesRow = `${top}:${top}`;
    return last + (spec.total ? 1 : 0);
  }
  const blank = v => v == null ? null : v;

  // Row with the data-completeness verdict (red when incomplete, green when complete).
  function completenessBanner(ws, row, lastCol, model) {
    const c = model.completeness, lines = c.complete
      ? ['✓ DATA COMPLETE — every Line × Shift × Date in this report has a saved Daily Plan and a Production Entry.']
      : ['⚠ DATA INCOMPLETE — these totals are NOT fully verified production totals.', ...c.issues];
    if (c.notes.length) lines.push('Note: ' + c.notes.join(' · '));
    ws.mergeCells(row, 1, row, lastCol);
    const cell = ws.getCell(row, 1); cell.value = lines.map(safeText).join('\n');
    cell.alignment = { wrapText: true, vertical: 'middle', indent: 1 };
    cell.font = { bold: true, size: 10, color: { argb: c.complete ? C.goodT : C.badT } };
    cell.fill = fill(c.complete ? C.good : C.bad); cell.border = border;
    ws.getRow(row).height = Math.max(22, 15 * lines.length + 6);
  }

  // ---------- 01 Executive Summary: executive dashboard ----------
  // Grid A–L: A = 16, E–F = 12, others 10 (about 132 characters). Page 1: header, status strip, 4 KPI cards,
  // two chart images, Line Performance (all lines) and compact Loss. Following page: full
  // Production Trend table, Data Quality and calculation notes. Many lines → extra pages, never hidden.
  const EXEC_COLS = [16, 10, 10, 10, 12, 12, 10, 10, 10, 10, 10, 10];   // E/F hold "Achievement"
  const colPx = w => Math.floor(w * 7 + 5);                      // Excel column width → pixels (Calibri 11)
  const ROW_PT = 17, ROW_PX = ROW_PT * 96 / 72;                  // chart band row height
  const LINES_ON_PAGE_1 = 8;                                     // more lines → Line table moves to its own page
  const dateText = p => p.period === 'daily' ? `Production Date ${p.start}` : p.period === 'monthly' ? `${p.start.slice(0, 7)} · Production Dates ${p.start} – ${p.end}` : `Production Dates ${p.start} – ${p.end} (${p.dates.length} days)`;
  const periodWord = p => p.period === 'daily' ? 'Daily' : p.period === 'monthly' ? 'Monthly' : 'Weekly / Range';
  // Rows of the Line Performance table: every line, most negative Gap first, lines without a Gap last.
  function lineRows(model) {
    return model.byLine.map(g => ({ name: g.lineName, plan: g.planned ? g.plan : null, actual: g.entered ? g.actual : null, gap: g.planned && g.entered ? g.gap : null, ach: g.planned && g.entered ? blank(g.achievement) : null }))
      .sort((a, b) => (a.gap == null) - (b.gap == null) || (a.gap ?? 0) - (b.gap ?? 0) || a.name.localeCompare(b.name));
  }
  // What to draw (data, kind, size). Missing plan / entry stays null → a gap in the chart, never 0.
  // Chart height is capped so a chart always fits on the first A4 landscape page (never split / clipped).
  const NAVY = '#0B1F3A', BLUE = '#3B82F6', SLATE = '#64748B', SKY = '#93C5FD', CHART_MIN = 230, CHART_MAX = 500;
  function chartSpec(model) {
    const daily = model.period.period === 'daily';
    const pa = (rows, tag, c1, c2) => [{ label: 'Adjusted Plan' + tag, data: rows.map(g => g ? (g.planned ? g.plan : null) : null), color: c1 }, { label: 'Actual' + tag, data: rows.map(g => g ? (g.entered ? g.actual : null) : null), color: c2 }];
    const left = { title: 'Plan vs Actual by Line (pcs)', kind: 'bar', labels: model.byLine.map(g => g.lineName), series: pa(model.byLine, '', NAVY, BLUE) };
    let right;
    if (daily) {   // one category per Line; DAY / NIGHT as separate series
      const shifts = model.filter.shift === 'BOTH' ? ['DAY', 'NIGHT'] : [model.filter.shift];
      const by = new Map(model.byLineShift.map(g => [g.lineId + '|' + g.shift, g]));
      right = { title: 'Plan vs Actual by Line and Shift (pcs)', kind: 'bar', labels: model.byLine.map(g => g.lineName),
        series: shifts.flatMap((sh, i) => pa(model.byLine.map(g => by.get(g.lineId + '|' + sh) || null), ' · ' + sh, i ? SLATE : NAVY, i ? SKY : BLUE)) };
    } else right = { title: 'Production Trend by Production Date (pcs) — gaps = no saved plan / no entry', kind: model.byDate.length > 10 ? 'line' : 'bar', labels: model.byDate.map(g => g.date.slice(5)), series: pa(model.byDate, '', NAVY, BLUE) };
    left.horizontal = left.labels.length > LINES_ON_PAGE_1; right.horizontal = daily && right.labels.length > LINES_ON_PAGE_1;
    const need = c => c.horizontal ? 90 + c.labels.length * (c.series.length > 2 ? 30 : 24) : CHART_MIN;
    const height = Math.min(CHART_MAX, Math.max(need(left), need(right)));
    const leftW = EXEC_COLS.slice(0, 6).reduce((t, w) => t + colPx(w), 0) - 12, rightW = EXEC_COLS.slice(6).reduce((t, w) => t + colPx(w), 0) - 10;
    return { left: { ...left, width: leftW, height }, right: { ...right, width: rightW, height }, bandRows: Math.ceil(height / ROW_PX) };
  }
  function statusStrip(model) {
    const c = model.completeness, q = model.quality;
    return c.complete ? '✓ DATA COMPLETE — required plan and entry records found (not an independent audit of physical production) · details on page 2'
      : `⚠ DATA INCOMPLETE — totals NOT fully verified · NO PLAN ${q.noPlan} · NO ENTRY ${q.noEntry} · ACTUAL WITHOUT PLAN ${q.actualWithoutPlan} · details on page 2`;
  }
  function buildExecutiveSummary(wb, ws, model, images) {
    const T = model.totals, Q = model.quality, P = model.period, cmp = model.completeness, spec = chartSpec(model);
    setupSheet(ws, 'Production Report — Executive Summary', model, EXEC_COLS);
    ws.getCell(1, 1).font = { name: 'Calibri', size: 14, bold: true, color: { argb: C.white } }; ws.getRow(1).height = 22;
    const meta = ws.getCell(2, 1);
    meta.value = safeText(`${periodWord(P)} · ${dateText(P)}   |   Line: ${model.filter.line === 'ALL' ? 'All Lines' : model.filter.line}   |   Shift: ${model.filter.shift === 'BOTH' ? 'DAY + NIGHT' : model.filter.shift}   |   Generated: ${model.meta.generatedAt}   |   Data as of: ${model.meta.dataAsOf}`);
    meta.font = { size: 9, color: { argb: C.white } }; ws.getRow(2).height = 16;
    ws.mergeCells(3, 1, 3, 12);
    const st = ws.getCell(3, 1); st.value = safeText(statusStrip(model)); st.font = { bold: true, size: 10, color: { argb: cmp.complete ? C.goodT : C.badT } };
    st.fill = fill(cmp.complete ? C.good : C.bad); st.alignment = { vertical: 'middle', indent: 1 }; st.border = border; ws.getRow(3).height = 18;
    ws.getRow(4).height = 4;
    // KPI cards (rows 5–6), 3 columns each
    const kpis = [['ADJUSTED PLAN', T.plan, NUM], ['ACTUAL', T.actual, NUM], ['ACHIEVEMENT', T.achievement, PCT], ['GAP', T.gap, NUM]];
    kpis.forEach(([label, value, fmt], i) => {
      const c0 = 1 + i * 3; ws.mergeCells(5, c0, 5, c0 + 2); ws.mergeCells(6, c0, 6, c0 + 2);
      const l = ws.getCell(5, c0); l.value = label; l.font = { size: 9, bold: true, color: { argb: C.grey } }; l.alignment = { horizontal: 'center', vertical: 'middle' }; l.fill = fill(C.sky);
      const v = ws.getCell(6, c0); v.value = value == null ? 'n/a (no plan)' : value; v.numFmt = fmt; v.alignment = { horizontal: 'center', vertical: 'middle' };
      v.font = { size: 20, bold: true, color: { argb: label === 'GAP' && value < 0 ? C.badT : C.navy } };
      v.fill = fill(label === 'ACHIEVEMENT' && value != null ? (value >= 1 ? C.good : value >= 0.95 ? C.warn : C.bad) : C.white);
      for (let c = c0; c <= c0 + 2; c++) { ws.getCell(5, c).border = border; ws.getCell(6, c).border = border; }
    });
    ws.getRow(5).height = 14; ws.getRow(6).height = 30;
    const units = model.units.length, planned = model.units.filter(u => u.hasPlan).length, entered = model.units.filter(u => u.hasActual).length;
    ws.mergeCells(7, 1, 7, 12);
    const fn = ws.getCell(7, 1);
    fn.value = safeText(`Original Plan ${T.originalPlan.toLocaleString('en-US')} pcs · Line×Shift×Date units with a plan ${planned}/${units} · with a production entry ${entered}/${units} · Unplanned / stale actual ${T.unplannedActual.toLocaleString('en-US')} pcs (not counted)${cmp.complete ? '' : ' · totals cover saved records only'}`);
    fn.font = { size: 9, italic: true, color: { argb: C.grey } }; fn.alignment = { indent: 1, vertical: 'middle' }; ws.getRow(7).height = 14;
    ws.getRow(8).height = 4;
    // chart band
    const band0 = 9, bandEnd = band0 + spec.bandRows - 1;
    for (let r = band0; r <= bandEnd; r++) ws.getRow(r).height = ROW_PT;
    const place = (b64, col, sz) => { if (!b64) return false; const id = wb.addImage({ base64: b64, extension: 'png' }); ws.addImage(id, { tl: { col, row: band0 - 1 }, ext: { width: sz.width, height: sz.height }, editAs: 'oneCell' }); return true; };
    if (!place(images && images.left, 0, spec.left)) { ws.getCell(band0, 1).value = 'Chart not available (chart library not loaded)'; ws.getCell(band0, 1).font = { size: 9, italic: true, color: { argb: C.grey } }; }
    if (!place(images && images.right, 6, spec.right)) { ws.getCell(band0, 7).value = 'Chart not available (chart library not loaded)'; ws.getCell(band0, 7).font = { size: 9, italic: true, color: { argb: C.grey } }; }
    ws.mergeCells(bandEnd + 1, 1, bandEnd + 1, 12);
    const cap = ws.getCell(bandEnd + 1, 1); cap.value = 'Charts are images drawn from this report\'s data (not editable Excel charts). A missing bar or a break in a line = no saved plan / no production entry, not zero.';
    cap.font = { size: 8, italic: true, color: { argb: C.grey } }; cap.alignment = { indent: 1 }; ws.getRow(bandEnd + 1).height = 12;
    const rows = lineRows(model), many = rows.length > LINES_ON_PAGE_1;
    if (many) ws.getRow(bandEnd + 1).addPageBreak();   // many lines: Loss + Line table on their own page
    ws.getRow(bandEnd + 2).height = 8;
    let r = bandEnd + 3;
    // Loss (H–L)
    const lossTop = r, title = (row, col, text) => { const c = ws.getCell(row, col); c.value = text; c.font = { bold: true, size: 11, color: { argb: C.navy } }; };
    title(lossTop, 8, 'Loss — event-minute sums');
    const lossLine = (row, label, value, bold) => { ws.mergeCells(row, 8, row, 11); const l = ws.getCell(row, 8); l.value = safeText(label); l.font = { size: 10, bold: !!bold }; l.alignment = { indent: 1, vertical: 'middle' };
      const v = ws.getCell(row, 12); v.value = value; v.numFmt = MIN; v.font = { size: 10, bold: !!bold }; v.alignment = { horizontal: 'right', vertical: 'middle' };
      for (let c = 8; c <= 12; c++) { ws.getCell(row, c).border = border; if (bold) ws.getCell(row, c).fill = fill(C.sky); } ws.getRow(row).height = Math.max(ws.getRow(row).height || 0, 16); };
    let lr = lossTop + 1;
    lossLine(lr++, 'Loss excl. Material · event-min sum', T.lossExclMaterial, true);
    lossLine(lr++, 'Material · event-min sum', T.material);
    lossLine(lr++, 'Total incl. Material · event-min sum', T.lossInclMaterial);
    const tot = T.lossInclMaterial || 0;
    model.lossByCategory.slice(0, 3).forEach(g => lossLine(lr++, `${g.category}${g.material ? ' (Material)' : ''} · ${g.events} event(s) · ${tot ? Math.round(g.minutes / tot * 100) : 0}%`, g.minutes));
    ws.mergeCells(lr, 8, lr, 12);
    const ov = ws.getCell(lr, 8);
    ov.value = Q.overlaps ? `⚠ ${Q.overlaps} manual loss event(s) overlap Pallet Change — up to ${Q.overlapMinutes} min may be counted twice in these sums` : 'No manual loss event overlaps a Pallet Change in this report.';
    ov.font = { size: 9, bold: !!Q.overlaps, color: { argb: Q.overlaps ? C.badT : C.grey } }; ov.alignment = { wrapText: true, vertical: 'middle', indent: 1 }; ov.border = border; ws.getRow(lr).height = 28;
    const lossEnd = lr;
    // Line Performance (A–E): all lines; on page 1 unless there are many lines
    const lineTop = lossTop;
    title(lineTop, 1, `Line Performance — ${rows.length} line(s), most negative Gap first`);
    const lineEnd = table(ws, lineTop + 1, ['Line', 'Adjusted Plan', 'Actual', 'Gap', 'Achievement'], rows.map(x => [x.name, x.plan, x.actual, x.gap, x.ach]),
      { fmt: [null, NUM, NUM, NUM, PCT], total: ['label', 'sum', 'sum', { gap: [3, 2] }, { ach: [3, 2] }], ach: [5], gap: [4], filter: false });
    ws.getRow(lineTop).height = 16; ws.getRow(lineTop + 1).height = 24;
    for (let x = lineTop + 2; x <= lineEnd; x++) ws.getRow(x).height = Math.max(15, x === lossEnd ? 28 : 0);
    r = Math.max(lineEnd, lossEnd);
    // following page: trend + data quality
    ws.getRow(r).addPageBreak();
    r += 2;
    title(r, 1, 'Production Trend — daily totals by Production Date (blank = no saved plan / no entry)');
    const trendTop = r + 1;
    r = table(ws, r + 1, ['Production Date', 'Units planned', 'Adjusted Plan', 'Actual', 'Gap', 'Achievement', 'Loss excl. Material', 'Material'],
      model.byDate.map(g => [g.date, `${g.planned}/${g.units}`, g.planned ? g.plan : null, g.entered ? g.actual : null, g.planned && g.entered ? g.gap : null, g.planned && g.entered ? blank(g.achievement) : null, g.lossExclMaterial, g.material]),
      { fmt: [null, null, NUM, NUM, NUM, PCT, MIN, MIN], total: ['label', null, 'sum', 'sum', { gap: [4, 3] }, { ach: [4, 3] }, 'sum', 'sum'], ach: [6], gap: [5], filter: false });
    ws.getRow(trendTop).height = 24; for (let x = trendTop + 1; x <= r; x++) ws.getRow(x).height = 14.5;
    if (model.byDate.length > 14) ws.getRow(r).addPageBreak();   // long trend (Monthly): Data Quality on the next page
    r += 2;
    title(r, 1, 'Data Quality'); r++;
    const dq = cmp.complete ? ['✓ DATA COMPLETE — every Line × Shift × Date in this report has a saved Daily Plan and a Production Entry.'] : ['⚠ DATA INCOMPLETE — these totals are NOT fully verified production totals.', ...cmp.issues];
    dq.push('DATA COMPLETE only means the required records were found. It is not an independent audit of the physical production quantities.');
    if (cmp.notes.length) dq.push('Note: ' + cmp.notes.join(' · '));
    dq.forEach((t, i) => { ws.mergeCells(r, 1, r, 12); const c = ws.getCell(r, 1); c.value = safeText(t); c.alignment = { wrapText: true, vertical: 'middle', indent: 1 };
      c.font = { size: 10, bold: i === 0, color: { argb: i === 0 ? (cmp.complete ? C.goodT : C.badT) : C.navy } }; if (i === 0) c.fill = fill(cmp.complete ? C.good : C.bad); ws.getRow(r).height = t.length > 140 ? 30 : 18; r++; });
    r++;
    title(r, 1, 'Calculation notes'); r++;
    const notes = [
      ['Adjusted Plan', 'Saved Daily Plan adjustedPlan (same value Production Entry shows). Original Plan is shown on sheet 02.'],
      ['Actual', 'Only Production Entry cells that exist in that day\'s plan (Entry rule). Other keys are listed as Unplanned / stale and are NOT included.'],
      ['Achievement', 'Total Actual ÷ Total Adjusted Plan for every row and total; daily percentages are never added. Blank when Plan = 0.'],
      ['Loss', `Sum of the minutes of every loss event (Pallet Change from the Daily Plan + Manual Loss), shown as "Loss excl. Material" and "Material". This is an event-minute sum: overlapping events are not merged, so overlapping time can be counted twice. Events are kept as entered; overlaps are flagged (${Q.overlaps} event(s), up to ${Q.overlapMinutes} min).`],
      ['Production Date', 'The date saved on each document. Night shift after midnight stays on its Production Date.'],
      ['Missing data', `NO PLAN: ${Q.noPlan} · NO ENTRY (plan saved, no actual): ${Q.noEntry} · Actual without plan: ${Q.actualWithoutPlan} · Zero-plan units: ${Q.zeroPlan}`],
      ['Data checks', `Stale actual keys: ${Q.staleKeys} (${Q.staleQty} pcs) · Plan total vs cells mismatch: ${Q.planMismatch} · Manual loss overlapping Pallet Change: ${Q.overlaps}`],
      ['Not included', 'Scrap and Quality metrics (no source in Production V2).'],
      ['Data as of', `${model.meta.dataAsOf} · Firestore documents read: ${model.meta.reads ?? 'n/a'}`]];
    notes.forEach(([a, b]) => { const c = ws.getCell(r, 1); c.value = a; c.font = { bold: true, size: 10 }; c.alignment = { vertical: 'top', indent: 1 };
      ws.mergeCells(r, 2, r, 12); const d = ws.getCell(r, 2); d.value = safeText(b); d.alignment = { wrapText: true, vertical: 'top' }; d.font = { size: 10 }; ws.getRow(r).height = b.length > 150 ? 30 : 18; r++; });
    ws.pageSetup.printArea = `A1:L${r}`; ws.pageSetup.printTitlesRow = undefined;
    return { spec, lineTop, lineEnd, lossTop, lossEnd, bandStart: band0, bandEnd, end: r };
  }

  function buildWorkbook(ExcelJS, model, images) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Production V2'; wb.created = new Date(model.meta.generatedAtIso || Date.now());
    wb.calcProperties.fullCalcOnLoad = true;
    const T = model.totals, Q = model.quality;

    // 01 Executive Summary (executive dashboard layout; see buildExecutiveSummary)
    let ws = wb.addWorksheet('01 Executive Summary', { properties: { tabColor: { argb: C.navy } }, views: [{ showGridLines: false }] });
    buildExecutiveSummary(wb, ws, model, images);

    // 02 Daily Production
    ws = wb.addWorksheet('02 Daily Production', { properties: { tabColor: { argb: C.blue } } });
    setupSheet(ws, 'Daily Production by Line and Shift', model, [14, 10, 22, 9, 22, 13, 13, 13, 12, 12, 13, 13, 12]);
    completenessBanner(ws, 3, 13, model);
    table(ws, 4, ['Production Date', 'Line', 'Line Name', 'Shift', 'Status', 'Original Plan', 'Adjusted Plan', 'Actual', 'Gap', 'Achievement', 'Unplanned / stale actual', 'Loss excl. Material', 'Material'],
      model.units.map(u => [u.date, u.lineId, u.lineName, u.shift, u.status, blank(u.originalPlan), blank(u.adjustedPlan), blank(u.actual), u.hasPlan && u.hasActual ? u.actual - u.adjustedPlan : null, u.hasPlan && u.hasActual && u.adjustedPlan > 0 ? u.actual / u.adjustedPlan : null, u.unplannedActual || null, u.lossExclMaterial, u.material]),
      { fmt: [null, null, null, null, null, NUM, NUM, NUM, NUM, PCT, NUM, MIN, MIN], total: ['label', null, null, null, null, 'sum', 'sum', 'sum', { gap: [8, 7] }, { ach: [8, 7] }, 'sum', 'sum', 'sum'], ach: [10], gap: [9], freeze: true, freezeCols: 4 });

    // 03 Model & Door
    ws = wb.addWorksheet('03 Model & Door', { properties: { tabColor: { argb: C.blue } } });
    setupSheet(ws, 'Production by Model and Door', model, [10, 22, 26, 14, 14, 14, 13, 13]);
    table(ws, 4, ['Line', 'Line Name', 'Model', 'Door', 'Adjusted Plan', 'Actual', 'Gap', 'Achievement'],
      model.modelDoor.map(m => [m.lineId, m.lineName, m.model, m.door, m.plan, m.actual, m.gap, blank(m.achievement)]),
      { fmt: [null, null, null, null, NUM, NUM, NUM, PCT], total: ['label', null, null, null, 'sum', 'sum', { gap: [6, 5] }, { ach: [6, 5] }], ach: [8], gap: [7], freeze: true, freezeCols: 4 });

    // 04 Time Block Production
    ws = wb.addWorksheet('04 Hourly (Time Block)', { properties: { tabColor: { argb: C.blue } } });
    setupSheet(ws, 'Production by Time Block (as defined by each saved Daily Plan)', model, [14, 10, 9, 8, 9, 9, 9, 13, 13, 12, 12, 14, 14]);
    table(ws, 4, ['Production Date', 'Line', 'Shift', 'Block', 'Start', 'End', 'Type', 'Adjusted Plan', 'Actual', 'Gap', 'Achievement', 'Cumulative Plan', 'Cumulative Actual'],
      model.blocks.map(b => [b.date, b.lineId, b.shift, b.blockNo, b.start, b.end, b.type, b.plan, blank(b.actual), b.actual == null ? null : b.actual - b.plan, b.actual != null && b.plan > 0 ? b.actual / b.plan : null, b.cumPlan, blank(b.cumActual)]),
      { fmt: [null, null, null, '0', null, null, null, NUM, NUM, NUM, PCT, NUM, NUM], total: ['label', null, null, null, null, null, null, 'sum', 'sum', { gap: [9, 8] }, { ach: [9, 8] }, null, null], ach: [11], gap: [10], freeze: true, freezeCols: 4 });

    // 05 Loss Analysis
    ws = wb.addWorksheet('05 Loss Analysis', { properties: { tabColor: { argb: C.blue } } });
    setupSheet(ws, 'Loss Analysis (minutes)', model, [22, 26, 12, 26, 22, 34, 9, 9, 11, 34, 26]);
    let lr = 4;
    ws.getCell(lr, 1).value = `Event-minute sums (overlapping events are not merged): Loss excl. Material ${T.lossExclMaterial} min · Material ${T.material} min · Total incl. Material ${T.lossInclMaterial} min · Manual events overlapping Pallet Change: ${Q.overlaps} (up to ${Q.overlapMinutes} min may be counted twice)`; ws.getCell(lr, 1).font = { bold: true, color: { argb: C.navy } }; lr += 2;
    const totalLoss = T.lossInclMaterial || 0;
    lr = table(ws, lr, ['By Category', 'Events', 'Event minutes', 'Share of total incl. Material', 'Counted in'],
      model.lossByCategory.map(g => [g.category, g.events, g.minutes, totalLoss ? g.minutes / totalLoss : null, g.material ? 'Material (separate)' : 'Loss excl. Material']),
      { fmt: [null, '0', MIN, PCT, null], total: ['label', 'sum', 'sum', null, null], filter: false }) + 2;
    lr = table(ws, lr, ['Category', 'Detail Cause', 'Events', 'Event minutes'], model.lossByDetail.map(g => [g.category, g.detail, g.events, g.minutes]), { fmt: [null, null, '0', MIN], total: ['label', null, 'sum', 'sum'], filter: false }) + 2;
    ws.getCell(lr, 1).value = 'Loss events'; ws.getCell(lr, 1).font = { bold: true, size: 12, color: { argb: C.navy } }; lr++;
    const evTop = lr;
    table(ws, lr, ['Production Date', 'Line', 'Shift', 'Source', 'Category', 'Detail Cause', 'Start', 'End', 'Minutes', 'Remark', 'Check'],
      model.lossRows.map(x => [x.date, x.lineId, x.shift, x.source, x.category, x.detail, x.start, x.end, x.minutes, x.remark, x.overlap]),
      { fmt: [null, null, null, null, null, null, null, null, MIN, null, null], total: ['label', null, null, null, null, null, null, null, 'sum', null, null] });
    ws.views = [{ state: 'frozen', ySplit: 0 }];
    void evTop;

    // 06 Raw Data
    ws = wb.addWorksheet('06 Raw Data', { properties: { tabColor: { argb: C.grey } } });
    setupSheet(ws, 'Raw Data — source documents for audit', model, [14, 10, 9, 30, 30, 9, 12, 12, 12, 12, 13, 40]);
    let rr = table(ws, 4, ['Production Date', 'Line', 'Shift', 'Plan document', 'Actual document', 'Plan version', 'Stored Adjusted Plan', 'Sum of plan cells', 'Original Plan', 'Actual (planned cells)', 'Unplanned / stale qty', 'Stale keys'],
      model.units.map(u => [u.date, u.lineId, u.shift, u.planId || 'NO PLAN', u.actualId || 'NO ENTRY', u.planVersion === '' ? null : u.planVersion, blank(u.adjustedPlan), blank(u.cellsPlan), blank(u.originalPlan), blank(u.actual), u.unplannedActual || null, u.staleKeys.join(' ; ')]),
      { fmt: [null, null, null, null, null, '0', NUM, NUM, NUM, NUM, NUM, null], total: ['label', null, null, null, null, null, 'sum', 'sum', 'sum', 'sum', 'sum', null], freeze: true, freezeCols: 3 });
    rr += 3;
    ws.getCell(rr - 1, 1).value = 'Actual cells (actualByCell)'; ws.getCell(rr - 1, 1).font = { bold: true, size: 12, color: { argb: C.navy } };
    header(ws, rr, ['Production Date', 'Line', 'Shift', 'Block index', 'Model', 'Door', 'Qty', 'In plan']);
    model.rawCells.forEach((x, i) => { const row = ws.getRow(rr + 1 + i); [x.date, x.lineId, x.shift, x.blockIndex === '' ? null : x.blockIndex, x.model, x.door, x.qty, x.planned].forEach((v, j) => { const c = row.getCell(j + 1); c.value = typeof v === 'string' ? safeText(v) : v; bodyCell(c, j === 6 ? NUM : null); }); });
    return wb;
  }

  const api = { SHIFTS, MAX_DAYS, resolvePeriod, aggregate, buildWorkbook, chartSpec, lineRows, statusStrip, EXEC_COLS, safeText, safeFileName, fileNameFor, intervalsOverlap, overlapMinutes, completenessOf, addDays };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PV2ExportCore = api;
})(typeof window !== 'undefined' ? window : this);
