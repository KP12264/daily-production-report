(()=>{const $=id=>document.getElementById(id);
let S={lines:[],plan:null,actual:{},modelOrder:[],docId:null,saveTimers:new Map()};
const val=x=>String(x??"").trim();
function localDate(d=new Date()){const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
function note(t,c=""){$("entryMessage").textContent=t;$("entryMessage").className="notice info-notice "+c}
function stat(t,c=""){$("entryStatus").textContent=t;$("entryStatus").className="hero-status "+c}
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
async function saveModelOrder(){
 if(!S.docId)return;
 try{await ProdV2DB.set("prodV2_actualLogs",S.docId,{modelOrder:[...S.modelOrder],updatedAt:firebase.firestore.FieldValue.serverTimestamp()},true);$("saveBadge").textContent="SAVED"}catch(e){console.error(e)}
}
function openModelOrder(){
 let ps=planKeys(),host=$("modelOrderList");if(!host)return;
 host.innerHTML=ps.map((p,i)=>{let k=`${p.model}|||${p.door}`;return `<div class="order-row"><span class="order-no">${i+1}</span><div class="order-name"><b>${esc(p.model)}</b><small>${esc(p.door||"-")}</small></div><button data-order-move="${esc(k)}" data-dir="-1">↑</button><button data-order-move="${esc(k)}" data-dir="1">↓</button></div>`}).join("");
 $("modelOrderModal").classList.add("open");
 host.querySelectorAll("[data-order-move]").forEach(b=>b.onclick=()=>{moveModel(b.dataset.orderMove,Number(b.dataset.dir));openModelOrder()})
}
function closeModelOrder(){$("modelOrderModal")?.classList.remove("open");render()}
function actualTotal(){return Object.values(S.actual).reduce((s,x)=>s+(Number(x)||0),0)}
function adjustedPlan(){return Number(S.plan?.adjustedPlan??S.plan?.totalPlan??0)}
function originalPlan(){return Number(S.plan?.originalPlan??S.plan?.totalPlan??0)}
function renderKpis(){
 let a=actualTotal(),adj=adjustedPlan(),orig=originalPlan(),gap=a-adj,ach=adj?100*a/adj:0,loss=Number(S.plan?.lossMinutes||0);
 $("entryKpis").innerHTML=`<div class="entry-kpi"><small>ORIGINAL PLAN</small><b>${orig.toLocaleString()}</b></div><div class="entry-kpi"><small>ADJUSTED PLAN</small><b>${adj.toLocaleString()}</b></div><div class="entry-kpi"><small>ACTUAL</small><b>${a.toLocaleString()}</b></div><div class="entry-kpi"><small>GAP vs ADJ.</small><b>${gap>0?"+":""}${gap.toLocaleString()}</b></div><div class="entry-kpi"><small>ACHIEVEMENT</small><b>${ach.toFixed(1)}%</b></div><div class="entry-kpi"><small>LOSS</small><b>${loss} min</b></div>`
}
function render(){
 if(!S.plan){$("entryTableArea").innerHTML='<div class="empty-state">ไม่พบ Daily Plan</div>';return}
 let ps=planKeys(),blocks=S.plan.blocks||[],h='<div class="production-matrix-viewport"><table class="grid actual-grid"><thead><tr><th class="model-col">Model / Door</th>';
 blocks.forEach(b=>h+=`<th>${esc(b.start)}–${esc(b.end)}<br><small>Plan ${Number(b.total||0)}</small></th>`);
 h+='<th class="sum-col sum-plan">Plan</th><th class="sum-col sum-actual">Actual</th><th class="sum-col sum-diff">Diff</th><th class="sum-col sum-ach">Ach.</th></tr></thead><tbody>';
 ps.forEach(p=>{
   let rowPlan=0,rowActual=0;let mk=`${p.model}|||${p.door}`;h+=`<tr><td class="model-col actual-sticky"><div class="model-cell-clean"><b>${esc(p.model)}</b><small>${esc(p.door||"-")}</small></div></td>`;
   blocks.forEach((b,bi)=>{
     let c=(b.cells||[]).find(x=>x.model===p.model&&x.door===p.door),pl=Number(c?.plan||0),k=key(bi,p.model,p.door),av=S.actual[k]??"";
     rowPlan+=pl;rowActual+=Number(av||0);
     let disabled=pl===0?"":"";
     h+=`<td class="actual-cell"><div class="cell-plan">P ${pl}</div><input class="actual-input" data-key="${esc(k)}" data-plan="${pl}" data-block-index="${bi}" data-row-index="${ps.indexOf(p)}" type="number" min="0" step="1" value="${esc(av)}" placeholder="0" ${disabled}></td>`
   });
   let diff=rowActual-rowPlan,ach=rowPlan?100*rowActual/rowPlan:0;
   h+=`<td class="sum-col sum-plan"><b>${rowPlan}</b></td><td class="sum-col sum-actual" data-rowactual="${esc(p.model+"|||"+p.door)}"><b>${rowActual}</b></td><td class="sum-col sum-diff">${diff>0?"+":""}${diff}</td><td class="sum-col sum-ach">${ach.toFixed(1)}%</td></tr>`
 });
 h+='</tbody></table></div>';$("entryTableArea").innerHTML=h;
 document.querySelectorAll(".actual-input").forEach((el,i,arr)=>{
   el.addEventListener("input",()=>{let n=el.value===""?"":Math.max(0,Math.floor(Number(el.value)||0));S.actual[el.dataset.key]=n;renderKpis();$("saveBadge").textContent="SAVING...";queueSave(el.dataset.key,n)});
   el.addEventListener("focus",()=>{document.querySelectorAll(".actual-grid tr.entry-active-row").forEach(r=>r.classList.remove("entry-active-row"));el.closest("tr")?.classList.add("entry-active-row")});el.addEventListener("blur",()=>el.closest("tr")?.classList.remove("entry-active-row"));el.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();let bi=Number(el.dataset.blockIndex),ri=Number(el.dataset.rowIndex),next=document.querySelector(`.actual-input[data-block-index="${bi}"][data-row-index="${ri+1}"]`);if(next){next.focus();next.select()}}})
 });
 renderKpis()
}
async function queueSave(k,v){
 clearTimeout(S.saveTimers.get(k));S.saveTimers.set(k,setTimeout(async()=>{
   try{
    let payload={date:$("entryDate").value,lineId:$("entryLine").value.toUpperCase(),shift:$("entryShift").value,planId:S.plan.id||`plan_${$("entryDate").value}_${$("entryLine").value.toUpperCase()}_${$("entryShift").value}`,actualByCell:{[k]:v},modelOrder:[...S.modelOrder],updatedAt:firebase.firestore.FieldValue.serverTimestamp(),version:1};
    await ProdV2DB.set("prodV2_actualLogs",S.docId,payload,true);$("saveBadge").textContent="SAVED";stat("Saved","ok");
   }catch(e){console.error(e);$("saveBadge").textContent="SAVE FAILED";stat("Save failed","err");note(e.message,"plan-warn")}
 },450))
}
async function load(){
 let d=$("entryDate").value,l=$("entryLine").value.toUpperCase(),sh=$("entryShift").value;ProdV2Context.set({date:d,lineId:l,shift:sh});let pid=`plan_${d}_${l}_${sh}`,aid=`actual_${d}_${l}_${sh}`;
 try{
  stat("Loading...");let [pd,ad]=await Promise.all([ProdV2DB.collection("prodV2_dailyPlans").doc(pid).get(),ProdV2DB.collection("prodV2_actualLogs").doc(aid).get()]);
  if(!pd.exists){S.plan=null;S.actual={};render();renderKpis();$("saveBadge").textContent="NO PLAN";note(`ไม่พบ Saved Daily Plan: ${d} · Line ${l} · ${sh} — ต้อง Save Daily Plan ก่อน`,"plan-warn");stat("Plan missing","err");return}
  S.plan={id:pd.id,...pd.data()};S.docId=aid;S.actual=ad.exists?(ad.data().actualByCell||{}):{};S.modelOrder=ad.exists?(ad.data().modelOrder||[]):[];
  render();$("saveBadge").textContent=ad.exists?"LOADED":"READY TO ENTER";note(`โหลด Saved Plan สำเร็จ · ${d} · Line ${l} · ${sh}`,"plan-ok");stat("Plan loaded","ok")
 }catch(e){console.error(e);note(e.message,"plan-warn");stat("Load failed","err")}
}
async function init(){
 $("entryDate").value=localDate();$("loadEntryBtn").onclick=load;$("openModelOrderBtn").onclick=()=>{if(!S.plan){note("Load Saved Plan ก่อนจัดลำดับ Model","plan-warn");return}openModelOrder()};$("closeModelOrderBtn").onclick=closeModelOrder;$("doneModelOrderBtn").onclick=closeModelOrder;
 try{S.lines=(await all("prodV2_lines")).filter(x=>x.active!==false).sort((a,b)=>(a.order||99)-(b.order||99));$("entryLine").innerHTML=S.lines.map(x=>`<option value="${x.lineId||x.code||x.id}">${esc(x.name||"Line "+(x.lineId||x.code||x.id))}</option>`).join("");ProdV2Context.bind($("entryDate"),$("entryLine"),$("entryShift"));stat("Ready","ok");let c=ProdV2Context.get();if(c.date&&c.lineId&&c.shift)load()}catch(e){note(e.message,"plan-warn");stat("Load failed","err")}
}
addEventListener("DOMContentLoaded",init)})();