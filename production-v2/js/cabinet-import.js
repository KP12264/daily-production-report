(()=>{const $=id=>document.getElementById(id);
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function stat(t,c=""){$("ciStatus").textContent=t;$("ciStatus").className="hero-status "+c}
function detectNote(t,c=""){$("ciDetectMessage").textContent=t;$("ciDetectMessage").className="notice info-notice "+c}
function importNote(t,c=""){let el=$("ciImportMessage");el.style.display="";el.textContent=t;el.className="notice info-notice "+c}
// SheetJS (cellDates:true) constructs Date objects using LOCAL-time
// semantics (internally: new Date(y,m,d,...)) — so they must be read back
// via LOCAL getters, not UTC ones. Reading via getUTC* shifts the result by
// the runtime's UTC offset (e.g. -1 day for a UTC+7 browser), which was the
// exact cause of the reported 2026-06-24/2026-10-30 off-by-one. Reading via
// local getters makes the construct→read round-trip timezone-neutral: the
// stored 'YYYY-MM-DD' key always equals the exact Excel calendar date,
// regardless of which timezone the browser running this is in.
function localDateFromJs(d){const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
function addDaysStr(dateStr,n){
  let [y,m,dd]=dateStr.split("-").map(Number);
  let d=new Date(y,m-1,dd+n); // local constructor, rolls over month/year correctly
  const z=v=>String(v).padStart(2,"0");
  return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;
}
function formatDatePretty(dateStr){
  const MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  let [y,m,d]=dateStr.split("-").map(Number);
  return `${d} ${MONTHS[m-1]} ${y}`;
}

// ===== Plan Daily detection — no hardcoded sheet name suffix or row range =====
// Per approved spec: a sheet name starting with "Plan Daily" is only a
// CANDIDATE. Structure (date header + Model/Cab/Line header + at least one
// valid section block) must be positively validated before it's accepted.
// Requires >=2 consecutive ascending date columns (not >=7) — a shorter
// planning window must not be rejected.
function findCandidateSheets(wb){
  return wb.SheetNames.filter(n=>n.trim().toLowerCase().startsWith("plan daily"));
}
function findDateHeaderRow(ws,range){
  // scan rows 1..10 for a run of >=2 consecutive columns holding ascending dates
  for(let r=range.s.r;r<=Math.min(range.s.r+10,range.e.r);r++){
    let run=[];
    for(let c=range.s.c;c<=range.e.c;c++){
      let cell=ws[XLSX.utils.encode_cell({r,c})];
      let d=cell&&cell.t==="d"?cell.v:null;
      if(d instanceof Date){
        if(run.length&&isNextDay(run[run.length-1].date,d))run.push({c,date:d});
        else run=[{c,date:d}];
        if(run.length>=2){
          // extend the run forward as far as it goes
          let cc=c+1;
          while(cc<=range.e.c){
            let cell2=ws[XLSX.utils.encode_cell({r,c:cc})];
            let d2=cell2&&cell2.t==="d"?cell2.v:null;
            if(d2 instanceof Date&&isNextDay(run[run.length-1].date,d2)){run.push({c:cc,date:d2});cc++}
            else break;
          }
          return {row:r,cols:run};
        }
      }else run=[];
    }
  }
  return null;
}
function isNextDay(a,b){
  let next=new Date(a.getFullYear(),a.getMonth(),a.getDate()+1);
  return next.getFullYear()===b.getFullYear()&&next.getMonth()===b.getMonth()&&next.getDate()===b.getDate();
}
function cellText(ws,r,c){let cell=ws[XLSX.utils.encode_cell({r,c})];return cell?String(cell.v??"").trim():""}
function findLabelHeader(ws,range,dateHeaderRow){
  // Anchor on the "Line" header cell — a reliable, explicit structural
  // signal. Model column is the LEFTMOST column of the row (confirmed
  // structural position in the real workbook): its own header cell may
  // just be a section label like "A line", not literally "Model" — so
  // matching by header TEXT is unreliable and was the actual bug. We still
  // require the explicit "Line" header to exist — this isn't a free pass
  // for arbitrary sheets, just a correction of which column is Model.
  // Search BOTH above and below the date-header row — the real workbook
  // has the label row AFTER the date row (dates row 3, labels row 4), not
  // necessarily above it.
  for(let r=Math.max(range.s.r,dateHeaderRow-3);r<=Math.min(range.e.r,dateHeaderRow+3);r++){
    let lineCol=null;
    for(let c=range.s.c;c<=range.e.c;c++){
      let t=cellText(ws,r,c).toLowerCase();
      if(t&&/^line$/.test(t)){lineCol=c;break}
    }
    if(lineCol!==null){
      let modelCol=range.s.c;
      return {headerRow:r,modelCol,cabCol:modelCol+1,lineCol};
    }
  }
  return null;
}
const NON_CABINET_MARKERS=/door foam|press|machine|^sum$|^total|new total|average/i;
function extractSectionBlocks(ws,range,labelHeader,dateCols){
  let blocks=[],r=labelHeader.headerRow+1,blankRun=0,current=null,currentTag=null;
  while(r<=range.e.r){
    let modelTxt=cellText(ws,r,labelHeader.modelCol);
    let cabTxt=cellText(ws,r,labelHeader.cabCol);
    let lineTxt=cellText(ws,r,labelHeader.lineCol);
    let combined=`${modelTxt} ${cabTxt} ${lineTxt}`;
    if(NON_CABINET_MARKERS.test(combined)){
      // hit a non-cabinet section (Door foam / Press / SUM / etc.) — stop entirely,
      // everything below belongs to capacity/summary sections, never Cabinet Plan
      break;
    }
    if(!modelTxt){
      blankRun++;
      if(blankRun>=3){current=null;currentTag=null}
      r++;continue;
    }
    blankRun=0;
    // Group consecutive rows by the Line column's own per-row value (e.g.
    // "A"/"B") into a pseudo-block for Preview display — a blank Line cell
    // means "still the same context as the row above" (sub-variant rows
    // like Café/DND continuing under their parent), not a new block. This
    // is descriptive only (excelLineRaw / "Line Marker" shown in Preview)
    // — NEVER used to infer Production V2 Line, per the architecture rule.
    if(lineTxt&&lineTxt!==currentTag){
      current={lineMarker:lineTxt,rows:[]};
      blocks.push(current);
      currentTag=lineTxt;
    }else if(!current){
      current={lineMarker:"(unlabeled)",rows:[]};
      blocks.push(current);
    }
    let qtyByDate={},hasNumeric=false;
    dateCols.forEach(dc=>{
      let cell=ws[XLSX.utils.encode_cell({r,c:dc.c})];
      let v=cell?cell.v:null;
      if(typeof v==="number"){qtyByDate[localDateFromJs(dc.date)]=Math.round(v);hasNumeric=true}
    });
    if(hasNumeric){
      current.rows.push({excelModel:modelTxt,excelCab:cabTxt,excelLineRaw:lineTxt||current.lineMarker,qtyByDate});
    }
    r++;
  }
  return blocks.filter(b=>b.rows.length);
}
function detectPlanDaily(wb){
  // Scan EVERY candidate sheet, not just the first valid one — a workbook
  // may have several "Plan Daily..." sheets (different periods). Collect
  // all that pass structural validation.
  const validSheets=[];
  for(const sheetName of findCandidateSheets(wb)){
    const ws=wb.Sheets[sheetName];
    const range=XLSX.utils.decode_range(ws['!ref']);
    const dateHdr=findDateHeaderRow(ws,range);
    if(!dateHdr)continue;
    const labelHdr=findLabelHeader(ws,range,dateHdr.row);
    if(!labelHdr)continue;
    const blocks=extractSectionBlocks(ws,range,labelHdr,dateHdr.cols);
    if(!blocks.length)continue;
    validSheets.push({sheetName,dateCols:dateHdr.cols,blocks});
  }
  if(!validSheets.length)return null;

  // Build date -> [sheetName,...] map to find overlaps across sheets.
  // A date with exactly one source is auto-owned by that sheet. A date
  // found in MORE THAN ONE valid sheet is a CONFLICT — left unresolved
  // (no owner assigned) until the user explicitly picks a source sheet in
  // Preview. Never auto-picked by workbook/sheet order.
  const dateOwners={}; // date -> sheetName (only set for non-conflicted dates, until user resolves conflicts)
  const dateSources={}; // date -> [sheetName,...] that contain it
  validSheets.forEach(vs=>{
    vs.dateCols.forEach(dc=>{
      const d=localDateFromJs(dc.date);
      (dateSources[d]??=[]).push(vs.sheetName);
    });
  });
  Object.entries(dateSources).forEach(([d,srcs])=>{
    if(srcs.length===1)dateOwners[d]=srcs[0]; // unambiguous — auto-own
    // srcs.length>1 → leave dateOwners[d] unset; resolved only by explicit user selection
  });
  const conflicts=Object.entries(dateSources).filter(([d,srcs])=>srcs.length>1)
    .map(([d,srcs])=>({date:d,sources:srcs}))
    .sort((a,b)=>a.date.localeCompare(b.date));

  return {validSheets,dateOwners,conflicts,allDates:Object.keys(dateSources).sort()};
}

let S={detected:null,existingDates:[],previewDate:null};

async function handleDetect(){
  let f=$("ciFile").files?.[0];
  if(!f){detectNote("เลือกไฟล์ Excel ก่อน","plan-warn");return}
  try{
    detectNote("กำลังอ่านไฟล์...");
    let buf=await f.arrayBuffer();
    let wb=XLSX.read(buf,{type:"array",cellDates:true});
    let result=detectPlanDaily(wb);
    if(!result){
      detectNote("Plan structure requires review — ไม่พบ sheet ที่มีโครงสร้าง Plan Daily ที่ตรวจสอบได้ (ต้องมีคอลัมน์วันที่เรียงต่อกันอย่างน้อย 2 วัน + หัวคอลัมน์ Model/Cab + Line + อย่างน้อย 1 block ที่ขึ้นต้นด้วย \"... line\") — ระบบไม่เดาโครงสร้าง กรุณาตรวจสอบไฟล์","plan-warn");
      $("ciPreviewSection").style.display="none";
      return;
    }
    S.detected=result;
    S.fileName=f.name;
    await renderPreview();
    const conflictNote=result.conflicts.length?` · ⚠ พบวันที่ซ้อนกันระหว่าง sheet ${result.conflicts.length} วัน (ดู Preview)`:"";
    detectNote(`ตรวจพบ ${result.validSheets.length} sheet ที่มีโครงสร้าง Plan Daily ถูกต้อง (${result.validSheets.map(v=>v.sheetName).join(", ")}) — ตรวจสอบ Preview ด้านล่างก่อน Import${conflictNote}`,result.conflicts.length?"plan-warn":"plan-ok");
  }catch(e){console.error(e);detectNote("อ่านไฟล์ไม่สำเร็จ: "+e.message,"plan-warn")}
}

// Sample table — Plan Qty column reads directly from the already-extracted,
// already-normalized qtyByDate for the selected Preview Date. Never
// recomputes or re-derives a quantity — same values doImport() would write.
function renderSampleTable(){
  const {validSheets,dateOwners}=S.detected;
  const selDate=S.previewDate;
  let h=`<div class="table-scroll"><table class="grid"><thead><tr><th>Plan Sheet</th><th>Line Marker (Excel — ไม่ใช่ Production V2 Line)</th><th>Excel Model</th><th>Cab</th><th>Active Days (นับเฉพาะวันที่ sheet นี้เป็นเจ้าของอยู่ตอนนี้)</th><th>Plan Qty · ${formatDatePretty(selDate)}</th></tr></thead><tbody>`;
  validSheets.forEach(vs=>vs.blocks.forEach(b=>b.rows.forEach(r=>{
    let ownedDates=Object.keys(r.qtyByDate).filter(d=>dateOwners[d]===vs.sheetName&&r.qtyByDate[d]);
    // Plan Qty for the selected date — only shown if THIS row's sheet
    // actually owns that date (post conflict-resolution) and the date has
    // a real entry; otherwise "-" (never fabricated as 0).
    let qtyForSelDate="-";
    if(dateOwners[selDate]===vs.sheetName&&Object.prototype.hasOwnProperty.call(r.qtyByDate,selDate)){
      qtyForSelDate=r.qtyByDate[selDate];
    }
    h+=`<tr><td>${esc(vs.sheetName)}</td><td>${esc(b.lineMarker)}</td><td>${esc(r.excelModel)}</td><td>${esc(r.excelCab)}</td><td>${ownedDates.length}</td><td>${qtyForSelDate}</td></tr>`;
  })));
  h+="</tbody></table></div>";
  $("ciPreviewTable").innerHTML=h;
}
async function renderPreview(){
  const {validSheets,dateOwners,conflicts,allDates}=S.detected;
  const startDate=allDates[0],endDate=allDates[allDates.length-1];

  // unique cabinet models + total qty, counting ONLY each date's WINNING
  // sheet contribution (never double-counting a conflicted date across
  // more than one sheet)
  let uniqueKeys=new Set();
  let totalQty=0;
  validSheets.forEach(vs=>{
    vs.blocks.forEach(b=>b.rows.forEach(r=>{
      uniqueKeys.add(r.excelModel+"|||"+r.excelCab);
      Object.entries(r.qtyByDate).forEach(([d,v])=>{
        if(dateOwners[d]===vs.sheetName)totalQty+=Number(v)||0; // only count if this sheet owns that date
      });
    }));
  });

  $("ciPreviewSummary").innerHTML=`<table class="grid"><tbody>
    <tr><td>Plan Sheets Found</td><td><b>${validSheets.length}</b> (${validSheets.map(v=>esc(v.sheetName)).join(", ")})</td></tr>
    <tr><td>Date Range (รวมทุก sheet)</td><td><b>${startDate} → ${endDate}</b> (${allDates.length} วัน)</td></tr>
    <tr><td>Date Conflicts</td><td>${conflicts.length?`<b class="kpi-bad">${conflicts.length} วัน</b> — ดูตารางด้านล่าง`:'<b class="kpi-good">ไม่มี</b>'}</td></tr>
    <tr><td>Unique Cabinet Model/Cab combos</td><td><b>${uniqueKeys.size}</b></td></tr>
    <tr><td>Total Cabinet Plan Qty (หลังแก้ Conflict แล้ว)</td><td><b>${Math.round(totalQty).toLocaleString()} pcs</b></td></tr>
  </tbody></table>`;

  // Explicit conflict table — never auto-resolved. Each conflicted date
  // gets a dropdown; the user MUST pick a source sheet before that date
  // can be imported. Total Qty/summary above only counts dates that
  // currently have an owner (auto-owned non-conflicted + already-resolved
  // conflicts), so the number on screen never silently includes an
  // unresolved date under an assumed sheet.
  if(conflicts.length){
    let ch='<div class="notice plan-warn" style="margin:12px 0">⚠ พบวันที่เดียวกันอยู่ในมากกว่า 1 Plan Daily sheet — ต้องเลือก Sheet ที่จะใช้ให้ครบทุกวันก่อนถึงจะ Import ได้ (Import จะถูกปิดใช้งานจนกว่าจะเลือกครบ) ระบบจะไม่เดาให้ตามลำดับ sheet ในไฟล์</div>';
    ch+='<div class="table-scroll"><table class="grid"><thead><tr><th>Date</th><th>Found In</th><th>Use</th></tr></thead><tbody>';
    conflicts.forEach(c=>{
      const current=dateOwners[c.date]||"";
      ch+=`<tr data-cc-conflict="${c.date}"><td>${c.date}</td><td>${c.sources.map(esc).join(" และ ")}</td><td><select data-conflict-date="${c.date}"><option value="" ${!current?"selected":""}>-- เลือก Sheet --</option>${c.sources.map(s=>`<option value="${esc(s)}" ${current===s?"selected":""}>${esc(s)}</option>`).join("")}</select></td></tr>`;
    });
    ch+='</tbody></table></div>';
    $("ciConflictTable").innerHTML=ch;
    $("ciConflictTable").style.display="";
    $("ciConflictTable").querySelectorAll("[data-conflict-date]").forEach(sel=>{
      sel.onchange=async()=>{
        const d=sel.dataset.conflictDate;
        if(sel.value)dateOwners[d]=sel.value; else delete dateOwners[d];
        await renderPreview();
      };
    });
  }else{
    $("ciConflictTable").style.display="none";
  }

  // Preview Date selector — populated from the exact detected date union,
  // read-only display only. Defaults to the first date, or keeps the
  // previously selected date if it's still valid for this file.
  if(!S.previewDate||!allDates.includes(S.previewDate))S.previewDate=allDates[0];
  const dsel=$("ciPreviewDateSelect");
  dsel.innerHTML=allDates.map(d=>`<option value="${d}" ${d===S.previewDate?"selected":""}>${d}</option>`).join("");
  dsel.onchange=()=>{S.previewDate=dsel.value;renderSampleTable()};

  renderSampleTable();

  // check existing prodV2_cabinetPlan docs for this date range
  stat("Checking existing plan...");
  let existing=[];
  await Promise.all(allDates.map(async d=>{
    let doc=await ProdV2DB.collection("prodV2_cabinetPlan").doc(`cabinetplan_${d}`).get();
    if(doc.exists)existing.push(d);
  }));
  S.existingDates=existing;
  stat("Ready","ok");
  updateImportAvailability();
  $("ciPreviewSection").style.display="";
}

function updateImportAvailability(){
  const {conflicts,dateOwners}=S.detected;
  const unresolvedCount=conflicts.filter(c=>!dateOwners[c.date]).length;
  const hasExisting=S.existingDates.length>0;
  const btn=hasExisting?$("ciReplaceBtn"):$("ciImportBtn");
  const otherBtn=hasExisting?$("ciImportBtn"):$("ciReplaceBtn");
  btn.style.display="";
  otherBtn.style.display="none";
  if(hasExisting){
    $("ciExistingWarning").style.display="";
    $("ciExistingWarning").className="notice plan-warn";
    $("ciExistingWarning").innerHTML=`⚠️ พบ Cabinet Plan ที่เคย Import ไว้แล้วสำหรับ ${S.existingDates.length} วันในช่วงนี้ (${S.existingDates[0]} ถึง ${S.existingDates[S.existingDates.length-1]}) — การ Import จะ <b>แทนที่ (Replace)</b> ข้อมูลเดิมของวันเหล่านั้นทั้งหมด ไม่ใช่บวกเพิ่ม`;
  }else{
    $("ciExistingWarning").style.display="none";
  }
  // Import stays disabled until every conflicted date has an explicit
  // selection — never gated only on workbook/sheet order.
  btn.disabled=unresolvedCount>0;
  btn.title=unresolvedCount>0?`ยังมี ${unresolvedCount} วันที่ยังไม่ได้เลือก Sheet ในตาราง Date Conflicts ด้านบน`:"";
}

async function doImport(){
  const {validSheets,dateOwners,conflicts}=S.detected;
  const unresolved=conflicts.filter(c=>!dateOwners[c.date]);
  if(unresolved.length){
    importNote(`Import ถูกระงับ — ยังมี ${unresolved.length} วันที่ยังไม่ได้เลือก Sheet ในตาราง Date Conflicts (${unresolved.map(c=>c.date).join(", ")})`,"plan-warn");
    return;
  }
  const allDates=Object.keys(dateOwners).sort();
  const btn=S.existingDates.length?$("ciReplaceBtn"):$("ciImportBtn");
  btn.disabled=true;
  try{
    stat(`Importing ${allDates.length} days...`);
    for(const d of allDates){
      const ownerSheet=dateOwners[d];
      const vs=validSheets.find(v=>v.sheetName===ownerSheet);
      let rows=[];
      vs.blocks.forEach(b=>b.rows.forEach(r=>{
        if(Object.prototype.hasOwnProperty.call(r.qtyByDate,d)){
          rows.push({excelModel:r.excelModel,excelCab:r.excelCab,excelLineRaw:r.excelLineRaw,qty:r.qtyByDate[d]});
        }
      }));
      if(!rows.length)continue;
      // Plain set() (no merge) — a re-import fully REPLACES this date's doc,
      // never appends/duplicates. Rows come ONLY from this date's owning
      // sheet — a conflicted date never merges rows from more than one sheet.
      await ProdV2DB.set("prodV2_cabinetPlan",`cabinetplan_${d}`,{
        date:d,
        importedAt:Date.now(),
        sourceFile:S.fileName,
        sourceSheet:ownerSheet,
        rows,
        importSnapshot:{note:"audit snapshot only — Cabinet Plan Coverage / Plan Achievement Tracking re-evaluate mapping live, do not read this"}
      });
    }
    importNote(`✓ Import สำเร็จ ${allDates.length} วัน (${allDates[0]} → ${allDates[allDates.length-1]})`,"plan-ok");
    stat("Imported","ok");
  }catch(e){console.error(e);importNote("Import ไม่สำเร็จ: "+e.message,"plan-warn");stat("Import failed","err")}
  finally{btn.disabled=false}
}

function init(){
  $("ciDetectBtn").onclick=handleDetect;
  $("ciImportBtn").onclick=doImport;
  $("ciReplaceBtn").onclick=doImport;
}
addEventListener("DOMContentLoaded",init)})();
