(()=>{const $=id=>document.getElementById(id);let S={lines:[],shift:null,pallets:[],active:new Set(),baseActive:new Set(),events:[],losses:[],palletOrder:[],matrix:[],loaded:false};
const val=x=>String(x??"").trim(), lineOf=x=>val(x.lineId||x.line||x.lineCode).toUpperCase(), shiftOf=x=>val(x.shift).toUpperCase();
function stat(t,c=""){$("planStatus").textContent=t;$("planStatus").className="hero-status "+c}
function note(t,c=""){$("planMessage").textContent=t;$("planMessage").className="notice info-notice "+c}
async function all(n){const s=await ProdV2DB.collection(n).get();return s.docs.map(d=>({id:d.id,...d.data()}))}
function localDate(d=new Date()){const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
function prevDate(s){let d=new Date(s+"T12:00:00");d.setDate(d.getDate()-1);return localDate(d)}
function posOf(p){let a=p.positions||p.composition||p.items||[];return Array.isArray(a)?a.map(q=>({model:val(q.model||q.modelName||q.name||"Unknown"),door:val(q.door||q.doorType||q.doorCode||q.position||q.positionCode||q.slot||""),qty:Number(q.qty||q.quantity||q.count||1)})).filter(q=>q.qty>0):[]}
function posMap(){let m=new Map;S.pallets.forEach(p=>{if(!S.active.has(p.id))return;posOf(p).forEach(q=>{let k=q.model+"|||"+q.door,o=m.get(k)||{model:q.model,door:q.door,qty:0};o.qty+=q.qty;m.set(k,o)})});return [...m.values()].sort((a,b)=>(a.model+a.door).localeCompare(b.model+b.door))}
function mins(t){let [h,m]=String(t).split(":").map(Number);return h*60+m}
function roundBoundary(block,t){
  let cycle=Number(block.cycle||S.shift?.standardCycleMinPerRound||10),start=mins(block.start),x=mins(t);
  if(x<=start)return block.start;
  let effective=start+Math.ceil((x-start)/cycle)*cycle;
  let hh=Math.floor(effective/60)%24,mm=effective%60;
  return `${String(hh).padStart(2,"0")}:${String(mm).padStart(2,"0")}`;
}
function slotStateAt(time){
  let order=[...(S.palletOrder||S.pallets.map(p=>p.id))];
  let slots=order.map((physicalId,i)=>({position:i+1,physicalId,compositionSourceId:physicalId,active:S.baseActive.has(physicalId)}));
  (S.events||[]).filter(e=>e.effectiveFrom<=time).sort((x,y)=>x.effectiveFrom.localeCompare(y.effectiveFrom)).forEach(e=>{
    let slot=slots.find(s=>s.physicalId===e.palletId);
    if(!slot)return;
    if(e.action==="REMOVE")slot.active=false;
    else if(e.action==="ADD")slot.active=true;
    else if(e.action==="REPLACE"){slot.active=true;slot.compositionSourceId=e.replacementPalletId||slot.compositionSourceId}
  });
  return slots
}
function mapForSlots(slots){
  let m=new Map;
  slots.filter(s=>s.active).forEach(s=>{
    let p=S.pallets.find(x=>x.id===s.compositionSourceId);if(!p)return;
    posOf(p).forEach(q=>{let k=q.model+"|||"+q.door,o=m.get(k)||{model:q.model,door:q.door,qty:0};o.qty+=q.qty;m.set(k,o)})
  });
  return [...m.values()].sort((a,b)=>(a.model+a.door).localeCompare(b.model+b.door))
}
function mapForSet(set){return mapForSlots((S.palletOrder||S.pallets.map(p=>p.id)).map((id,i)=>({position:i+1,physicalId:id,compositionSourceId:id,active:set.has(id)})))}
function addMinutes24(t,n){let x=(mins(t)+Number(n||0))%1440;return `${String(Math.floor(x/60)).padStart(2,"0")}:${String(x%60).padStart(2,"0")}`}
function lossAtInterval(st,en){
  let sm=mins(st),em=mins(en);if(em<sm)em+=1440;
  return (S.losses||[]).reduce((sum,l)=>{let a=mins(l.start),b=mins(l.end);if(b<a)b+=1440;if(a<sm)a+=1440;if(b<=sm||a>=em)return sum;return sum+Math.max(0,Math.min(em,b)-Math.max(sm,a))},0)
}
function splitBlocks(){
  let blocks=(S.shift?.blocks||[]).filter(b=>val(b.type).toUpperCase()==="WORK"),out=[];
  blocks.forEach(b=>{
    let cuts=[b.start,b.end];
    (S.events||[]).forEach(e=>{[e.actualTime,e.effectiveFrom].forEach(t=>{if(t&&t>b.start&&t<b.end)cuts.push(t)})});
    (S.losses||[]).forEach(l=>{[l.start,l.end].forEach(t=>{if(t&&t>b.start&&t<b.end)cuts.push(t)})});
    cuts=[...new Set(cuts)].sort();let cycle=Number(b.cycle||S.shift?.standardCycleMinPerRound||10);
    for(let i=0;i<cuts.length-1;i++){
      let st=cuts[i],en=cuts[i+1],duration=mins(en)-mins(st);if(duration<0)duration+=1440;
      let lossMinutes=lossAtInterval(st,en),productiveMinutes=Math.max(0,duration-lossMinutes);
      out.push({start:st,end:en,minutes:duration,cycle,scheduledRounds:Math.floor(duration/cycle),lossMinutes,productiveMinutes,rounds:Math.floor(productiveMinutes/cycle)})
    }
  });return out
}
function build(){
  let blocks=splitBlocks(),allKeys=new Map;
  blocks.forEach(b=>mapForSlots(slotStateAt(b.start)).forEach(p=>allKeys.set(p.model+"|||"+p.door,{model:p.model,door:p.door})));
  let cols=[...allKeys.values()].sort((a,b)=>(a.model+a.door).localeCompare(b.model+b.door));
  S.matrix=blocks.map(b=>{
    let slots=slotStateAt(b.start),pm=new Map(mapForSlots(slots).map(p=>[p.model+"|||"+p.door,p]));
    let cells=cols.map(c=>{let p=pm.get(c.model+"|||"+c.door),qty=p?.qty||0;return{...c,qty,originalPlan:b.scheduledRounds*qty,plan:b.rounds*qty}});
    return{start:b.start,end:b.end,minutes:b.minutes,scheduledRounds:b.scheduledRounds,lossMinutes:b.lossMinutes,productiveMinutes:b.productiveMinutes,rounds:b.rounds,activePositions:slots.filter(s=>s.active).length,slotSnapshot:slots,cells,originalTotal:cells.reduce((s,c)=>s+c.originalPlan,0),total:cells.reduce((s,c)=>s+c.plan,0)}
  })
}
function normalize24h(v){
  let s=String(v||"").trim().replace(".",":");
  if(/^\d{3,4}$/.test(s))s=s.padStart(4,"0").slice(0,2)+":"+s.padStart(4,"0").slice(2);
  let m=s.match(/^(\d{1,2}):(\d{2})$/);
  if(!m)return null;
  let h=Number(m[1]),mi=Number(m[2]);
  if(h<0||h>23||mi<0||mi>59)return null;
  return String(h).padStart(2,"0")+":"+String(mi).padStart(2,"0");
}
function events(){
  let host=document.getElementById("changeArea");if(!host)return;
  if(!S.loaded||!(S.shift?.blocks||[]).some(b=>val(b.type).toUpperCase()==="WORK")){host.innerHTML='<div class="empty-state compact-empty">Load Master ที่มี WORK Time Block ก่อน</div>';return}
  let work=(S.shift.blocks||[]).filter(b=>val(b.type).toUpperCase()==="WORK");
  let palletLabel=p=>`${p.palletName||p.palletCode||p.palletNo||p.name||p.id} — ${posOf(p).map(q=>`${q.model} ${q.door||""}`).join(" + ")}`;
  let opts=orderedPallets().map((p,i)=>`<option value="${p.id}">Position ${i+1} · ${palletLabel(p)}</option>`).join("");
  host.innerHTML=`<div class="change-controls change-controls-v3">
    <div><small>FROM POSITION / PALLET</small><select id="chgPallet">${opts}</select></div>
    <div><small>ACTION</small><select id="chgAction"><option value="REPLACE">Replace Pallet</option><option value="REMOVE">Remove Only</option><option value="ADD">Add Only</option></select></div>
    <div id="replacementWrap"><small>NEW COMPOSITION</small><select id="chgReplacement">${opts}</select></div>
    <div><small>ACTUAL CHANGE TIME (24H)</small><input id="chgTime" type="text" inputmode="numeric" maxlength="5" placeholder="14:20" autocomplete="off"></div><div><small>CHANGE / LOSS TIME (MIN)</small><input id="chgLossMin" type="number" min="0" step="1" value="10"></div>
    <div class="apply-wrap"><button id="addChangeBtn" class="primary">Apply Change</button></div>
  </div>
  <div class="change-help">ใส่เวลาที่เครื่องเริ่มหยุดและ Loss Time • ระบบจะให้ Composition ใหม่เริ่มหลัง Loss และที่รอบถัดไป</div>
  <div class="change-list">${S.events.length?S.events.map((e,i)=>{
    let from=S.pallets.find(p=>p.id===e.palletId),to=S.pallets.find(p=>p.id===e.replacementPalletId);
    let text=e.action==="REPLACE"?`POSITION ${((S.palletOrder||[]).indexOf(e.palletId)+1)||'-'} · ${from?palletLabel(from):e.palletLabel} → ${to?palletLabel(to):e.replacementPalletLabel}`:`${e.action} · ${from?palletLabel(from):e.palletLabel}`;
    let timing=e.actualTime!==e.effectiveFrom?`${e.actualTime} → effective ${e.effectiveFrom}`:e.effectiveFrom;if(e.lossMinutes)timing+=` · Loss ${e.lossMinutes} min`;
    return `<div class="change-item change-item-v2"><b>${timing}</b><span>${text}</span><button data-del="${i}">×</button></div>`
  }).join(""):'<span class="change-empty">ยังไม่มีการเปลี่ยน Pallet กลางกะ</span>'}</div>`;
  let actionEl=document.getElementById("chgAction"),rw=document.getElementById("replacementWrap"),timeEl=document.getElementById("chgTime");
  timeEl.value=work[0]?.start||"08:00";timeEl.onblur=()=>{let t=normalize24h(timeEl.value);if(t)timeEl.value=t};
  function sync(){rw.style.display=actionEl.value==="REPLACE"?"block":"none"} actionEl.onchange=sync;sync();
  document.getElementById("addChangeBtn").onclick=()=>{
    let pid=document.getElementById("chgPallet").value,action=actionEl.value,actual=normalize24h(timeEl.value),rid=document.getElementById("chgReplacement").value,lossMin=Math.max(0,Number(document.getElementById("chgLossMin")?.value||0));
    let p=S.pallets.find(x=>x.id===pid),rp=S.pallets.find(x=>x.id===rid);
    if(!actual){note("กรุณาใส่เวลาแบบ 24 ชั่วโมง เช่น 14:20","plan-warn");return} timeEl.value=actual;
    if(action==="REPLACE"&&pid===rid){note("Pallet เดิมและ Pallet ที่นำมาแทนต้องไม่ใช่ตัวเดียวกัน","plan-warn");return}
    let block=work.find(b=>actual>=b.start&&actual<b.end);
    if(!block){note("เวลาที่เลือกไม่ได้อยู่ใน WORK Time Block","plan-warn");return}
    let lossEnd=addMinutes24(actual,lossMin);let effective=roundBoundary(block,lossEnd);
    if(effective>=block.end && effective!==block.end){note("ไม่สามารถหา Effective Round ในช่วงนี้ได้","plan-warn");return}
    S.events.push({palletId:pid,palletLabel:p?.palletName||p?.palletCode||p?.palletNo||p?.name||pid,action,actualTime:actual,effectiveFrom:effective,lossMinutes:lossMin,lossEnd,replacementPalletId:action==="REPLACE"?rid:null,replacementPalletLabel:action==="REPLACE"?(rp?.palletName||rp?.palletCode||rp?.palletNo||rp?.name||rid):null});if(lossMin>0)S.losses.push({type:"PALLET_CHANGE",category:"Pallet Change",start:actual,end:lossEnd,minutes:lossMin,palletId:pid,source:"DAILY_PLAN"});
    build();table();kpis();events();$("snapshotBadge").textContent="NOT SAVED";
    let suffix=actual===effective?`ตั้งแต่ ${effective}`:`เวลาเปลี่ยนจริง ${actual} • มีผลรอบถัดไป ${effective}`;
    note(action==="REPLACE"?`เปลี่ยน Pallet ${p?.palletName||p?.palletCode||p?.name||pid} → ${rp?.palletName||rp?.palletCode||rp?.name||rid} • ${suffix}`:`${action==="REMOVE"?"ถอด":"เพิ่ม"} Pallet ${p?.palletName||p?.palletCode||p?.name||pid} • ${suffix}`,"plan-ok")
  };
  host.querySelectorAll("[data-del]").forEach(x=>x.onclick=()=>{let e=S.events[Number(x.dataset.del)];S.losses=S.losses.filter(l=>!(l.source==="DAILY_PLAN"&&l.palletId===e?.palletId&&l.start===e?.actualTime));S.events.splice(Number(x.dataset.del),1);build();table();kpis();events();$("snapshotBadge").textContent="NOT SAVED"})
}
function orderedPallets(){let r=new Map((S.palletOrder||[]).map((id,i)=>[id,i]));return [...S.pallets].sort((a,b)=>(r.get(a.id)??9999)-(r.get(b.id)??9999))}
function movePallet(id,dir){let a=[...S.palletOrder],i=a.indexOf(id),j=i+dir;if(i<0||j<0||j>=a.length)return;[a[i],a[j]]=[a[j],a[i]];S.palletOrder=a;pallets();$("snapshotBadge").textContent="NOT SAVED"}
function setPalletPosition(id,n){let a=[...S.palletOrder],i=a.indexOf(id),to=Math.max(0,Math.min(a.length-1,Number(n)-1));if(i<0||Number.isNaN(to))return;a.splice(i,1);a.splice(to,0,id);S.palletOrder=a;pallets();$("snapshotBadge").textContent="NOT SAVED"}
function pallets(){
 if(!S.pallets.length){$("palletArea").innerHTML='<div class="empty-state compact-empty">ไม่พบ Pallet/Jig Layout</div>';return}
 let arr=orderedPallets();
 $("palletArea").innerHTML='<div class="pallet-order-note">Daily Pallet Order — ปรับลำดับเฉพาะวันนี้ ไม่แก้ Physical Master</div><div class="pallet-grid">'+arr.map((p,i)=>{let ch=S.active.has(p.id),comp=posOf(p).map(q=>`${q.model} ${q.door} ×${q.qty}`).join(" + ");return `<div class="pallet-card order-card ${ch?"selected":""}"><input type="checkbox" data-p="${p.id}" ${ch?"checked":""}><div class="pallet-body"><div class="pallet-top"><b>Position ${i+1}</b><span class="physical-id">Pallet ${p.palletName||p.palletCode||p.palletNo||p.name||p.id}</span></div><span>${comp||"No composition"}</span></div><div class="order-tools"><button data-up="${p.id}">↑</button><button data-down="${p.id}">↓</button><input type="number" min="1" max="${arr.length}" value="${i+1}" data-pos="${p.id}"></div></div>`}).join("")+"</div>";
 $("palletArea").querySelectorAll("[data-p]").forEach(e=>e.onchange=()=>{e.checked?S.active.add(e.dataset.p):S.active.delete(e.dataset.p);S.baseActive=new Set(S.active);S.events=[];build();pallets();table();kpis();events();$("snapshotBadge").textContent="NOT SAVED"});
 $("palletArea").querySelectorAll("[data-up]").forEach(e=>e.onclick=()=>movePallet(e.dataset.up,-1));
 $("palletArea").querySelectorAll("[data-down]").forEach(e=>e.onclick=()=>movePallet(e.dataset.down,1));
 $("palletArea").querySelectorAll("[data-pos]").forEach(e=>e.onchange=()=>setPalletPosition(e.dataset.pos,e.value));
 events();
}
function kpis(){
  let p=mapForSet(S.baseActive||S.active).reduce((s,x)=>s+x.qty,0);
  let r=S.matrix.reduce((s,x)=>s+x.rounds,0);
  let t=S.matrix.reduce((s,x)=>s+x.total,0);
  $("kpiPallets").textContent=S.active.size;
  $("kpiPositions").textContent=p;
  $("kpiRounds").textContent=r;
  $("kpiPlan").textContent=t.toLocaleString();
}
function table(){
 if(!S.matrix.length){$("planTableArea").innerHTML='<div class="empty-state">ไม่มี WORK Time Block</div>';return}
 let km=new Map;S.matrix.forEach(r=>r.cells.forEach(c=>km.set(c.model+"|||"+c.door,{model:c.model,door:c.door})));
 let ps=[...km.values()].sort((a,b)=>(a.model+a.door).localeCompare(b.model+b.door));
 let h='<div class="table-scroll"><table class="grid plan-grid"><thead><tr><th>Time Block</th><th>Sched. Rounds</th><th>Loss</th><th>Adj. Rounds</th>';
 ps.forEach(p=>h+=`<th>${p.model}<br><small>${p.door||"-"}</small></th>`);
 h+='<th>Original Plan</th><th>Adjusted Plan</th></tr></thead><tbody>';
 S.matrix.forEach(x=>{h+=`<tr><td><b>${x.start}–${x.end}</b></td><td>${x.scheduledRounds}</td><td>${x.lossMinutes?`<b>${x.lossMinutes} min</b>`:"-"}</td><td>${x.rounds}</td>`;x.cells.forEach(c=>h+=`<td>${c.plan}</td>`);h+=`<td>${x.originalTotal}</td><td><b>${x.total}</b></td></tr>`});
 h+=`<tr class="total-row"><td>TOTAL</td><td>${S.matrix.reduce((s,x)=>s+x.scheduledRounds,0)}</td><td>${S.matrix.reduce((s,x)=>s+x.lossMinutes,0)} min</td><td>${S.matrix.reduce((s,x)=>s+x.rounds,0)}</td>`;
 ps.forEach((p,i)=>h+=`<td>${S.matrix.reduce((s,x)=>s+(x.cells[i]?.plan||0),0)}</td>`);
 h+=`<td>${S.matrix.reduce((s,x)=>s+x.originalTotal,0)}</td><td>${S.matrix.reduce((s,x)=>s+x.total,0)}</td></tr></tbody></table></div>`;
 $("planTableArea").innerHTML=h
}
async function load(){
 let d=$("planDate").value,l=val($("planLine").value).toUpperCase(),sh=$("planShift").value,id=`plan_${d}_${l}_${sh}`;
 ProdV2Context.set({date:d,lineId:l,shift:sh});
 try{
  stat("Loading...");
  let [ss,ls,savedDoc]=await Promise.all([
   all("prodV2_shiftMaster"),all("prodV2_jigLayouts"),
   ProdV2DB.collection("prodV2_dailyPlans").doc(id).get()
  ]);
  S.shift=ss.find(x=>lineOf(x)===l&&shiftOf(x)===sh)||null;
  S.pallets=ls.filter(x=>lineOf(x)===l&&x.active!==false);
  if(!S.shift){note(`ไม่พบ Shift Master: Line ${l} / ${sh}`,"plan-warn");stat("Master missing","err");return}
  let avail=new Set(S.pallets.map(x=>x.id));
  if(savedDoc.exists){
   let saved=savedDoc.data(), ms=saved.masterSnapshot||{};
   let ids=ms.activePalletIds||S.pallets.map(x=>x.id);
   S.active=new Set(ids.filter(x=>avail.has(x))); S.baseActive=new Set(S.active);
   let oo=ms.palletOrder||[];
   S.palletOrder=[...oo.filter(x=>avail.has(x)),...S.pallets.map(x=>x.id).filter(x=>!oo.includes(x))];
   S.events=(ms.palletChanges||[]).filter(e=>!e.palletId||avail.has(e.palletId));
   S.losses=(ms.palletChangeLosses||[]).filter(x=>!x.palletId||avail.has(x.palletId));
   S.loaded=true; $("masterBadge").textContent=S.shift.verificationStatus||"MASTER";
   build(); pallets(); table(); kpis(); events();
   $("snapshotBadge").textContent="SAVED";
   note(`โหลด Saved Daily Plan แล้ว • ${d} • Line ${l} / ${sh}`,"plan-ok"); stat("Saved plan loaded","ok");
  }else{
   S.active=new Set(S.pallets.map(x=>x.id));S.baseActive=new Set(S.active);S.events=[];S.losses=[];S.palletOrder=S.pallets.map(x=>x.id);S.loaded=true;
   $("masterBadge").textContent=S.shift.verificationStatus||"MASTER";build();pallets();table();kpis();events();
   $("snapshotBadge").textContent="NOT SAVED";
   if(!S.matrix.length)note(`Line ${l} / ${sh} ยังไม่มี WORK Time Block — ไม่สร้างตัวเลข Plan`,"plan-warn");else note(`ยังไม่มี Saved Daily Plan • โหลด Master เริ่มต้นแล้ว`,"plan-warn");
   stat("Master loaded","ok");
  }
 }catch(e){console.error(e);note(e.message,"plan-warn");stat("Load failed","err")}
}
function snap(){return{date:$("planDate").value,lineId:$("planLine").value.toUpperCase(),shift:$("planShift").value,masterSnapshot:{shiftMasterId:S.shift?.id||null,shiftStatus:S.shift?.verificationStatus||null,palletOrder:[...S.palletOrder],activePalletIds:[...S.baseActive],palletChanges:S.events,palletChangeLosses:S.losses,activePallets:S.pallets.filter(p=>S.baseActive.has(p.id)||S.events.some(e=>e.palletId===p.id||e.replacementPalletId===p.id)).map(p=>({id:p.id,palletCode:p.palletName||p.palletCode||p.palletNo||p.name||p.id,positions:posOf(p)}))},blocks:S.matrix,originalPlan:S.matrix.reduce((s,x)=>s+x.originalTotal,0),adjustedPlan:S.matrix.reduce((s,x)=>s+x.total,0),totalPlan:S.matrix.reduce((s,x)=>s+x.total,0),lossMinutes:S.matrix.reduce((s,x)=>s+x.lossMinutes,0),scheduledRounds:S.matrix.reduce((s,x)=>s+x.scheduledRounds,0),plannedRounds:S.matrix.reduce((s,x)=>s+x.rounds,0),updatedAt:firebase.firestore.FieldValue.serverTimestamp(),planningLogic:'POSITION_COMPOSITION_WITH_CHANGE_LOSS',version:3}}
async function save(){
 if(!S.loaded||!S.matrix.length){note("Load Master ที่มี WORK Time Block ก่อน","plan-warn");return}
 let l=$("planLine").value.toUpperCase();
 let lineDoc=S.lines.find(x=>(x.lineId||x.code||x.id)===l);
 let maxPallets=lineDoc?.maxActivePallets;
 let activeCount=S.baseActive.size;
 if(maxPallets&&activeCount>maxPallets){
  note(`บันทึกไม่ได้: เลือก Pallet Active ${activeCount} ใบ เกินขีดจำกัดเครื่อง Line ${l} (สูงสุด ${maxPallets} ใบ) — ลด Position ที่ติ๊ก Active ลงก่อน`,"plan-warn");
  stat("Too many active pallets","err");
  return;
 }
 let d=$("planDate").value,sh=$("planShift").value,id=`plan_${d}_${l}_${sh}`;try{stat("Saving...");await ProdV2DB.set("prodV2_dailyPlans",id,snap(),true);$("snapshotBadge").textContent="SAVED";note(`บันทึก Daily Plan แล้ว • ${d} • Line ${l} • ${sh}`,"plan-ok");stat("Saved","ok")}catch(e){note(window.ProdV2Auth?ProdV2Auth.friendlyError(e):e.message,"plan-warn");stat("Save failed","err")}
}

async function deleteSavedPlan(){
 let d=$("planDate").value,l=$("planLine").value.toUpperCase(),sh=$("planShift").value,id=`plan_${d}_${l}_${sh}`;
 if(!confirm(`ลบ Saved Daily Plan ${d} • Line ${l} • ${sh} ?\nPallet Change Loss ที่หน้า Loss จะหายตามแผนนี้`))return;
 try{
  stat("Deleting...");
  await ProdV2DB.delete("prodV2_dailyPlans",id);
  note("ลบ Saved Daily Plan แล้ว • กำลังกลับไป Master เริ่มต้น","plan-ok");
  await load();
 }catch(e){note(window.ProdV2Auth?ProdV2Auth.friendlyError(e):e.message,"plan-warn");stat("Delete failed","err")}
}

async function copy(){let d=$("planDate").value,l=$("planLine").value.toUpperCase(),sh=$("planShift").value,p=prevDate(d),id=`plan_${p}_${l}_${sh}`;try{let doc=await ProdV2DB.collection("prodV2_dailyPlans").doc(id).get();if(!doc.exists){note(`ไม่พบ Daily Plan ของวันก่อน (${p})`,"plan-warn");return}await load();let avail=new Set(S.pallets.map(x=>x.id)),ids=doc.data().masterSnapshot?.activePalletIds||[];S.active=new Set(ids.filter(x=>avail.has(x)));S.baseActive=new Set(S.active);let oo=doc.data().masterSnapshot?.palletOrder||[];S.palletOrder=[...oo.filter(x=>avail.has(x)),...S.pallets.map(x=>x.id).filter(x=>!oo.includes(x))];S.events=(doc.data().masterSnapshot?.palletChanges||[]).filter(e=>avail.has(e.palletId));S.losses=(doc.data().masterSnapshot?.palletChangeLosses||[]).filter(l=>!l.palletId||avail.has(l.palletId));build();pallets();table();kpis();events();$("snapshotBadge").textContent="COPIED · NOT SAVED";note(`คัดลอกจาก ${p} แล้ว • ตรวจสอบก่อน Save Plan`,"plan-ok")}catch(e){note(e.message,"plan-warn")}}
async function init(){$("planDate").value=localDate();$("loadPlanBtn").onclick=load;$("savePlanBtn").onclick=save;$("copyPlanBtn").onclick=copy;let dp=$("deletePlanBtn");if(dp)dp.onclick=deleteSavedPlan;try{S.lines=(await all("prodV2_lines")).filter(x=>x.active!==false).sort((a,b)=>(a.order||99)-(b.order||99));$("planLine").innerHTML=S.lines.map(x=>`<option value="${x.lineId||x.code||x.id}">${x.lineName||x.name||"Line "+(x.lineId||x.code||x.id)}</option>`).join("");ProdV2Context.bind($("planDate"),$("planLine"),$("planShift"));stat("Ready","ok");let c=ProdV2Context.get();if(c.date&&c.lineId&&c.shift)load()}catch(e){note(e.message,"plan-warn");stat("Load failed","err")}}
addEventListener("DOMContentLoaded",init)})();