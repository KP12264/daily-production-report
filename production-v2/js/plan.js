(()=>{const $=id=>document.getElementById(id);let S={lines:[],shift:null,pallets:[],active:new Set(),baseActive:new Set(),events:[],matrix:[],loaded:false};
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
function activeAt(time){
  let set=new Set(S.baseActive||S.active);
  (S.events||[]).filter(e=>e.effectiveFrom<=time).sort((a,b)=>a.effectiveFrom.localeCompare(b.effectiveFrom)).forEach(e=>{
    if(e.action==="REMOVE")set.delete(e.palletId);
    else if(e.action==="ADD")set.add(e.palletId);
    else if(e.action==="REPLACE"){set.delete(e.palletId);if(e.replacementPalletId)set.add(e.replacementPalletId)}
  });
  return set
}
function mapForSet(set){let m=new Map;S.pallets.forEach(p=>{if(!set.has(p.id))return;posOf(p).forEach(q=>{let k=q.model+"|||"+q.door,o=m.get(k)||{model:q.model,door:q.door,qty:0};o.qty+=q.qty;m.set(k,o)})});return [...m.values()].sort((a,b)=>(a.model+a.door).localeCompare(b.model+b.door))}
function splitBlocks(){
  let blocks=(S.shift?.blocks||[]).filter(b=>val(b.type).toUpperCase()==="WORK"),out=[];
  blocks.forEach(b=>{
    let cuts=[b.start,b.end];
    (S.events||[]).forEach(e=>{if(e.effectiveFrom>b.start&&e.effectiveFrom<b.end)cuts.push(e.effectiveFrom)});
    cuts=[...new Set(cuts)].sort();
    let cycle=Number(b.cycle||S.shift?.standardCycleMinPerRound||10);
    for(let i=0;i<cuts.length-1;i++){
      let st=cuts[i],en=cuts[i+1],duration=mins(en)-mins(st);
      if(duration<0)duration+=1440;
      out.push({start:st,end:en,minutes:duration,cycle,rounds:Math.floor(duration/cycle),sourceStart:b.start,sourceEnd:b.end})
    }
  });
  return out
}
function build(){
  let blocks=splitBlocks(),allKeys=new Map;
  blocks.forEach(b=>mapForSet(activeAt(b.start)).forEach(p=>allKeys.set(p.model+"|||"+p.door,{model:p.model,door:p.door})));
  let cols=[...allKeys.values()].sort((a,b)=>(a.model+a.door).localeCompare(b.model+b.door));
  S.matrix=blocks.map(b=>{
    let pm=new Map(mapForSet(activeAt(b.start)).map(p=>[p.model+"|||"+p.door,p]));
    let cells=cols.map(c=>{let p=pm.get(c.model+"|||"+c.door),qty=p?.qty||0;return{...c,qty,plan:b.rounds*qty}});
    return{start:b.start,end:b.end,minutes:b.minutes,rounds:b.rounds,activePalletIds:[...activeAt(b.start)],cells,total:cells.reduce((s,c)=>s+c.plan,0)}
  })
}
function events(){
  let host=document.getElementById("changeArea");if(!host)return;
  if(!S.loaded||!(S.shift?.blocks||[]).some(b=>val(b.type).toUpperCase()==="WORK")){host.innerHTML='<div class="empty-state compact-empty">Load Master ที่มี WORK Time Block ก่อน</div>';return}
  let work=(S.shift.blocks||[]).filter(b=>val(b.type).toUpperCase()==="WORK");
  let palletLabel=p=>`${p.palletCode||p.palletNo||p.name||p.id} — ${posOf(p).map(q=>`${q.model} ${q.door||""}`).join(" + ")}`;
  let opts=S.pallets.map(p=>`<option value="${p.id}">${palletLabel(p)}</option>`).join("");
  host.innerHTML=`<div class="change-controls change-controls-v3">
    <div><small>FROM PALLET</small><select id="chgPallet">${opts}</select></div>
    <div><small>ACTION</small><select id="chgAction"><option value="REPLACE">Replace Pallet</option><option value="REMOVE">Remove Only</option><option value="ADD">Add Only</option></select></div>
    <div id="replacementWrap"><small>REPLACE WITH</small><select id="chgReplacement">${opts}</select></div>
    <div><small>ACTUAL CHANGE TIME</small><input id="chgTime" type="time" step="60"></div>
    <div class="apply-wrap"><button id="addChangeBtn" class="primary">Apply Change</button></div>
  </div>
  <div class="change-help">ใส่เวลาที่เปลี่ยนจริง เช่น 14:20 • ถ้าไม่ตรงรอบ ระบบจะเริ่มมีผลที่รอบถัดไปอัตโนมัติ</div>
  <div class="change-list">${S.events.length?S.events.map((e,i)=>{
    let from=S.pallets.find(p=>p.id===e.palletId),to=S.pallets.find(p=>p.id===e.replacementPalletId);
    let text=e.action==="REPLACE"?`REPLACE · ${from?palletLabel(from):e.palletLabel} → ${to?palletLabel(to):e.replacementPalletLabel}`:`${e.action} · ${from?palletLabel(from):e.palletLabel}`;
    let timing=e.actualTime!==e.effectiveFrom?`${e.actualTime} → effective ${e.effectiveFrom}`:e.effectiveFrom;
    return `<div class="change-item change-item-v2"><b>${timing}</b><span>${text}</span><button data-del="${i}">×</button></div>`
  }).join(""):'<span class="change-empty">ยังไม่มีการเปลี่ยน Pallet กลางกะ</span>'}</div>`;
  let actionEl=document.getElementById("chgAction"),rw=document.getElementById("replacementWrap"),timeEl=document.getElementById("chgTime");
  timeEl.value=work[0]?.start||"08:00";
  function sync(){rw.style.display=actionEl.value==="REPLACE"?"block":"none"} actionEl.onchange=sync;sync();
  document.getElementById("addChangeBtn").onclick=()=>{
    let pid=document.getElementById("chgPallet").value,action=actionEl.value,actual=timeEl.value,rid=document.getElementById("chgReplacement").value;
    let p=S.pallets.find(x=>x.id===pid),rp=S.pallets.find(x=>x.id===rid);
    if(!actual){note("กรุณาเลือกเวลาเปลี่ยน Pallet","plan-warn");return}
    if(action==="REPLACE"&&pid===rid){note("Pallet เดิมและ Pallet ที่นำมาแทนต้องไม่ใช่ตัวเดียวกัน","plan-warn");return}
    let block=work.find(b=>actual>=b.start&&actual<b.end);
    if(!block){note("เวลาที่เลือกไม่ได้อยู่ใน WORK Time Block","plan-warn");return}
    let effective=roundBoundary(block,actual);
    if(effective>=block.end && effective!==block.end){note("ไม่สามารถหา Effective Round ในช่วงนี้ได้","plan-warn");return}
    S.events.push({palletId:pid,palletLabel:p?.palletCode||p?.palletNo||p?.name||pid,action,actualTime:actual,effectiveFrom:effective,replacementPalletId:action==="REPLACE"?rid:null,replacementPalletLabel:action==="REPLACE"?(rp?.palletCode||rp?.palletNo||rp?.name||rid):null});
    build();table();kpis();events();$("snapshotBadge").textContent="NOT SAVED";
    let suffix=actual===effective?`ตั้งแต่ ${effective}`:`เวลาเปลี่ยนจริง ${actual} • มีผลรอบถัดไป ${effective}`;
    note(action==="REPLACE"?`เปลี่ยน Pallet ${p?.palletCode||p?.name||pid} → ${rp?.palletCode||rp?.name||rid} • ${suffix}`:`${action==="REMOVE"?"ถอด":"เพิ่ม"} Pallet ${p?.palletCode||p?.name||pid} • ${suffix}`,"plan-ok")
  };
  host.querySelectorAll("[data-del]").forEach(x=>x.onclick=()=>{S.events.splice(Number(x.dataset.del),1);build();table();kpis();events();$("snapshotBadge").textContent="NOT SAVED"})
}
function table(){if(!S.matrix.length){$("planTableArea").innerHTML='<div class="empty-state">ไม่มี WORK Time Block</div>';return}let km=new Map;S.matrix.forEach(r=>r.cells.forEach(c=>km.set(c.model+"|||"+c.door,{model:c.model,door:c.door})));let ps=[...km.values()].sort((a,b)=>(a.model+a.door).localeCompare(b.model+b.door)),h='<div class="table-scroll"><table class="grid plan-grid"><thead><tr><th>Time Block</th><th>Rounds</th>';ps.forEach(p=>h+=`<th>${p.model}<br><small>${p.door||"-"} · ${p.qty} pos</small></th>`);h+='<th>Total Plan</th></tr></thead><tbody>';S.matrix.forEach(x=>{h+=`<tr><td><b>${x.start}–${x.end}</b></td><td>${x.rounds}</td>`;x.cells.forEach(c=>h+=`<td>${c.plan}</td>`);h+=`<td><b>${x.total}</b></td></tr>`});h+=`<tr class="total-row"><td>TOTAL</td><td>${S.matrix.reduce((s,x)=>s+x.rounds,0)}</td>`;ps.forEach((p,i)=>h+=`<td>${S.matrix.reduce((s,x)=>s+(x.cells[i]?.plan||0),0)}</td>`);h+=`<td>${S.matrix.reduce((s,x)=>s+x.total,0)}</td></tr></tbody></table></div>`;$("planTableArea").innerHTML=h}
async function load(){let l=val($("planLine").value).toUpperCase(),sh=$("planShift").value;try{stat("Loading Master...");let [ss,ls]=await Promise.all([all("prodV2_shiftMaster"),all("prodV2_jigLayouts")]);S.shift=ss.find(x=>lineOf(x)===l&&shiftOf(x)===sh)||null;S.pallets=ls.filter(x=>lineOf(x)===l&&x.active!==false);if(!S.shift){note(`ไม่พบ Shift Master: Line ${l} / ${sh}`,"plan-warn");stat("Master missing","err");return}S.active=new Set(S.pallets.map(x=>x.id));S.baseActive=new Set(S.active);S.events=[];S.loaded=true;$("masterBadge").textContent=S.shift.verificationStatus||"MASTER";build();pallets();table();kpis();if(!S.matrix.length)note(`Line ${l} / ${sh} ยังไม่มี WORK Time Block — ไม่สร้างตัวเลข Plan`,"plan-warn");else note(`โหลด Master สำเร็จ • Line ${l} / ${sh}`,"plan-ok");stat("Master loaded","ok")}catch(e){console.error(e);note(e.message,"plan-warn");stat("Load failed","err")}}
function snap(){return{date:$("planDate").value,lineId:$("planLine").value.toUpperCase(),shift:$("planShift").value,masterSnapshot:{shiftMasterId:S.shift?.id||null,shiftStatus:S.shift?.verificationStatus||null,activePalletIds:[...S.baseActive],palletChanges:S.events,activePallets:S.pallets.filter(p=>S.baseActive.has(p.id)||S.events.some(e=>e.palletId===p.id||e.replacementPalletId===p.id)).map(p=>({id:p.id,palletCode:p.palletCode||p.palletNo||p.name||p.id,positions:posOf(p)}))},blocks:S.matrix,totalPlan:S.matrix.reduce((s,x)=>s+x.total,0),plannedRounds:S.matrix.reduce((s,x)=>s+x.rounds,0),updatedAt:firebase.firestore.FieldValue.serverTimestamp(),version:1}}
async function save(){if(!S.loaded||!S.matrix.length){note("Load Master ที่มี WORK Time Block ก่อน","plan-warn");return}let d=$("planDate").value,l=$("planLine").value.toUpperCase(),sh=$("planShift").value,id=`plan_${d}_${l}_${sh}`;try{stat("Saving...");await ProdV2DB.set("prodV2_dailyPlans",id,snap(),true);$("snapshotBadge").textContent="SAVED";note(`บันทึก Daily Plan แล้ว • ${d} • Line ${l} • ${sh}`,"plan-ok");stat("Saved","ok")}catch(e){note(e.message,"plan-warn");stat("Save failed","err")}}
async function copy(){let d=$("planDate").value,l=$("planLine").value.toUpperCase(),sh=$("planShift").value,p=prevDate(d),id=`plan_${p}_${l}_${sh}`;try{let doc=await ProdV2DB.collection("prodV2_dailyPlans").doc(id).get();if(!doc.exists){note(`ไม่พบ Daily Plan ของวันก่อน (${p})`,"plan-warn");return}await load();let avail=new Set(S.pallets.map(x=>x.id)),ids=doc.data().masterSnapshot?.activePalletIds||[];S.active=new Set(ids.filter(x=>avail.has(x)));S.baseActive=new Set(S.active);S.events=(doc.data().masterSnapshot?.palletChanges||[]).filter(e=>avail.has(e.palletId));build();pallets();table();kpis();events();$("snapshotBadge").textContent="COPIED · NOT SAVED";note(`คัดลอกจาก ${p} แล้ว • ตรวจสอบก่อน Save Plan`,"plan-ok")}catch(e){note(e.message,"plan-warn")}}
async function init(){$("planDate").value=localDate();$("loadPlanBtn").onclick=load;$("savePlanBtn").onclick=save;$("copyPlanBtn").onclick=copy;try{S.lines=(await all("prodV2_lines")).filter(x=>x.active!==false).sort((a,b)=>(a.order||99)-(b.order||99));$("planLine").innerHTML=S.lines.map(x=>`<option value="${x.lineId||x.code||x.id}">${x.name||"Line "+(x.lineId||x.code||x.id)}</option>`).join("");stat("Ready","ok")}catch(e){note(e.message,"plan-warn");stat("Load failed","err")}}
addEventListener("DOMContentLoaded",init)})();