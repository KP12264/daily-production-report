(()=>{const $=id=>document.getElementById(id);
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function stat(t,c=""){$("ciStatus").textContent=t;$("ciStatus").className="hero-status "+c}
function detectNote(t,c=""){$("ciDetectMessage").textContent=t;$("ciDetectMessage").className="notice info-notice "+c}
function importNote(t,c=""){let el=$("ciImportMessage");el.style.display="";el.textContent=t;el.className="notice info-notice "+c}
function excelDateToStr(v){
  if(v instanceof Date)return localDateFromJs(v);
  if(typeof v==="number"){let d=new Date(Math.round((v-25569)*86400*1000));return localDateFromJs(d)}
  return null;
}
function localDateFromJs(d){const z=n=>String(n).padStart(2,"0");return `${d.getUTCFullYear()}-${z(d.getUTCMonth()+1)}-${z(d.getUTCDate())}`}
function addDaysStr(dateStr,n){let d=new Date(dateStr+"T12:00:00Z");d.setUTCDate(d.getUTCDate()+n);return localDateFromJs(d)}

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
function isNextDay(a,b){let d1=new Date(Date.UTC(a.getUTCFullYear(),a.getUTCMonth(),a.getUTCDate()));let d2=new Date(Date.UTC(b.getUTCFullYear(),b.getUTCMonth(),b.getUTCDate()));return (d2-d1)===86400000}
function cellText(ws,r,c){let cell=ws[XLSX.utils.encode_cell({r,c})];return cell?String(cell.v??"").trim():""}
function findLabelHeader(ws,range,dateHeaderRow){
  // scan a few rows at/above the date header for Model/Cab + Line column markers
  for(let r=Math.max(range.s.r,dateHeaderRow-3);r<=dateHeaderRow;r++){
    let modelCol=null,lineCol=null;
    for(let c=range.s.c;c<=range.e.c;c++){
      let t=cellText(ws,r,c).toLowerCase();
      if(!t)continue;
      if(modelCol===null&&/model|cab|product/.test(t))modelCol=c;
      if(/^line$/.test(t))lineCol=c;
    }
    if(modelCol!==null&&lineCol!==null)return {headerRow:r,modelCol,cabCol:modelCol+1,lineCol};
  }
  return null;
}
const NON_CABINET_MARKERS=/door foam|press|machine|^sum$|^total|new total|average/i;
function extractSectionBlocks(ws,range,labelHeader,dateCols){
  let blocks=[],r=labelHeader.headerRow+1,blankRun=0,current=null;
  while(r<=range.e.r){
    let modelTxt=cellText(ws,r,labelHeader.modelCol);
    let cabTxt=cellText(ws,r,labelHeader.cabCol);
    let lineTxt=cellText(ws,r,labelHeader.lineCol);
    let combined=`${modelTxt} ${cabTxt} ${lineTxt}`;
    if(/ line$/i.test(modelTxt.trim())){
      current={lineMarker:modelTxt.trim(),rows:[]};
      blocks.push(current);
      blankRun=0;r++;continue;
    }
    if(NON_CABINET_MARKERS.test(combined)){
      // hit a non-cabinet section (Door foam / Press / SUM / etc.) — stop entirely,
      // everything below belongs to capacity/summary sections, never Cabinet Plan
      break;
    }
    if(!modelTxt){
      blankRun++;
      if(blankRun>=3){r++;continue}
      r++;continue;
    }
    blankRun=0;
    if(!current){r++;continue} // rows before the first "<x> line" marker aren't part of any block
    let qtyByDate={},hasNumeric=false;
    dateCols.forEach(dc=>{
      let cell=ws[XLSX.utils.encode_cell({r,c:dc.c})];
      let v=cell?cell.v:null;
      if(typeof v==="number"){qtyByDate[localDateFromJs(dc.date)]=v;hasNumeric=true}
    });
    if(hasNumeric){
      current.rows.push({excelModel:modelTxt,excelCab:cabTxt,excelLineRaw:lineTxt||current.lineMarker,qtyByDate});
    }
    r++;
  }
  return blocks.filter(b=>b.rows.length);
}
function detectPlanDaily(wb){
  for(const sheetName of findCandidateSheets(wb)){
    const ws=wb.Sheets[sheetName];
    const range=XLSX.utils.decode_range(ws['!ref']);
    const dateHdr=findDateHeaderRow(ws,range);
    if(!dateHdr)continue;
    const labelHdr=findLabelHeader(ws,range,dateHdr.row);
    if(!labelHdr)continue;
    const blocks=extractSectionBlocks(ws,range,labelHdr,dateHdr.cols);
    if(!blocks.length)continue;
    return {sheetName,dateCols:dateHdr.cols,blocks};
  }
  return null;
}

let S={detected:null,existingDates:[]};

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
    detectNote(`ตรวจพบ sheet "${result.sheetName}" ถูกต้อง — ตรวจสอบ Preview ด้านล่างก่อน Import`,"plan-ok");
  }catch(e){console.error(e);detectNote("อ่านไฟล์ไม่สำเร็จ: "+e.message,"plan-warn")}
}

async function renderPreview(){
  const {sheetName,dateCols,blocks}=S.detected;
  const dates=dateCols.map(dc=>localDateFromJs(dc.date));
  const startDate=dates[0],endDate=dates[dates.length-1];

  // unique cabinet models across all blocks (by excelModel+excelCab)
  let uniqueKeys=new Set();
  let totalQty=0;
  blocks.forEach(b=>b.rows.forEach(r=>{
    uniqueKeys.add(r.excelModel+"|||"+r.excelCab);
    Object.values(r.qtyByDate).forEach(v=>totalQty+=Number(v)||0);
  }));

  $("ciPreviewSummary").innerHTML=`<table class="grid"><tbody>
    <tr><td>Plan Sheet</td><td><b>${esc(sheetName)}</b></td></tr>
    <tr><td>Date Range</td><td><b>${startDate} → ${endDate}</b> (${dates.length} วัน)</td></tr>
    <tr><td>Cabinet Blocks Found</td><td><b>${blocks.length}</b> (${blocks.map(b=>esc(b.lineMarker)).join(", ")})</td></tr>
    <tr><td>Unique Cabinet Model/Cab combos</td><td><b>${uniqueKeys.size}</b></td></tr>
    <tr><td>Total Cabinet Plan Qty (ทั้งช่วง)</td><td><b>${Math.round(totalQty).toLocaleString()} pcs</b></td></tr>
  </tbody></table>`;

  // per-block row table (sample)
  let h='<div class="table-scroll"><table class="grid"><thead><tr><th>Line Marker (Excel — ไม่ใช่ Production V2 Line)</th><th>Excel Model</th><th>Cab</th><th>Active Days</th><th>Example Qty</th></tr></thead><tbody>';
  blocks.forEach(b=>b.rows.forEach(r=>{
    let activeDays=Object.values(r.qtyByDate).filter(v=>v).length;
    let exampleQty=Object.values(r.qtyByDate).find(v=>v)??0;
    h+=`<tr><td>${esc(b.lineMarker)}</td><td>${esc(r.excelModel)}</td><td>${esc(r.excelCab)}</td><td>${activeDays} / ${dates.length}</td><td>${exampleQty}</td></tr>`;
  }));
  h+="</tbody></table></div>";
  $("ciPreviewTable").innerHTML=h;

  // check existing prodV2_cabinetPlan docs for this date range
  stat("Checking existing plan...");
  let existing=[];
  await Promise.all(dates.map(async d=>{
    let doc=await ProdV2DB.collection("prodV2_cabinetPlan").doc(`cabinetplan_${d}`).get();
    if(doc.exists)existing.push(d);
  }));
  S.existingDates=existing;
  stat("Ready","ok");

  if(existing.length){
    $("ciExistingWarning").style.display="";
    $("ciExistingWarning").className="notice plan-warn";
    $("ciExistingWarning").innerHTML=`⚠️ พบ Cabinet Plan ที่เคย Import ไว้แล้วสำหรับ ${existing.length} วันในช่วงนี้ (${existing[0]} ถึง ${existing[existing.length-1]}) — การ Import จะ <b>แทนที่ (Replace)</b> ข้อมูลเดิมของวันเหล่านั้นทั้งหมด ไม่ใช่บวกเพิ่ม`;
    $("ciImportBtn").style.display="none";
    $("ciReplaceBtn").style.display="";
  }else{
    $("ciExistingWarning").style.display="none";
    $("ciImportBtn").style.display="";
    $("ciReplaceBtn").style.display="none";
  }
  $("ciPreviewSection").style.display="";
}

async function doImport(){
  const {sheetName,dateCols,blocks}=S.detected;
  const dates=dateCols.map(dc=>localDateFromJs(dc.date));
  const btn=S.existingDates.length?$("ciReplaceBtn"):$("ciImportBtn");
  btn.disabled=true;
  try{
    stat(`Importing ${dates.length} days...`);
    for(const d of dates){
      let rows=[];
      blocks.forEach(b=>b.rows.forEach(r=>{
        if(Object.prototype.hasOwnProperty.call(r.qtyByDate,d)){
          rows.push({excelModel:r.excelModel,excelCab:r.excelCab,excelLineRaw:r.excelLineRaw,qty:r.qtyByDate[d]});
        }
      }));
      if(!rows.length)continue;
      // Plain set() (no merge) — a re-import fully REPLACES this date's doc,
      // never appends/duplicates, per the approved spec.
      await ProdV2DB.set("prodV2_cabinetPlan",`cabinetplan_${d}`,{
        date:d,
        importedAt:Date.now(),
        sourceFile:S.fileName,
        sourceSheet:sheetName,
        rows,
        importSnapshot:{note:"audit snapshot only — Cabinet Plan Coverage re-evaluates mapping live, does not read this"}
      });
    }
    importNote(`✓ Import สำเร็จ ${dates.length} วัน (${dates[0]} → ${dates[dates.length-1]})`,"plan-ok");
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
