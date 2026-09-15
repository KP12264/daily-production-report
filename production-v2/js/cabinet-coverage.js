(()=>{const $=id=>document.getElementById(id);
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function localDate(d=new Date()){const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
function achClass(z){return z===null?"":z>=100?"kpi-good":z>=95?"kpi-watch":"kpi-bad"}
function stat(t,c=""){$("ccStatus").textContent=t;$("ccStatus").className="hero-status "+c}
function note(t,c=""){$("ccMessage").textContent=t;$("ccMessage").className="notice info-notice "+c}

let S={view:"door",data:null,expanded:null};

async function computeCoverage(date){
  // 1) Raw Cabinet Plan for this date — mapping-independent source
  const planDoc=await ProdV2DB.collection("prodV2_cabinetPlan").doc(`cabinetplan_${date}`).get();
  const rows=planDoc.exists?(planDoc.data().rows||[]):[];

  // 2) Live Mapping Master — re-evaluated every time, never trusts any
  //    import-time snapshot, so editing Mapping later needs no re-import
  const mapSnap=await ProdV2DB.collection("prodV2_doorMapping").get();
  const mappings=mapSnap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>m.active!==false);

  // 3) Union resolver ground truth: active prodV2_jigLayouts (current
  //    production-key source — what Entry/Plan actually write into
  //    actualByCell) UNION active prodV2_models (secondary/metadata).
  //    Read-only against both — neither is written to anywhere in this file.
  const [modelSnap,jigSnap]=await Promise.all([
    ProdV2DB.collection("prodV2_models").get(),
    ProdV2DB.collection("prodV2_jigLayouts").get()
  ]);
  const activeModels=modelSnap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>m.active!==false);
  const jigDocs=jigSnap.docs.map(d=>({id:d.id,...d.data()})).filter(j=>j.active!==false);
  const jigFlat=[];
  jigDocs.forEach(j=>{
    const arr=j.positions||j.composition||j.items||[];
    (Array.isArray(arr)?arr:[]).forEach(q=>{
      const model=String(q.model||q.modelName||q.name||'').trim();
      const door=String(q.door||q.doorType||q.doorCode||q.position||q.positionCode||q.slot||'').trim();
      if(model)jigFlat.push({lineId:j.lineId,model,door});
    });
  });
  function resolveLine(actualModel,actualDoor){
    const modelMatches=activeModels.filter(m=>m.modelName===actualModel&&m.doorCode===actualDoor);
    const jigMatches=jigFlat.filter(j=>j.model===actualModel&&j.door===actualDoor);
    const lineIds=new Set([...modelMatches.map(m=>m.lineId),...jigMatches.map(j=>j.lineId)]);
    if(lineIds.size===0)return {status:"UNRESOLVED ACTUAL TARGET",lineId:null};
    if(lineIds.size>1)return {status:"AMBIGUOUS ACTUAL TARGET",lineId:null};
    return {status:"ok",lineId:[...lineIds][0]};
  }

  // 4) Cabinet Plan row → Mapping lookup → effectiveKey aggregation.
  //    effectiveKey = canonicalCoverageKey || actualModel|||actualDoor —
  //    this single rule is what makes legacy mapping docs (no canonical
  //    key at all) keep working identically to before, unchanged.
  const requirementByKey={};
  const contributionsByKey={};
  const keyMeta={}; // effectiveKey -> {pairs:Set("model|||door"), legacyAlias:{current,legacy}|null, displayModel, displayDoor}
  const cabinetRows=[];
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
      const effectiveKey=p.canonicalCoverageKey||(p.actualModel+"|||"+p.actualDoor);
      const requiredQty=Number(row.qty||0)*Number(p.qtyPerCabinet||1);
      requirementByKey[effectiveKey]=(requirementByKey[effectiveKey]||0)+requiredQty;
      (contributionsByKey[effectiveKey]??=[]).push({excelModel:row.excelModel,excelCab:row.excelCab,qty:row.qty,qtyPerCabinet:p.qtyPerCabinet,requiredQty,door:p.door});
      keys.push(effectiveKey);

      if(!keyMeta[effectiveKey])keyMeta[effectiveKey]={
        pairs:new Set(), legacyAlias:null,
        displayModel: p.legacyAlias?p.actualModel:(p.canonicalCoverageKey||p.actualModel),
        displayDoor: p.legacyAlias?p.actualDoor:p.door
      };
      // SUM-style pair collection (TM545 Common F uses this — one pair per
      // contributing position, deduplicated by the Set so re-seeding or two
      // positions declaring the identical pair never double counts)
      if(p.actualSources&&p.actualSources.length)p.actualSources.forEach(s=>keyMeta[effectiveKey].pairs.add(s.actualModel+"|||"+s.actualDoor));
      else keyMeta[effectiveKey].pairs.add(p.actualModel+"|||"+p.actualDoor);
      // ALIAS/FALLBACK mechanism (TM10/12 uses this) — deliberately kept
      // separate from the SUM path above, never blended per instruction
      if(p.legacyAlias)keyMeta[effectiveKey].legacyAlias={current:{model:p.actualModel,door:p.actualDoor},legacy:{model:p.legacyAlias.actualModel,door:p.legacyAlias.actualDoor}};
    });
    cabinetRows.push({...row,mapped:true,coverageKeys:keys});
  });

  // 5) Resolve every effectiveKey. Alias keys only require the CURRENT pair
  //    to resolve (blocking) — the legacy pair failing to resolve in
  //    current Jig/Master is expected (it's legacy) and never blocks.
  //    Pair-set keys require EVERY pair to resolve (first failure reported).
  const resolverIssues={};
  const keyLineInfo={};
  Object.entries(keyMeta).forEach(([key,meta])=>{
    if(meta.legacyAlias){
      const cur=meta.legacyAlias.current;
      const r=resolveLine(cur.model,cur.door);
      if(r.status!=="ok"){resolverIssues[key]={model:cur.model,door:cur.door,status:r.status};return}
      const legR=resolveLine(meta.legacyAlias.legacy.model,meta.legacyAlias.legacy.door); // non-blocking
      keyLineInfo[key]={currentLine:r.lineId,legacyLine:legR.status==="ok"?legR.lineId:null};
    }else{
      const pairLines=new Map();
      for(const pairStr of meta.pairs){
        const [m,d]=pairStr.split("|||");
        const r=resolveLine(m,d);
        if(r.status!=="ok"){resolverIssues[key]={model:m,door:d,status:r.status};pairLines.clear();break}
        pairLines.set(pairStr,r.lineId);
      }
      if(pairLines.size)keyLineInfo[key]={pairLines};
      else if(!resolverIssues[key])resolverIssues[key]={model:meta.displayModel,door:meta.displayDoor,status:"UNRESOLVED ACTUAL TARGET"};
    }
  });

  // 6) Actual — read-only, existing prodV2_actualLogs, DAY+NIGHT for this
  //    Production Date exactly as already stored (no new midnight logic).
  //    Cells kept blockIndex-aware (not pre-summed) so the alias fallback
  //    can compare current-vs-legacy at the correct per-block granularity.
  const neededLines=new Set();
  Object.values(keyLineInfo).forEach(info=>{
    if(info.currentLine)neededLines.add(info.currentLine);
    if(info.legacyLine)neededLines.add(info.legacyLine);
    if(info.pairLines)info.pairLines.forEach(l=>neededLines.add(l));
  });
  const rawCellsByLine={};
  await Promise.all([...neededLines].map(async lineId=>{
    rawCellsByLine[lineId]=[];
    await Promise.all(["DAY","NIGHT"].map(async shift=>{
      const doc=await ProdV2DB.collection("prodV2_actualLogs").doc(`actual_${date}_${lineId}_${shift}`).get();
      if(!doc.exists)return;
      const cells=doc.data().actualByCell||{};
      Object.entries(cells).forEach(([cellKey,v])=>{
        const parts=cellKey.split("|||"); // blockIndex|||model|||door
        rawCellsByLine[lineId].push({blockIndex:Number(parts[0]),model:parts[1],door:parts[2],qty:Number(v||0)});
      });
    }));
  }));

  const actualByKey={};
  Object.entries(keyLineInfo).forEach(([key,info])=>{
    let total=0;
    if(info.pairLines){
      // SUM every distinct {model,door} pair contributing to this key —
      // each pair counted exactly once (Set-deduped above), so no risk of
      // double counting between pairs sharing a key.
      info.pairLines.forEach((lineId,pairStr)=>{
        const [m,d]=pairStr.split("|||");
        total+=(rawCellsByLine[lineId]||[]).filter(c=>c.model===m&&c.door===d).reduce((s,c)=>s+c.qty,0);
      });
    }else{
      // ALIAS fallback — per blockIndex: current wins if present for that
      // exact block, legacy used only when current is absent for that
      // block. Never both counted for the same block.
      const meta=keyMeta[key];
      const curCells=(rawCellsByLine[info.currentLine]||[]).filter(c=>c.model===meta.legacyAlias.current.model&&c.door===meta.legacyAlias.current.door);
      const legCells=info.legacyLine?(rawCellsByLine[info.legacyLine]||[]).filter(c=>c.model===meta.legacyAlias.legacy.model&&c.door===meta.legacyAlias.legacy.door):[];
      const blockIndices=new Set([...curCells.map(c=>c.blockIndex),...legCells.map(c=>c.blockIndex)]);
      blockIndices.forEach(bi=>{
        const cur=curCells.find(c=>c.blockIndex===bi);
        if(cur&&cur.qty){total+=cur.qty;return}
        const leg=legCells.find(c=>c.blockIndex===bi);
        if(leg)total+=leg.qty;
      });
    }
    actualByKey[key]=total;
  });

  // 7) Final per-key figures — ONE rounding point (Required), Gap/
  //    Remaining/Coverage all derive from that same rounded value
  const doorRows=Object.keys(requirementByKey).map(k=>{
    const requiredRounded=Math.round(requirementByKey[k]);
    const actual=Math.round(actualByKey[k]||0);
    const gap=actual-requiredRounded;
    const remaining=Math.max(requiredRounded-actual,0);
    const coveragePct=requiredRounded>0?(actual/requiredRounded*100):null;
    const meta=keyMeta[k];
    const issue=resolverIssues[k];
    return {
      coverageKey:k, model:meta.displayModel, door:meta.displayDoor,
      isCommonBucket: !!(meta.pairs.size>1||meta.legacyAlias),
      required:requiredRounded, actual, gap, remaining, coveragePct,
      status: issue?issue.status:(actual>=requiredRounded?"covered":"short"),
      contributions: contributionsByKey[k]||[]
    };
  }).sort((a,b)=>b.remaining-a.remaining);

  const resolverIssuesList=Object.entries(resolverIssues).map(([coverageKey,v])=>({coverageKey,...v}));
  const totalRequired=doorRows.reduce((s,r)=>s+r.required,0);
  const totalActual=doorRows.reduce((s,r)=>s+r.actual,0);
  const totalRemaining=doorRows.reduce((s,r)=>s+r.remaining,0);
  const totalCabinetPlan=rows.reduce((s,r)=>s+Number(r.qty||0),0);

  return {date,rows,doorRows,cabinetRows,unmapped,resolverIssues:resolverIssuesList,totalRequired,totalActual,totalRemaining,totalCabinetPlan};
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
