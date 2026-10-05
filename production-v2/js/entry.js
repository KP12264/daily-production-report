(()=>{const $=id=>document.getElementById(id);
let S={lines:[],plan:null,actual:{},modelOrder:[],docId:null,saveTimer:null,saving:false,savePending:false};
const val=x=>String(x??"").trim();
function localDate(d=new Date()){const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
function note(t,c=""){$("entryMessage").textContent=t;$("entryMessage").className="notice info-notice "+c}
function stat(t,c=""){$("entryStatus").textContent=t;$("entryStatus").className="hero-status "+c;
 // header "Last Updated" — display only: time of the last successful load/save status
 if(c==="ok"){let lu=$("entryLastUpdated");if(lu){let d=new Date(),z=n=>String(n).padStart(2,"0");lu.textContent=`${z(d.getDate())} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]} ${d.getFullYear()} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`}}
}
async function all(n){const s=await ProdV2DB.collection(n).get();return s.docs.map(d=>({id:d.id,...d.data()}))}
function key(blockIndex,model,door){return `${blockIndex}|||${model}|||${door}`}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function planKeys(){
 let m=new Map;(S.plan?.blocks||[]).forEach(b=>(b.cells||[]).forEach(c=>m.set(`${c.model}|||${c.door}`,{model:c.model,door:c.door})));
 let base=[...m.values()].sort((a,b)=>(a.model+a.door).localeCompare(b.model+b.door));
 let keys=base.map(x=>`${x.model}|||${x.door}`);
 if(!S.modelOrder.length)S.modelOrder=[...keys];
 S.modelOrder=[...S.modelOrder.filter(k=>keys.includes(k)),...keys.filter(k=>!S.modelOrder.includes(k))];
 let by=new Map(base.map(x=>[`${x.model}|||${x.door}`,x]));
 return S.modelOrder.map(k=>by.get(k)).filter(Boolean)
}
function moveModel(key,dir){
 let a=[...S.modelOrder],i=a.indexOf(key),j=i+dir;if(i<0||j<0||j>=a.length)return;
 [a[i],a[j]]=[a[j],a[i]];S.modelOrder=a;render();saveModelOrder()
}
function setModelPosition(key,n){
 let a=[...S.modelOrder],i=a.indexOf(key),to=Math.max(0,Math.min(a.length-1,Number(n)-1));if(i<0||Number.isNaN(to))return;
 a.splice(i,1);a.splice(to,0,key);S.modelOrder=a;render();saveModelOrder()
}
function saveModelOrder(){
 if(!S.docId)return;
 scheduleSave();
 // Remember this order at the Line+Shift level too (separate from the
 // per-day actualLog save above) so a NEW date starts from whatever order
 // was last used, instead of resetting to alphabetical every time.
 let l=$("entryLine").value.toUpperCase(),sh=$("entryShift").value;
 if(l&&sh)ProdV2DB.set("prodV2_modelOrderPrefs",`pref_${l}_${sh}`,{lineId:l,shift:sh,order:[...S.modelOrder],updatedAt:Date.now()},{merge:true}).catch(()=>{});
}
function openModelOrder(){
 let ps=planKeys(),host=$("modelOrderList");if(!host)return;
 host.innerHTML=ps.map((p,i)=>{let k=`${p.model}|||${p.door}`;return `<div class="order-row"><span class="order-no">${i+1}</span><div class="order-name"><b>${esc(p.model)}</b><small>${esc(p.door||"-")}</small></div><button data-order-move="${esc(k)}" data-dir="-1">↑</button><button data-order-move="${esc(k)}" data-dir="1">↓</button></div>`}).join("");
 $("modelOrderModal").classList.add("open");
 host.querySelectorAll("[data-order-move]").forEach(b=>b.onclick=()=>{moveModel(b.dataset.orderMove,Number(b.dataset.dir));openModelOrder()})
}
function closeModelOrder(){$("modelOrderModal")?.classList.remove("open");render()}
function actualTotal(){
 // บวกเฉพาะ cell ที่ยังตรงกับแถวในตารางปัจจุบัน (Model/Door ที่มีอยู่ใน
 // S.plan.blocks[].cells จริง) — ไม่บวกรวม key เก่าที่ค้างมาจากก่อนเปลี่ยนชื่อ
 // Model ใน Master ซึ่งไม่มีแถวไหนแสดงมันอีกแล้ว แต่ยังฝังอยู่ใน S.actual
 let valid=new Set();
 (S.plan?.blocks||[]).forEach((b,bi)=>(b.cells||[]).forEach(c=>valid.add(key(bi,c.model,c.door))));
 return Object.entries(S.actual).reduce((s,[k,v])=>s+(valid.has(k)?(Number(v)||0):0),0);
}
function adjustedPlan(){return Number(S.plan?.adjustedPlan??S.plan?.totalPlan??0)}
function originalPlan(){return Number(S.plan?.originalPlan??S.plan?.totalPlan??0)}
function renderKpis(){
 let a=actualTotal(),adj=adjustedPlan(),orig=originalPlan(),gap=a-adj,ach=adj?100*a/adj:0,loss=Number(S.plan?.lossMinutes||0);
 let gc=gap<0?"is-neg":gap>0?"is-pos":"is-zero";
 $("entryKpis").innerHTML=`<div class="ev2-kpi ev2-k-orig"><small>Original Plan</small><b>${orig.toLocaleString()} <span class="u">pcs</span></b><em>แผนการผลิตทั้งหมด</em></div><div class="ev2-kpi ev2-k-adj"><small>Adjusted Plan</small><b>${adj.toLocaleString()} <span class="u">pcs</span></b><em>แผนที่ปรับแล้ว</em></div><div class="ev2-kpi ev2-k-act"><small>Actual</small><b>${a.toLocaleString()} <span class="u">pcs</span></b><em>ผลผลิตจริง</em></div><div class="ev2-kpi ev2-k-gap ${gc}"><small>Gap</small><b>${gap>0?"+":""}${gap.toLocaleString()} <span class="u">pcs</span></b><em>ต่างจากแผนที่ปรับแล้ว</em></div><div class="ev2-kpi ev2-k-ach"><small>Achievement</small><b>${ach.toFixed(1)}%</b><em>เทียบกับแผนที่ปรับแล้ว</em></div><div class="ev2-kpi ev2-k-loss"><small>Loss Time</small><b>${loss} <span class="u">min</span></b><em>เวลาสูญเสีย (จากแผน)</em></div>`;
 // display-only: refresh the TOTAL row and the Gap colours from the numbers already on screen
 updateTotalRow();paintGap();
}
// TOTAL row — sums of the row figures already displayed (no new formula source).
function updateTotalRow(){
 let tr=document.querySelector(".ev2-total-row");if(!tr)return;
 let plan=0,actual=0;
 document.querySelectorAll(".ev2-matrix tbody tr:not(.ev2-total-row)").forEach(r=>{plan+=Number(r.querySelector(".sum-plan")?.textContent)||0;actual+=Number(r.querySelector(".sum-actual")?.textContent)||0});
 let gap=actual-plan,ach=plan?100*actual/plan:0;
 tr.querySelector(".ev2-t-plan").textContent=plan.toLocaleString();
 tr.querySelector(".ev2-t-actual").textContent=actual.toLocaleString();
 tr.querySelector(".ev2-t-gap").textContent=`${gap>0?"+":""}${gap.toLocaleString()}`;
 tr.querySelector(".ev2-t-ach").textContent=`${ach.toFixed(1)}%`;
}
// Gap colour classes (red < 0, emerald > 0, neutral = 0) — class toggling only.
function paintGap(){
 document.querySelectorAll(".ev2-matrix td.sum-diff,.ev2-matrix td.ev2-t-gap").forEach(td=>{
  let n=parseFloat(String(td.textContent).replace(/,/g,""))||0;
  td.classList.toggle("is-neg",n<0);td.classList.toggle("is-pos",n>0);td.classList.toggle("is-zero",n===0);
 });
}
function rowPlanFor(model,door){
 let sum=0;(S.plan?.blocks||[]).forEach(b=>{let c=(b.cells||[]).find(x=>x.model===model&&x.door===door);sum+=Number(c?.plan||0)});
 return sum;
}
function rowActualFor(model,door){
 let sum=0;(S.plan?.blocks||[]).forEach((b,bi)=>{sum+=Number(S.actual[key(bi,model,door)]||0)});
 return sum;
}
function updateRowSummary(model,door){
 // Live-updates just this row's Plan/Actual/Diff/Ach cells on every keystroke,
 // instead of waiting for a full render() (which previously only happened again
 // on page reload / Load Saved Plan — hence the "ต้องไปหน้า Dashboard แล้วกลับมา" symptom).
 let mk=`${model}|||${door}`;
 let cell=[...document.querySelectorAll(".sum-actual")].find(c=>c.dataset.rowactual===mk);
 if(!cell)return;
 let rowPlan=rowPlanFor(model,door),rowActual=rowActualFor(model,door),diff=rowActual-rowPlan,ach=rowPlan?100*rowActual/rowPlan:0;
 cell.innerHTML=`<b>${rowActual}</b>`;
 let tr=cell.closest("tr");
 let diffCell=tr?.querySelector(".sum-diff"),achCell=tr?.querySelector(".sum-ach");
 if(diffCell)diffCell.textContent=`${diff>0?"+":""}${diff}`;
 if(achCell)achCell.textContent=`${ach.toFixed(1)}%`;
}
function isMobileView(){return window.matchMedia("(max-width:640px)").matches}
// Current Time Block highlight — same logic pattern as Dashboard's
// currentBlockIndex(), so "now" is interpreted identically everywhere in
// Production V2. Only ever active for today + a block whose window
// actually contains the current time; a Night shift crossing midnight is
// handled by unwrapping block times into a monotonic timeline first.
function mins(t){let [h,m]=String(t||"00:00").split(":").map(Number);return (h||0)*60+(m||0)}
function nowMinutes(){let d=new Date();return d.getHours()*60+d.getMinutes()}
function unwrapBlockTimes(bs){
 let out=[],prevEnd=null;
 bs.forEach(b=>{
  let s=mins(b.start),e=mins(b.end);
  if(prevEnd!=null){while(s<prevEnd)s+=1440;while(e<=s)e+=1440}
  out.push({startU:s,endU:e});prevEnd=e;
 });
 return out;
}
function currentBlockIndex(blocks,viewDate){
 if(viewDate!==localDate()||!blocks.length)return -1;
 let u=unwrapBlockTimes(blocks),now=nowMinutes();
 if(now<u[0].startU)now+=1440;
 for(let i=0;i<u.length;i++)if(now>=u[i].startU&&now<u[i].endU)return i;
 return -1;
}
function wireActualInput(el){
 el.addEventListener("input",()=>{let n=el.value===""?"":Math.max(0,Math.floor(Number(el.value)||0));S.actual[el.dataset.key]=n;let parts=el.dataset.key.split("|||");updateRowSummary(parts[1],parts[2]);renderKpis();$("saveBadge").textContent="SAVING...";scheduleSave()});
}
function render(){
 if(!S.plan){$("entryTableArea").innerHTML='<div class="empty-state">ไม่พบ Daily Plan</div>';return}
 let ps=planKeys(),blocks=S.plan.blocks||[];
 if(isMobileView())renderMobileMatrix(ps,blocks);else renderDesktopMatrix(ps,blocks);
 renderKpis()
}
function renderDesktopMatrix(ps,blocks){
 let curBi=currentBlockIndex(blocks,$("entryDate").value);
 // keep the matrix scroll position across re-renders (e.g. a model-order move)
 let oldVp=document.querySelector(".ev2-matrix-viewport"),keepL=oldVp?oldVp.scrollLeft:null,keepT=oldVp?oldVp.scrollTop:null;
 let gapCls=n=>n<0?"is-neg":n>0?"is-pos":"is-zero";
 let h='<div class="ev2-matrix-viewport"><table class="ev2-matrix"><thead><tr><th class="ev2-sk ev2-sk-no">#</th><th class="ev2-sk ev2-sk-model">Model</th><th class="ev2-sk ev2-sk-door">Door</th>';
 blocks.forEach((b,bi)=>h+=`<th data-bi="${bi}" class="ev2-blk${bi===curBi?" current-block-col":""}${b.type==="BREAK"?" is-break":""}">${esc(b.start)} – ${esc(b.end)}<small>${b.type==="BREAK"?"BREAK":"Plan (pcs)"}</small></th>`);
 h+='<th class="sum-col sum-plan ev2-sr ev2-sr-plan">Plan<br>Total</th><th class="sum-col sum-actual ev2-sr ev2-sr-actual">Actual<br>Total</th><th class="sum-col sum-diff ev2-sr ev2-sr-gap">Gap</th><th class="sum-col sum-ach ev2-sr ev2-sr-ach">Ach.<br>(%)</th></tr></thead><tbody>';
 ps.forEach((p,ri)=>{
   let rowPlan=0,rowActual=0;let mk=`${p.model}|||${p.door}`;h+=`<tr><td class="ev2-sk ev2-sk-no">${ri+1}</td><td class="ev2-sk ev2-sk-model"><b>${esc(p.model)}</b></td><td class="ev2-sk ev2-sk-door">${esc(p.door||"-")}</td>`;
   blocks.forEach((b,bi)=>{
     let c=(b.cells||[]).find(x=>x.model===p.model&&x.door===p.door),pl=Number(c?.plan||0),k=key(bi,p.model,p.door),av=S.actual[k]??"";
     rowPlan+=pl;rowActual+=Number(av||0);
     let disabled=pl===0?"":"";
     h+=`<td data-bi="${bi}" class="ev2-cell${bi===curBi?" current-block-col":""}${b.type==="BREAK"?" is-break":""}"><div class="ev2-plan">${b.type==="BREAK"?"BREAK":pl}</div><input class="actual-input" data-key="${esc(k)}" data-plan="${pl}" data-block-index="${bi}" data-row-index="${ps.indexOf(p)}" type="number" min="0" step="1" value="${esc(av)}" placeholder="0" ${disabled}></td>`
   });
   let diff=rowActual-rowPlan,ach=rowPlan?100*rowActual/rowPlan:0;
   h+=`<td class="sum-col sum-plan ev2-sr ev2-sr-plan"><b>${rowPlan}</b></td><td class="sum-col sum-actual ev2-sr ev2-sr-actual" data-rowactual="${esc(p.model+"|||"+p.door)}"><b>${rowActual}</b></td><td class="sum-col sum-diff ev2-sr ev2-sr-gap ${gapCls(diff)}">${diff>0?"+":""}${diff}</td><td class="sum-col sum-ach ev2-sr ev2-sr-ach">${ach.toFixed(1)}%</td></tr>`
 });
 // TOTAL row (display only): per-block Plan sums here; the right-hand totals are filled by updateTotalRow()
 h+='<tr class="ev2-total-row"><td class="ev2-sk-total" colspan="3">TOTAL (pcs)</td>';
 blocks.forEach((b,bi)=>{let t=0;ps.forEach(p=>{let c=(b.cells||[]).find(x=>x.model===p.model&&x.door===p.door);t+=Number(c?.plan||0)});h+=`<td data-bi="${bi}" class="ev2-tot-blk${bi===curBi?" current-block-col":""}${b.type==="BREAK"?" is-break":""}">${b.type==="BREAK"?"—":t}</td>`});
 h+='<td class="ev2-sr ev2-sr-plan ev2-t-plan">0</td><td class="ev2-sr ev2-sr-actual ev2-t-actual">0</td><td class="ev2-sr ev2-sr-gap ev2-t-gap">0</td><td class="ev2-sr ev2-sr-ach ev2-t-ach">0.0%</td></tr>';
 h+='</tbody></table></div>';$("entryTableArea").innerHTML=h;
 document.querySelectorAll(".actual-input").forEach(el=>{
   wireActualInput(el);
   el.addEventListener("focus",()=>{document.querySelectorAll(".ev2-matrix tr.entry-active-row").forEach(r=>r.classList.remove("entry-active-row"));el.closest("tr")?.classList.add("entry-active-row")});el.addEventListener("blur",()=>el.closest("tr")?.classList.remove("entry-active-row"));el.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();let bi=Number(el.dataset.blockIndex),ri=Number(el.dataset.rowIndex),next=document.querySelector(`.actual-input[data-block-index="${bi}"][data-row-index="${ri+1}"]`);if(next){next.focus();next.select()}}})
 });
 // B1: first render of a plan -> bring the existing current block into view (existing
 // currentBlockIndex only; if no block resolves, nothing moves). Later re-renders keep the scroll.
 let vp=document.querySelector(".ev2-matrix-viewport");
 if(vp){
  if(S.ev2ScrollDoc!==S.docId){
   S.ev2ScrollDoc=S.docId;
   let th=vp.querySelector("th.current-block-col");
   if(th){let sk=0;vp.querySelectorAll("thead th.ev2-sk").forEach(x=>sk+=x.offsetWidth);vp.scrollLeft=Math.max(0,th.offsetLeft-sk-8)}
  }else if(keepL!=null){vp.scrollLeft=keepL;vp.scrollTop=keepT}
 }
}
// Mobile: one Time Block at a time instead of a wide horizontal table — no
// horizontal scrolling, Model/Door always visible, big tap targets.
function renderMobileMatrix(ps,blocks){
 if(!blocks.length){$("entryTableArea").innerHTML='<div class="empty-state">ไม่มี Time Block</div>';return}
 // B4: on a newly loaded plan start at the existing current block; if none resolves keep the existing behaviour
 if(S.mobileBlock==null||S.ev2MobileDoc!==S.docId){S.ev2MobileDoc=S.docId;let c0=currentBlockIndex(blocks,$("entryDate").value);S.mobileBlock=c0>=0?c0:(S.mobileBlock==null?0:S.mobileBlock)}
 S.mobileBlock=Math.max(0,Math.min(blocks.length-1,S.mobileBlock));
 let bi=S.mobileBlock,b=blocks[bi];
 let curBi=currentBlockIndex(blocks,$("entryDate").value);
 let h=`<div class="mobile-entry"><div class="mobile-block-nav">
  <button id="mbPrev" ${bi===0?"disabled":""}>‹</button>
  <div class="mobile-block-label"><b>${esc(b.start)}–${esc(b.end)}</b><small>ช่วงที่ ${bi+1} / ${blocks.length} · ${b.type==="BREAK"?"BREAK":"Plan "+Number(b.total||0)}${bi===curBi?'<span class="current-block-tag"> · ตอนนี้</span>':""}</small></div>
  <button id="mbNext" ${bi===blocks.length-1?"disabled":""}>›</button>
 </div><div class="mobile-entry-rows">`;
 ps.forEach((p,ri)=>{
  let c=(b.cells||[]).find(x=>x.model===p.model&&x.door===p.door),pl=Number(c?.plan||0),k=key(bi,p.model,p.door),av=S.actual[k]??"";
  h+=`<div class="mobile-entry-row"><div class="mobile-entry-label"><b>${esc(p.model)}</b><small>${esc(p.door||"-")}</small></div><div class="mobile-entry-plan">${b.type==="BREAK"?"BREAK":"Plan "+pl}</div><input class="actual-input mobile-entry-input" data-key="${esc(k)}" data-plan="${pl}" data-block-index="${bi}" data-row-index="${ri}" type="number" min="0" step="1" value="${esc(av)}" placeholder="0"></div>`;
 });
 h+='</div></div>';
 $("entryTableArea").innerHTML=h;
 $("mbPrev").onclick=()=>{S.mobileBlock--;render()};
 $("mbNext").onclick=()=>{S.mobileBlock++;render()};
 document.querySelectorAll(".mobile-entry-input").forEach(el=>{
  wireActualInput(el);
  el.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();let ri=Number(el.dataset.rowIndex),next=document.querySelector(`.mobile-entry-input[data-row-index="${ri+1}"]`);if(next){next.focus();next.select()}else el.blur()}});
 });
}
function scheduleSave(){
 clearTimeout(S.saveTimer);
 S.saveTimer=setTimeout(doSave,450);
}
async function doSave(){
 if(!S.docId)return;
 if(S.saving){S.savePending=true;return} // a write is already in flight — mark that newer state must be saved next, don't fire a second write now
 S.saving=true;
 try{
  let payload={date:$("entryDate").value,lineId:$("entryLine").value.toUpperCase(),shift:$("entryShift").value,planId:S.plan.id||`plan_${$("entryDate").value}_${$("entryLine").value.toUpperCase()}_${$("entryShift").value}`,actualByCell:{...S.actual},modelOrder:[...S.modelOrder],updatedAt:firebase.firestore.FieldValue.serverTimestamp(),version:1};
  await ProdV2DB.set("prodV2_actualLogs",S.docId,payload,true);$("saveBadge").textContent="SAVED";stat("Saved","ok");
 }catch(e){console.error(e);$("saveBadge").textContent="SAVE FAILED";stat("Save failed","err");note((window.ProdV2Auth?ProdV2Auth.friendlyError(e):e.message),"plan-warn")}
 finally{
  S.saving=false;
  if(S.savePending){S.savePending=false;await doSave()} // state changed while we were saving — save the latest full map now
 }
}
async function load(){
 let d=$("entryDate").value,l=$("entryLine").value.toUpperCase(),sh=$("entryShift").value;ProdV2Context.set({date:d,lineId:l,shift:sh});let pid=`plan_${d}_${l}_${sh}`,aid=`actual_${d}_${l}_${sh}`;
 try{
  stat("Loading...");let [pd,ad]=await Promise.all([ProdV2DB.collection("prodV2_dailyPlans").doc(pid).get(),ProdV2DB.collection("prodV2_actualLogs").doc(aid).get()]);
  if(!pd.exists){S.plan=null;S.actual={};render();renderKpis();$("saveBadge").textContent="NO PLAN";note(`ไม่พบ Saved Daily Plan: ${d} · Line ${l} · ${sh} — ต้อง Save Daily Plan ก่อน`,"plan-warn");stat("Plan missing","err");return}
  S.plan={id:pd.id,...pd.data()};S.docId=aid;S.actual=ad.exists?(ad.data().actualByCell||{}):{};
  let dayOrder=ad.exists?(ad.data().modelOrder||[]):[];
  if(dayOrder.length){
   S.modelOrder=dayOrder;
  }else{
   // No order saved for this specific day yet — reuse whatever order was
   // last used for this Line+Shift, so people don't have to re-sort from
   // scratch every single day.
   try{let pref=await ProdV2DB.collection("prodV2_modelOrderPrefs").doc(`pref_${l}_${sh}`).get();S.modelOrder=pref.exists?(pref.data().order||[]):[];}
   catch(e){S.modelOrder=[];}
  }
  render();$("saveBadge").textContent=ad.exists?"LOADED":"READY TO ENTER";note(`โหลด Saved Plan สำเร็จ · ${d} · Line ${l} · ${sh}`,"plan-ok");stat("Plan loaded","ok")
 }catch(e){console.error(e);note(e.message,"plan-warn");stat("Load failed","err")}
}
async function init(){
 $("entryDate").value=localDate();$("loadEntryBtn").onclick=load;$("openModelOrderBtn").onclick=()=>{if(!S.plan){note("Load Saved Plan ก่อนจัดลำดับ Model","plan-warn");return}openModelOrder()};$("closeModelOrderBtn").onclick=closeModelOrder;$("doneModelOrderBtn").onclick=closeModelOrder;
 try{S.lines=(await all("prodV2_lines")).filter(x=>x.active!==false).sort((a,b)=>(a.order||99)-(b.order||99));$("entryLine").innerHTML=S.lines.map(x=>`<option value="${x.lineId||x.code||x.id}">${esc(x.lineName||x.name||"Line "+(x.lineId||x.code||x.id))}</option>`).join("");ProdV2Context.bind($("entryDate"),$("entryLine"),$("entryShift"));
  // เปลี่ยน Date/Line/Shift แล้วโหลด Plan+Actual ของกะนั้นใหม่ทันที — เดิมต้องกด
  // "Load Saved Plan" เองทุกครั้ง ไม่งั้นตารางจะค้างข้อมูลของกะก่อนหน้าไว้
  // ทั้งที่ dropdown เปลี่ยนไปแล้ว (ดูเหมือนกะ Day/Night ข้อมูลสลับกัน)
  $("entryDate").onchange=load;$("entryLine").onchange=load;$("entryShift").onchange=load;
  stat("Ready","ok");let c=ProdV2Context.get();if(c.date&&c.lineId&&c.shift)load()}catch(e){note(e.message,"plan-warn");stat("Load failed","err")}
}
// ---- Presentation-only additions (no load / save / calculation logic) ----
// B2: keep the existing current-block highlight in step with the clock. Class toggling only, using the
//     existing currentBlockIndex(); never re-renders, so a focused input is never disturbed.
function refreshCurrentBlock(){
 if(!S.plan||isMobileView())return;
 let cur=currentBlockIndex(S.plan.blocks||[],$("entryDate").value);
 document.querySelectorAll(".ev2-matrix [data-bi]").forEach(el=>el.classList.toggle("current-block-col",Number(el.dataset.bi)===cur));
}
// B5: visual state of the save badge. Text is set by the existing code; this only maps it to a colour state.
function badgeState(t){t=String(t||"");return /FAILED/.test(t)?"failed":/SAVING/.test(t)?"saving":/^SAVED/.test(t)?"saved":/NO PLAN/.test(t)?"noplan":/LOADED|READY/.test(t)?"ready":"idle"}
function setBadge(text,state){let b=$("saveBadge");if(!b)return;if(text!=null&&b.textContent!==text)b.textContent=text;b.dataset.state=state||badgeState(b.textContent)}
function initPresentation(){
 let b=$("saveBadge");
 if(b){setBadge(null);new MutationObserver(()=>setBadge(null)).observe(b,{childList:true,characterData:true,subtree:true})}
 setInterval(refreshCurrentBlock,30000);
 document.addEventListener("visibilitychange",()=>{if(!document.hidden)refreshCurrentBlock()});
 // B3: re-render when crossing the mobile breakpoint (desktop matrix <-> mobile carousel)
 let mq=window.matchMedia("(max-width:640px)");
 let onMq=()=>{if(S.plan)render()};
 if(mq.addEventListener)mq.addEventListener("change",onMq);else if(mq.addListener)mq.addListener(onMq);
}
addEventListener("DOMContentLoaded",initPresentation);
addEventListener("DOMContentLoaded",init)})();
