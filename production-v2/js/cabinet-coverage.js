(()=>{const $=id=>document.getElementById(id);
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function localDate(d=new Date()){const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
function achClass(z){return z===null?"":z>=100?"kpi-good":z>=95?"kpi-watch":"kpi-bad"}
function stat(t,c=""){$("ccStatus").textContent=t;$("ccStatus").className="hero-status "+c}
function note(t,c=""){$("ccMessage").textContent=t;$("ccMessage").className="notice info-notice "+c}
function splitKey(k){let [model,door]=String(k).split("|||");return {model,door}}

let S={view:"door",data:null,expanded:null};

async function computeCoverage(date){
  // 1) Raw Cabinet Plan for this date — mapping-independent source
  const planDoc=await ProdV2DB.collection("prodV2_cabinetPlan").doc(`cabinetplan_${date}`).get();
  const rows=planDoc.exists?(planDoc.data().rows||[]):[];

  // 2) Live Mapping Master — re-evaluated every time, never trusts any
  //    import-time snapshot, so editing Mapping later needs no re-import
  const mapSnap=await ProdV2DB.collection("prodV2_doorMapping").get();
  const mappings=mapSnap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>m.active!==false);

  // 3) Live Model Master — resolver ground truth
  const modelSnap=await ProdV2DB.collection("prodV2_models").get();
  const activeModels=modelSnap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>m.active!==false);
  function resolveLine(actualModel,actualDoor){
    const matches=activeModels.filter(m=>m.modelName===actualModel&&m.doorCode===actualDoor);
    if(matches.length===0)return {status:"UNRESOLVED ACTUAL TARGET",lineId:null};
    if(matches.length>1)return {status:"AMBIGUOUS ACTUAL TARGET",lineId:null};
    return {status:"ok",lineId:matches[0].lineId};
  }

  // 4) Cabinet Plan row → Mapping lookup (exact match on every field present
  //    in matchFields — extensible without redesign) → coverageKey aggregation
  const requirementByKey={}; // coverageKey -> raw (unrounded) sum
  const contributionsByKey={}; // coverageKey -> [{excelModel,excelCab,qty,qtyPerCabinet,requiredQty}]
  const cabinetRows=[]; // per-row info for Cabinet Coverage view
  const unmapped=[];

  rows.forEach(row=>{
    const mapDoc=mappings.find(m=>{
      const mf=m.matchFields||{};
      return mf.excelModel===row.excelModel && (mf.excelCab||"")===(row.excelCab||"");
    });
    if(!mapDoc||mapDoc.status!=="mapped"||!(mapDoc.positions||[]).length){
      unmapped.push({...row,reason:mapDoc?.mappingRequiredReason||"ไม่พบ Mapping สำหรับ Excel Model/Cab นี้"});
      cabinetRows.push({...row,mapped:false,coverageKeys:[]});
      return;
    }
    const keys=[];
    mapDoc.positions.forEach(p=>{
      const coverageKey=p.actualModel+"|||"+p.actualDoor;
      const requiredQty=Number(row.qty||0)*Number(p.qtyPerCabinet||1);
      requirementByKey[coverageKey]=(requirementByKey[coverageKey]||0)+requiredQty;
      (contributionsByKey[coverageKey]??=[]).push({excelModel:row.excelModel,excelCab:row.excelCab,qty:row.qty,qtyPerCabinet:p.qtyPerCabinet,requiredQty,door:p.door});
      keys.push(coverageKey);
    });
    cabinetRows.push({...row,mapped:true,coverageKeys:keys});
  });

  // 5) Resolve each coverageKey to a Line, collect resolver failures separately
  //    from "mapping_required" — these mean the Mapping itself points at a
  //    Model/Door that doesn't exist in Production V2, a stricter problem
  const resolverIssues=[];
  const keyToLine={};
  Object.keys(requirementByKey).forEach(k=>{
    const {model,door}=splitKey(k);
    const r=resolveLine(model,door);
    if(r.status!=="ok")resolverIssues.push({coverageKey:k,model,door,status:r.status});
    else keyToLine[k]=r.lineId;
  });

  // 6) Actual — read-only, existing prodV2_actualLogs, DAY+NIGHT for this
  //    Production Date exactly as already stored (no new midnight logic)
  const neededLines=[...new Set(Object.values(keyToLine))];
  const actualByKey={};
  await Promise.all(neededLines.flatMap(lineId=>["DAY","NIGHT"].map(async shift=>{
    const doc=await ProdV2DB.collection("prodV2_actualLogs").doc(`actual_${date}_${lineId}_${shift}`).get();
    if(!doc.exists)return;
    const cells=doc.data().actualByCell||{};
    Object.entries(cells).forEach(([cellKey,v])=>{
      const parts=cellKey.split("|||"); // blockIndex|||model|||door
      const k=parts[1]+"|||"+parts[2];
      if(requirementByKey[k]!=null)actualByKey[k]=(actualByKey[k]||0)+Number(v||0);
    });
  })));

  // 7) Final per-coverageKey figures — ONE rounding point (Required), Gap/
  //    Remaining/Coverage all derive from that same rounded value
  const doorRows=Object.keys(requirementByKey).map(k=>{
    const requiredRounded=Math.round(requirementByKey[k]);
    const actual=Math.round(actualByKey[k]||0);
    const gap=actual-requiredRounded;
    const remaining=Math.max(requiredRounded-actual,0);
    const coveragePct=requiredRounded>0?(actual/requiredRounded*100):null;
    const resolverIssue=resolverIssues.find(ri=>ri.coverageKey===k);
    return {
      coverageKey:k, ...splitKey(k),
      required:requiredRounded, actual, gap, remaining, coveragePct,
      status: resolverIssue ? resolverIssue.status : (actual>=requiredRounded?"covered":"short"),
      contributions: contributionsByKey[k]||[]
    };
  }).sort((a,b)=>b.remaining-a.remaining);

  const totalRequired=doorRows.reduce((s,r)=>s+r.required,0);
  const totalActual=doorRows.reduce((s,r)=>s+r.actual,0);
  const totalRemaining=doorRows.reduce((s,r)=>s+r.remaining,0);
  const totalCabinetPlan=rows.reduce((s,r)=>s+Number(r.qty||0),0);

  return {date,rows,doorRows,cabinetRows,unmapped,resolverIssues,totalRequired,totalActual,totalRemaining,totalCabinetPlan};
}

function renderStatusBanner(data){
  const host=$("ccStatusBanner");
  const hasUnmapped=data.unmapped.length>0||data.resolverIssues.length>0;
  const today=localDate();
  const dayOver=data.date<today;
  let status,cls,icon;
  if(hasUnmapped){status="CHECK MAPPING";cls="kpi-bad-bg";icon="🟠"}
  else if(data.doorRows.every(r=>r.status==="covered")){status="READY";cls="kpi-good-bg";icon="🟢"}
  else if(!dayOver){status="IN PROGRESS";cls="kpi-bad-bg";icon="🟡"}
  else{status="SHORTAGE";cls="kpi-bad-bg";icon="🔴"}
  host.className="dash-status-banner "+cls;
  host.innerHTML=`<div class="dash-status-context">CABINET PLAN COVERAGE · ${esc(data.date)}</div><div class="dash-status-main"><span class="dash-status-icon">${icon}</span><span class="dash-status-text">${status}</span></div>`;

  const mapHost=$("ccMappingStatus");
  const totalCombos=data.cabinetRows.length;
  const mappedCombos=data.cabinetRows.filter(r=>r.mapped).length;
  mapHost.innerHTML=totalCombos?`<div class="dash-secondary-caption">Mapping: <b>${mappedCombos}/${totalCombos}</b> models mapped${data.unmapped.length?` · ⚠ <b>${data.unmapped.length}</b> require mapping`:""}${data.resolverIssues.length?` · 🔴 <b>${data.resolverIssues.length}</b> Actual target ตรวจสอบกับ Master ไม่ผ่าน`:""}</div>`:"";
}

function renderKpis(data){
  const coveragePct=data.totalRequired>0?(data.totalActual/data.totalRequired*100):null;
  $("ccPrimaryKpis").innerHTML=`
    <div class="dash-pkpi"><small>CABINET PLAN</small><b>${Math.round(data.totalCabinetPlan).toLocaleString()}<span class="dash-pkpi-unit">pcs</span></b></div>
    <div class="dash-pkpi"><small>REQUIRED DOORS</small><b>${data.totalRequired.toLocaleString()}<span class="dash-pkpi-unit">pcs</span></b></div>
    <div class="dash-pkpi dash-pkpi-actual"><small>DOOR ACTUAL</small><b>${data.totalActual.toLocaleString()}<span class="dash-pkpi-unit">pcs</span></b></div>
    <div class="dash-pkpi"><small>REMAINING</small><b class="${data.totalRemaining>0?"kpi-bad":"kpi-good"}">${data.totalRemaining.toLocaleString()}<span class="dash-pkpi-unit">pcs</span></b><span class="dash-pkpi-ref">${coveragePct!==null?coveragePct.toFixed(1)+"% Coverage":"—"}</span></div>`;
}

function renderDoorTable(data){
  if(!data.doorRows.length){$("ccTableArea").innerHTML='<div class="empty-state">ไม่มี Door Requirement สำหรับวันนี้ (อาจยังไม่ได้ Import Cabinet Plan หรือทุก Model ยัง Mapping Required)</div>';return}
  let h='<div class="table-scroll"><table class="grid"><thead><tr><th>Door Target</th><th>Door</th><th>Required</th><th>Actual</th><th>Gap</th><th>Remaining</th><th>Coverage</th><th>Status</th></tr></thead><tbody>';
  data.doorRows.forEach((r,i)=>{
    const isOpen=S.expanded===r.coverageKey;
    const statusBadge=r.status==="covered"?'<span class="kpi-good">ENOUGH</span>':r.status==="short"?'<span class="kpi-bad">SHORTAGE</span>':`<span class="kpi-bad">${esc(r.status)}</span>`;
    h+=`<tr class="cc-door-row" data-cc-key="${esc(r.coverageKey)}" style="cursor:pointer"><td><span class="dash-loss-chevron">${isOpen?"▾":"›"}</span> ${esc(r.model)}</td><td>${esc(r.door)}</td><td>${r.required.toLocaleString()}</td><td><b>${r.actual.toLocaleString()}</b></td><td class="${r.gap<0?"kpi-bad":"kpi-good"}">${r.gap>0?"+":""}${r.gap.toLocaleString()}</td><td class="${r.remaining>0?"kpi-bad":""}"><b>${r.remaining.toLocaleString()}</b></td><td>${r.coveragePct!==null?r.coveragePct.toFixed(1)+"%":"—"}</td><td>${statusBadge}</td></tr>`;
    if(isOpen){
      h+=`<tr><td colspan="8"><div class="dash-loss-record-list">`;
      r.contributions.forEach(c=>{
        h+=`<div class="dash-loss-record-row"><span>${esc(c.excelModel)}${c.excelCab?" ("+esc(c.excelCab)+")":""}</span><b>Plan ${c.qty} × ${c.qtyPerCabinet}</b><small>= ${Math.round(c.requiredQty).toLocaleString()} pcs</small></div>`;
      });
      h+=`</div></td></tr>`;
    }
  });
  h+="</tbody></table></div>";
  $("ccTableArea").innerHTML=h;
  $("ccTableArea").querySelectorAll(".cc-door-row").forEach(tr=>tr.onclick=()=>{
    const k=tr.dataset.ccKey;
    S.expanded=S.expanded===k?null:k;
    renderDoorTable(S.data);
  });
}

function renderCabinetTable(data){
  if(!data.cabinetRows.length){$("ccTableArea").innerHTML='<div class="empty-state">ยังไม่มี Cabinet Plan สำหรับวันนี้</div>';return}
  let h='<div class="table-scroll"><table class="grid"><thead><tr><th>Cabinet</th><th>Cab</th><th>Plan Qty</th><th>Door Readiness</th></tr></thead><tbody>';
  data.cabinetRows.forEach(r=>{
    let readiness;
    if(!r.mapped)readiness='<span class="kpi-bad">⚠ MAPPING REQUIRED</span>';
    else{
      const keys=r.coverageKeys.map(k=>data.doorRows.find(d=>d.coverageKey===k)).filter(Boolean);
      const allReady=keys.length&&keys.every(d=>d.status==="covered");
      readiness=allReady?'<span class="kpi-good">✓ READY</span>':'<span class="kpi-bad">⚠ NOT FULLY COVERED</span>';
    }
    h+=`<tr><td>${esc(r.excelModel)}</td><td>${esc(r.excelCab||"-")}</td><td>${r.qty}</td><td>${readiness}</td></tr>`;
  });
  h+="</tbody></table></div>";
  $("ccTableArea").innerHTML=h;
}

function renderUnmapped(data){
  const host=$("ccUnmappedSection");
  if(!data.unmapped.length){host.style.display="none";return}
  host.style.display="";
  let h='<div class="table-scroll"><table class="grid"><thead><tr><th>Excel Model</th><th>Cab</th><th>Plan Qty</th><th>Reason</th></tr></thead><tbody>';
  data.unmapped.forEach(u=>{
    h+=`<tr><td>${esc(u.excelModel)}</td><td>${esc(u.excelCab||"-")}</td><td>${u.qty}</td><td>${esc(u.reason)}</td></tr>`;
  });
  h+="</tbody></table></div>";
  $("ccUnmappedTable").innerHTML=h;
}

function render(){
  const data=S.data;
  if(!data)return;
  renderStatusBanner(data);
  renderKpis(data);
  $("ccTableTitle").textContent=S.view==="door"?"Door Coverage":"Cabinet Coverage";
  if(S.view==="door")renderDoorTable(data); else renderCabinetTable(data);
  renderUnmapped(data);
}

async function load(){
  const date=$("ccDate").value;
  if(!date){note("เลือก Production Date ก่อน","plan-warn");return}
  stat("Loading...");note("กำลังคำนวณ Coverage...");
  try{
    S.data=await computeCoverage(date);
    S.expanded=null;
    render();
    note(`Coverage loaded · ${date}`,"plan-ok");
    stat("Loaded","ok");
  }catch(e){console.error(e);note(e.message,"plan-warn");stat("Load failed","err")}
}

function init(){
  $("ccDate").value=localDate();
  $("ccDate").onchange=load;
  $("ccToggleDoor").onclick=()=>{S.view="door";$("ccToggleDoor").classList.add("primary");$("ccToggleCabinet").classList.remove("primary");render()};
  $("ccToggleCabinet").onclick=()=>{S.view="cabinet";$("ccToggleCabinet").classList.add("primary");$("ccToggleDoor").classList.remove("primary");render()};
  load();
}
addEventListener("DOMContentLoaded",init)})();
