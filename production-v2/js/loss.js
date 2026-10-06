(()=>{const $=id=>document.getElementById(id);let S={lines:[],plan:null,shift:null,manual:[],loaded:false,editId:null};
const val=x=>String(x??"").trim(), esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])), lineOf=x=>val(x.lineId||x.line||x.lineCode).toUpperCase(), shiftOf=x=>val(x.shift).toUpperCase();
function localDate(d=new Date()){const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
function mins(t){let [h,m]=String(t).split(":").map(Number);return h*60+m}
function norm(t){let s=val(t).replace(/[^\d:]/g,"");if(/^\d{4}$/.test(s))s=s.slice(0,2)+":"+s.slice(2);if(!/^\d{1,2}:\d{2}$/.test(s))return null;let [h,m]=s.split(":").map(Number);if(h>23||m>59)return null;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`}
function duration(a,b){let x=mins(b)-mins(a);if(x<0)x+=1440;return x}
function note(t,c=""){$("lossMessage").textContent=t;$("lossMessage").className="notice info-notice "+c}
function stat(t,c=""){$("lossStatus").textContent=t;$("lossStatus").className="hero-status "+c;
 // header "Last Updated" — display only: time of the last successful status
 if(c==="ok"){let lu=$("lossLastUpdated");if(lu){let d=new Date(),z=n=>String(n).padStart(2,"0");lu.textContent=`${z(d.getDate())} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]} ${d.getFullYear()} ${z(d.getHours())}:${z(d.getMinutes())}:${z(d.getSeconds())}`}}
}
async function all(n){const s=await ProdV2DB.collection(n).get();return s.docs.map(d=>({id:d.id,...d.data()}))}
function autoLosses(){return S.plan?.masterSnapshot?.palletChangeLosses||[]}
function autoRows(){return autoLosses().map((x,i)=>({...x,id:`auto_${i}`,auto:true,category:x.category||"Pallet Change",remark:x.remark||"จาก Daily Plan"}))}
function allRows(){return [...autoRows(),...S.manual.map(x=>({...x,auto:false}))]}

// Loss Cause Master — Category (flat) + Detail Cause (child, keyed by
// categoryId). Falls back to the old hardcoded category list if the Master
// hasn't been seeded yet (Master Setup → Loss Cause → Initialize Loss Cause
// Master (V1)), so this page keeps working either way.
const LEGACY_CATEGORY_FALLBACK=["Machine","Robot","Jig","Conveyor","Material","Waiting","Change Model","Quality","Other"];
async function loadLossCauseMaster(){
 try{
  let [catSnap,detSnap]=await Promise.all([
   ProdV2DB.collection("prodV2_lossCategories").get(),
   ProdV2DB.collection("prodV2_lossDetailCauses").get()
  ]);
  S.lossCategories=catSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.active!==false).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0)||String(a.name).localeCompare(String(b.name)));
  let allDetails=detSnap.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.active!==false).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0)||String(a.name).localeCompare(String(b.name)));
  S.lossDetailsByCat={};
  allDetails.forEach(x=>{(S.lossDetailsByCat[x.categoryId]??=[]).push(x)});
 }catch(e){console.error("Loss Cause Master load failed",e)}
 populateCategoryDropdown();
}
function populateCategoryDropdown(){
 let sel=$("lossCategory"),keep=sel.value;
 if(S.lossCategories&&S.lossCategories.length){
  sel.innerHTML=S.lossCategories.map(x=>`<option value="${esc(x.name)}" data-cat-id="${esc(x.id)}">${esc(x.name)}</option>`).join("");
 }else{
  // Master ยังไม่ได้ Seed — ใช้ list เดิมไปก่อน กันหน้าใช้งานไม่ได้
  sel.innerHTML=LEGACY_CATEGORY_FALLBACK.map(x=>`<option value="${esc(x)}">${esc(x)}</option>`).join("");
 }
 if([...sel.options].some(o=>o.value===keep))sel.value=keep;
 populateDetailCauseDropdown();
}
function currentCategoryId(){
 let sel=$("lossCategory");
 return sel.selectedOptions[0]?.dataset.catId||null;
}
function biLabel(en,th){return th?`${th} (${en})`:en}
function populateDetailCauseDropdown(preserveValue){
 let sel=$("lossDetailCause"),catId=currentCategoryId();
 let details=catId?(S.lossDetailsByCat?.[catId]||[]):[];
 let opts=details.map(x=>`<option value="${esc(x.name)}" data-th="${esc(x.nameTh||"")}">${esc(biLabel(x.name,x.nameTh))}</option>`);
 if(!details.length)opts=['<option value="Other">Other</option>']; // fallback ถ้า Category นี้ยังไม่มี Detail Cause ใน Master
 sel.innerHTML=opts.join("");
 if(preserveValue&&[...sel.options].some(o=>o.value===preserveValue))sel.value=preserveValue;
 else sel.selectedIndex=0;
 syncCustomCauseVisibility();
}
function syncCustomCauseVisibility(){
 let isOther=$("lossDetailCause").value==="Other";
 $("lossCustomCauseWrap").hidden=!isOther;
 if(!isOther)$("lossCustomCause").value="";
}

function timeBlocks(){
 // The saved Daily Plan's `blocks` field only ever contains WORK-type blocks —
 // plan.js filters BREAK blocks out before saving, since Plan/Actual math only
 // applies to WORK time. So BREAK windows must come from the actual Shift Master
 // document (S.shift, fetched in load()) which still has the full WORK+BREAK list.
 let raw=S.shift?.blocks||[];
 return Array.isArray(raw)?raw:[];
}
function scheduledBreaks(){
 return timeBlocks().filter(b=>String(b.type||b.blockType||"").toUpperCase()==="BREAK").map(b=>({
   start:norm(b.start||b.startTime),end:norm(b.end||b.endTime),label:b.label||"Scheduled Break"
 })).filter(x=>x.start&&x.end);
}
function segments(a,b){
 let A=mins(a),B=mins(b); if(B<=A)B+=1440; return [[A,B]];
}
function overlaps(a,b,c,d){
 for(let [x1,x2] of segments(a,b))for(let [y1,y2] of segments(c,d)){
   for(let shift of [-1440,0,1440]) if(Math.max(x1,y1+shift)<Math.min(x2,y2+shift)) return true;
 } return false;
}
function breakConflicts(a,b){return scheduledBreaks().filter(x=>overlaps(a,b,x.start,x.end))}
function renderSummary(rows){
 const totals={}; rows.forEach(x=>{let k=x.category||"Other";totals[k]=(totals[k]||0)+Number(x.minutes||0)});
 const sorted=Object.entries(totals).sort((a,b)=>b[1]-a[1]);
 // presentation: horizontal bars. % = category minutes / sum of the DISPLAYED category minutes (one decimal).
 const shown=sorted.reduce((s,[,v])=>s+v,0),maxv=sorted.length?sorted[0][1]:0;
 $("categorySummary").innerHTML=sorted.length?sorted.map(([k,v])=>{let pct=shown?(v/shown*100).toFixed(1):"0.0",w=maxv?Math.max(2,Math.round(v/maxv*100)):0;return `<div class="lv2-bar-row${k==="Material"?" is-material":""}" data-cat="${esc(k)}" data-min="${v}"><span class="lv2-bar-name">${esc(k)}${k==="Material"?'<em class="lv2-mat-tag">ไม่รวมใน Total KPI</em>':""}</span><div class="lv2-bar-track"><div class="lv2-bar-fill" style="width:${w}%"></div></div><b class="lv2-bar-min">${v} min</b><span class="lv2-bar-pct">${pct}%</span></div>`}).join("")+`<div class="lv2-bar-foot">สัดส่วน = ต่อผลรวมที่แสดง ${shown} min (รวม Material)</div>`:'<div class="lv2-empty">ยังไม่มี Loss</div>';
}
function render(){
 // "Material" = waiting for raw material — doesn't stop the machine, so it's
 // recorded and shown like any other category (Loss Records list, Loss by
 // Category breakdown) but excluded from the Loss TOTALS below, same as the
 // Dashboard's LOSS KPI already does (dashboard.js render(), lossRows()
 // filter). Only the two summed KPIs need the filter — everything else
 // (renderSummary, the Loss Records table, RECORDS count) still shows it.
 let rows=allRows(),lossOnly=rows.filter(x=>x.category!=="Material");
 let total=lossOnly.reduce((s,x)=>s+Number(x.minutes||duration(x.start,x.end)||0),0),auto=autoRows().reduce((s,x)=>s+Number(x.minutes||0),0),manual=S.manual.filter(x=>x.category!=="Material").reduce((s,x)=>s+Number(x.minutes||0),0);
 // presentation-only derived values (no calculation line above is changed)
 let mat=rows.filter(x=>x.category==="Material").reduce((s,x)=>s+Number(x.minutes||0),0),share=v=>total>0?(v/total*100).toFixed(1)+"%":"";
 $("lossKpis").innerHTML=`<div class="lv2-kpi lv2-k-total"><small>Total Loss (excl. Material)</small><b>${total} <span class="u">min</span></b><em>เวลาสูญเสียทั้งหมด (ไม่รวม Material)</em>${mat>0?`<div class="lv2-kpi-mat">Material: ${mat} min (not included)</div>`:""}</div><div class="lv2-kpi lv2-k-pal"><small>Pallet Change Loss</small>${share(auto)?`<span class="lv2-chip">${share(auto)}</span>`:""}<b>${auto} <span class="u">min</span></b><em>จากการเปลี่ยน Pallet (Daily Plan)</em></div><div class="lv2-kpi lv2-k-man"><small>Other Loss (Manual)</small>${share(manual)?`<span class="lv2-chip lv2-chip-amber">${share(manual)}</span>`:""}<b>${manual} <span class="u">min</span></b><em>จากการหยุดอื่น ๆ (บันทึกโดยผู้ใช้)</em></div><div class="lv2-kpi lv2-k-rec"><small>Total Records</small><b>${rows.length} <span class="u">records</span></b><em>จำนวนรายการ Loss ทั้งหมด</em></div>`;
 renderSummary(rows);renderDetailSummary(rows);renderBreaks();
 $("lossRecordCount").textContent=rows.length?`(${rows.length})`:"";
 if(!rows.length){$("lossList").innerHTML='<div class="empty-state">ยังไม่มี Loss ในกะนี้</div>';updateDurationPreview();return}
 const ICON_E='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',ICON_D='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>';
 let h='<div class="lv2-tw"><table class="lv2-table loss-table"><thead><tr><th>#</th><th>Start</th><th>End</th><th>Duration (min)</th><th>Category</th><th>Detail Cause</th><th>Remark</th><th>Source</th><th>Actions</th></tr></thead><tbody>';
 rows.sort((a,b)=>mins(a.start||"00:00")-mins(b.start||"00:00")).forEach((x,i)=>{
   let detailText=x.auto?"—":!x.detailCause?"ไม่ระบุรายละเอียด (Unspecified)":x.detailCause==="Other"?`อื่น ๆ (Other)${x.customCause?": "+esc(x.customCause):""}`:esc(biLabel(x.detailCause,x.detailCauseTh));
   h+=`<tr class="${x.auto?"is-auto":"is-manual"}"><td data-label="#">${i+1}</td><td data-label="Start">${esc(x.start||"-")}</td><td data-label="End">${esc(x.end||"-")}</td><td data-label="Duration (min)"><b>${Number(x.minutes||duration(x.start,x.end)||0)}</b></td><td data-label="Category" class="lv2-cat">${esc(x.category||"-")}</td><td data-label="Detail Cause" class="lv2-det">${detailText}</td><td data-label="Remark" class="lv2-rem">${esc(x.remark||"-")}</td><td data-label="Source">${x.auto?'<span class="source-auto" title="จาก Daily Plan">PALLET CHANGE</span>':'<span class="source-manual">MANUAL</span>'}</td><td data-label="Actions" class="lv2-act">${x.auto?'<span class="muted">แก้ที่ Daily Plan</span>':`<button class="loss-edit lv2-rb" data-edit="${x.id}" type="button">${ICON_E}Edit</button> <button class="loss-delete lv2-rb lv2-rb-del" data-del="${x.id}" type="button">${ICON_D}Delete</button>`}</td></tr>`
 }); h+='</tbody></table></div>';$("lossList").innerHTML=h;
 document.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>remove(b.dataset.del));
 document.querySelectorAll("[data-edit]").forEach(b=>b.onclick=()=>beginEdit(b.dataset.edit));
 // presentation: refresh the (display-only) duration preview after an Edit click; extra listener, existing onclick untouched
 document.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>setTimeout(updateDurationPreview,0)));updateDurationPreview();
}
function clearForm(){
 S.editId=null;$("lossStart").value="";$("lossEnd").value="";$("lossRemark").value="";$("addLossBtn").textContent="Add Loss";$("cancelEditBtn").hidden=true;
 populateCategoryDropdown(); // รีเซ็ต Category กลับตัวแรก + Detail Cause ตาม
}
function beginEdit(id){
 let x=S.manual.find(v=>v.id===id);if(!x)return;S.editId=id;
 $("lossStart").value=x.start;$("lossEnd").value=x.end;$("lossRemark").value=x.remark||"";
 $("lossCategory").value=x.category;
 populateDetailCauseDropdown(); // ตาม Category ของ record นี้
 if(x.detailCause){
  // ถ้า record มี detailCause บันทึกไว้แล้ว ให้เลือกให้ตรง (เพิ่ม option
  // ชั่วคราวถ้าค่านั้นไม่อยู่ใน Master ปัจจุบันแล้ว เช่นถูก Disable ไปทีหลัง —
  // ข้อมูลเก่ายังต้องแสดง/แก้ไขต่อได้โดยไม่บังคับเปลี่ยน)
  let sel=$("lossDetailCause");
  if(![...sel.options].some(o=>o.value===x.detailCause))sel.insertAdjacentHTML("afterbegin",`<option value="${esc(x.detailCause)}" data-th="${esc(x.detailCauseTh||"")}">${esc(biLabel(x.detailCause,x.detailCauseTh))}</option>`);
  sel.value=x.detailCause;
 }else{
  // Record เก่าไม่มี detailCause — โชว์ "Unspecified" เป็นค่าเริ่มต้น ผู้ใช้
  // ไม่จำเป็นต้องเปลี่ยนถ้าไม่ต้องการ (ตามที่ยืนยันไว้ — ไม่บังคับอัปเดตของเก่า)
  let sel=$("lossDetailCause");
  sel.insertAdjacentHTML("afterbegin",'<option value="">Unspecified</option>');
  sel.value="";
 }
 syncCustomCauseVisibility();
 if($("lossDetailCause").value==="Other")$("lossCustomCause").value=x.customCause||"";
 $("addLossBtn").textContent="Save Change";$("cancelEditBtn").hidden=false;$("lossStart").focus();note("กำลังแก้ไข Manual Loss · กด Save Change เมื่อเสร็จ","plan-warn");
}
async function load(){
 let d=$("lossDate").value,l=$("lossLine").value.toUpperCase(),sh=$("lossShift").value;window.ProdV2Context?.set({date:d,lineId:l,shift:sh});let pid=`plan_${d}_${l}_${sh}`;
 try{stat("Loading...");let [pd,snap,ss]=await Promise.all([ProdV2DB.collection("prodV2_dailyPlans").doc(pid).get(),ProdV2DB.collection("prodV2_lossLogs").where("date","==",d).where("lineId","==",l).where("shift","==",sh).get(),all("prodV2_shiftMaster")]);
 S.plan=pd.exists?{id:pd.id,...pd.data()}:null;S.manual=snap.docs.map(x=>({id:x.id,...x.data()}));S.shift=ss.find(x=>lineOf(x)===l&&shiftOf(x)===sh)||null;S.loaded=true;clearForm();render();$("lossBadge").textContent="LOADED";note(S.shift?"โหลดข้อมูลสำเร็จ · Scheduled Break จะไม่ถูกนับเป็น Loss":"โหลดข้อมูลสำเร็จ · ไม่พบ Shift Master จึงตรวจ Scheduled Break ไม่ได้",S.shift?"plan-ok":"plan-warn");stat("Loaded","ok")
 }catch(e){console.error(e);note(e.message,"plan-warn");stat("Load failed","err")}
}
async function saveLoss(){
 if(!S.loaded){note("กด Load ก่อนเพิ่ม Loss","plan-warn");return}
 let start=norm($("lossStart").value),end=norm($("lossEnd").value),category=$("lossCategory").value,remark=val($("lossRemark").value);
 let detailSel=$("lossDetailCause"),detailCause=detailSel.value,detailCauseTh=detailSel.selectedOptions[0]?.dataset.th||"",customCause=val($("lossCustomCause").value);
 if(!category){note("กรุณาเลือก Category","plan-warn");return}
 // Detail Cause จำเป็นสำหรับรายการใหม่เสมอ — สำหรับรายการเก่าที่แก้ไข ถ้า
 // เดิมไม่มี detailCause (โชว์ "Unspecified") และผู้ใช้ไม่ได้เปลี่ยน ปล่อยผ่านได้
 // โดยไม่บังคับให้กรอก (ตามที่ยืนยันไว้ — ไม่บังคับอัปเดตของเก่าทุกรายการ)
 let editingUnspecified=S.editId&&!S.manual.find(v=>v.id===S.editId)?.detailCause&&!detailCause;
 if(!detailCause&&!editingUnspecified){note("กรุณาเลือก Detail Cause","plan-warn");return}
 if(detailCause==="Other"&&!customCause){note("กรุณาระบุ Specify Cause เมื่อเลือก Detail Cause = Other","plan-warn");return}
 if(!start||!end){note("กรุณาใส่เวลา 24 ชั่วโมง เช่น 14:20 และ 14:30","plan-warn");return}
 let m=duration(start,end);if(m<=0){note("End ต้องต่างจาก Start","plan-warn");return}
 let conflicts=breakConflicts(start,end);
 if(conflicts.length){note(`บันทึกไม่ได้: ${start}–${end} ซ้อน Scheduled Break ${conflicts.map(x=>x.start+"–"+x.end).join(", ")} · Break ไม่ถือเป็น Loss`,"plan-warn");return}
 let data={date:$("lossDate").value,lineId:$("lossLine").value.toUpperCase(),shift:$("lossShift").value,category,start,end,minutes:m,remark,source:"MANUAL",updatedAt:firebase.firestore.FieldValue.serverTimestamp(),version:1};
 if(detailCause){data.detailCause=detailCause;if(detailCauseTh)data.detailCauseTh=detailCauseTh;if(detailCause==="Other")data.customCause=customCause}
 try{
   stat("Saving...");
   if(S.editId){await ProdV2DB.set("prodV2_lossLogs",S.editId,data,true);let i=S.manual.findIndex(x=>x.id===S.editId);S.manual[i]={id:S.editId,...data};note(`แก้ไข ${category} Loss ${m} นาทีแล้ว`,"plan-ok")}
   else{let r=await ProdV2DB.add("prodV2_lossLogs",data);S.manual.push({id:r.id,...data});note(`บันทึก ${category} Loss ${m} นาทีแล้ว`,"plan-ok")}
   clearForm();render();stat("Saved","ok")
 }catch(e){note(window.ProdV2Auth?ProdV2Auth.friendlyError(e):e.message,"plan-warn");stat("Save failed","err")}
}
async function remove(id){
 if(!confirm("ลบ Manual Loss รายการนี้?"))return;
 try{await ProdV2DB.delete("prodV2_lossLogs",id);S.manual=S.manual.filter(x=>x.id!==id);if(S.editId===id)clearForm();render();note("ลบ Manual Loss แล้ว","plan-ok")}catch(e){note(window.ProdV2Auth?ProdV2Auth.friendlyError(e):e.message,"plan-warn")}
}
// ---- Presentation-only additions (no calculation / validation / Firestore logic) ----
// Duration preview: READ-ONLY use of the existing norm() + duration(); nothing is stored from it.
function updateDurationPreview(){
 let o=$("lossDurPreview");if(!o)return;
 let a=norm($("lossStart").value),b=norm($("lossEnd").value);
 o.textContent=(a&&b&&a!==b)?String(duration(a,b)):"—";
}
// Loss by Detail Cause (Top 5): aggregation of the rows already loaded. Pallet Change rows (no detailCause) get their own label.
function renderDetailSummary(rows){
 let host=$("detailSummary");if(!host)return;
 let by={};rows.forEach(x=>{let k=x.auto?"__auto__":(x.detailCause||"__unspec__");by[k]??={min:0,th:x.detailCauseTh};by[k].min+=Number(x.minutes||0)});
 let arr=Object.entries(by).map(([key,i])=>({key,...i})).sort((a,b)=>b.min-a.min);
 if(!arr.length){host.innerHTML='<div class="lv2-empty">ยังไม่มี Loss</div>';return}
 let shown=arr.reduce((s,x)=>s+x.min,0),maxv=arr[0].min,top=arr.slice(0,5);
 let label=x=>x.key==="__auto__"?"Pallet Change (จาก Daily Plan)":x.key==="__unspec__"?"ไม่ระบุรายละเอียด (Unspecified)":x.key==="Other"?"อื่น ๆ (Other)":biLabel(x.key,x.th);
 host.innerHTML=top.map(x=>{let pct=shown?(x.min/shown*100).toFixed(1):"0.0",w=maxv?Math.max(2,Math.round(x.min/maxv*100)):0;return `<div class="lv2-bar-row" data-detail="${esc(x.key)}" data-min="${x.min}"><span class="lv2-bar-name">${esc(label(x))}</span><div class="lv2-bar-track"><div class="lv2-bar-fill"></div></div><b class="lv2-bar-min">${x.min} min</b><span class="lv2-bar-pct">${pct}%</span></div>`.replace('<div class="lv2-bar-fill"></div>',`<div class="lv2-bar-fill" style="width:${w}%"></div>`)}).join("")+(arr.length>5?`<div class="lv2-bar-foot">แสดง 5 จาก ${arr.length} สาเหตุ · สัดส่วน = ต่อผลรวมที่แสดง ${shown} min</div>`:`<div class="lv2-bar-foot">สัดส่วน = ต่อผลรวมที่แสดง ${shown} min</div>`);
}
// Scheduled Break — read-only view of the existing scheduledBreaks() (Shift Master). Never stored, never counted.
function renderBreaks(){
 let host=$("lossBreaks");if(!host)return;
 let br=scheduledBreaks();
 host.innerHTML=br.length?br.map(x=>`<div class="lv2-break"><span class="lv2-break-time">${esc(x.start)}–${esc(x.end)}</span><span class="lv2-break-min">${duration(x.start,x.end)} min</span><span class="lv2-break-tag">BREAK</span></div>`).join(""):`<div class="lv2-break-empty">${S.shift?"ไม่มี Scheduled Break ในกะนี้":"ไม่พบ Shift Master — ไม่มีข้อมูล Scheduled Break"}</div>`;
}
function badgeStateLoss(t){t=String(t||"");return /^LOADED/.test(t)?"ready":"idle"}
function initPresentation(){
 ["lossStart","lossEnd"].forEach(id=>{let e=$(id);if(e){e.addEventListener("input",updateDurationPreview);e.addEventListener("blur",updateDurationPreview)}});
 let c=$("cancelEditBtn");if(c)c.addEventListener("click",()=>setTimeout(updateDurationPreview,0));
 let b=$("lossBadge");if(b){let set=()=>{b.dataset.state=badgeStateLoss(b.textContent)};set();new MutationObserver(set).observe(b,{childList:true,characterData:true,subtree:true})}
}
addEventListener("DOMContentLoaded",initPresentation);
async function init(){
 $("lossDate").value=localDate();$("loadLossBtn").onclick=load;$("addLossBtn").onclick=saveLoss;$("cancelEditBtn").onclick=()=>{clearForm();note("ยกเลิกการแก้ไขแล้ว")};
 $("lossCategory").onchange=()=>populateDetailCauseDropdown(); // เปลี่ยน Category ต้องรีเซ็ต Detail Cause เสมอ (Case 5)
 $("lossDetailCause").onchange=syncCustomCauseVisibility;
 ["lossStart","lossEnd"].forEach(id=>$(id).onblur=()=>{let t=norm($(id).value);if(t)$(id).value=t});
 try{
   S.lines=(await all("prodV2_lines")).filter(x=>x.active!==false).sort((a,b)=>(a.order||99)-(b.order||99));
   $("lossLine").innerHTML=S.lines.map(x=>`<option value="${x.lineId||x.code||x.id}">${esc(x.lineName||x.name||"Line "+(x.lineId||x.code||x.id))}</option>`).join("");
   await loadLossCauseMaster();
   let c=window.ProdV2Context?.get?.()||{};if(c.date)$("lossDate").value=c.date;if(c.lineId&&[...$("lossLine").options].some(o=>o.value===c.lineId))$("lossLine").value=c.lineId;if(c.shift)$("lossShift").value=c.shift;
   if(c.date&&c.lineId&&c.shift)load();
 }catch(e){note(e.message,"plan-warn")}
}
addEventListener("DOMContentLoaded",init)})();