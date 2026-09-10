(()=>{const $=id=>document.getElementById(id);let S={lines:[],plan:null,actual:null,manual:[],hourly:null,cum:null,keys:[]};
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
function localDate(d=new Date()){const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
function addDays(dateStr,n){let d=new Date(dateStr+"T12:00:00");d.setDate(d.getDate()+n);return localDate(d)}
function stat(t,c=""){$("dashStatus").textContent=t;$("dashStatus").className="hero-status "+c}
function note(t,c=""){$("dashMessage").textContent=t;$("dashMessage").className="notice info-notice "+c}
async function all(n){let s=await ProdV2DB.collection(n).get();return s.docs.map(d=>({id:d.id,...d.data()}))}
const k=(m,d)=>`${m}|||${d}`;
function splitKey(x){let p=String(x).split("|||");return {model:p[0]||"",door:p[1]||""}}
function mins(t){let [h,m]=String(t||"00:00").split(":").map(Number);return (h||0)*60+(m||0)}
function nowMinutes(){let d=new Date();return d.getHours()*60+d.getMinutes()}
// Blocks are given as local HH:MM with no date, and a Night shift can cross
// midnight — so times must be "unwrapped" into a monotonically increasing
// timeline (each block's start/end pushed +1440 past the previous block's end
// whenever it looks like the clock rolled over) before they can be compared to
// "now" or to each other.
function unwrapBlockTimes(bs){
 let out=[],prevEnd=null;
 bs.forEach(b=>{
  let s=mins(b.start||b.startTime),e=mins(b.end||b.endTime);
  if(prevEnd!=null)while(s<prevEnd)s+=1440;
  if(e<=s)e+=1440;
  out.push({startU:s,endU:e});prevEnd=e;
 });
 return out;
}
// Plan the shift is expected to have produced by "now" — full Adjusted Plan for
// a past date, 0 for a future date, and for today: completed blocks count in
// full, the in-progress block is prorated by elapsed time, future blocks count
// as 0. This is what STATUS should compare Actual against, per Section 33 — not
// the full-shift Adjusted Plan, which overstates how far behind an early shift
// looks (e.g. 08:00–10:00 actual compared against a whole day's 3,150 plan).
function expectedByNow(pb,bs,viewDate){
 let today=localDate();
 if(viewDate<today)return pb.reduce((a,b)=>a+b,0);
 if(viewDate>today)return 0;
 if(!bs.length)return pb.reduce((a,b)=>a+b,0);
 let u=unwrapBlockTimes(bs),now=nowMinutes();
 if(now<u[0].startU)now+=1440;
 let sum=0;
 for(let i=0;i<pb.length;i++){
  let blk=u[i];if(!blk)break;
  if(now>=blk.endU)sum+=pb[i];
  else if(now>blk.startU)sum+=pb[i]*(now-blk.startU)/(blk.endU-blk.startU);
 }
 return sum;
}
function blocks(){
 // Canonical schema written by plan.js snap(): S.plan.blocks[] — each block has
 // {start,end,cells:[{model,door,plan,originalPlan}],total,originalTotal,...}
 return S.plan?.blocks||[];
}
function rowsFromPlan(){
 // Read plan quantities directly from the same field entry.js already reads
 // (S.plan.blocks[bi].cells[].plan) so Dashboard can never diverge from Entry.
 let out={};
 blocks().forEach((b,bi)=>{
  (b.cells||[]).forEach(c=>{
   let kk=k(c.model,c.door);
   (out[kk]??=[])[bi]=Number(c.plan||0);
  });
 });
 return out;
}
function actualRows(){
 let out={},a=S.actual?.actualByCell||{};
 Object.entries(a).forEach(([cell,v])=>{let p=cell.split("|||"),bi=Number(p[0]),kk=k(p[1],p[2]);(out[kk]??=[])[bi]=Number(v||0)});
 return out;
}
function filters(keys){
 let models=[...new Set(keys.map(x=>splitKey(x).model).filter(Boolean))].sort(),doors=[...new Set(keys.map(x=>splitKey(x).door).filter(Boolean))].sort();
 let mv=$("dashModel").value,dv=$("dashDoor").value;
 $("dashModel").innerHTML='<option value="">All Models</option>'+models.map(x=>`<option ${x===mv?"selected":""}>${esc(x)}</option>`).join("");
 $("dashDoor").innerHTML='<option value="">All Doors</option>'+doors.map(x=>`<option ${x===dv?"selected":""}>${esc(x)}</option>`).join("");
}
function selected(keys){let m=$("dashModel").value,d=$("dashDoor").value;return keys.filter(x=>(!m||splitKey(x).model===m)&&(!d||splitKey(x).door===d))}
function autoLoss(){return S.plan?.masterSnapshot?.palletChangeLosses||[]}
function lossRows(){return [...autoLoss().map(x=>({...x,category:x.category||"Pallet Change"})),...S.manual]}
function render(){
 let P=rowsFromPlan();let A=actualRows();let keys=[...new Set([...Object.keys(P),...Object.keys(A)])];S.keys=keys;filters(keys);let use=selected(keys);
 let n=Math.max(0,...use.flatMap(x=>[(P[x]||[]).length,(A[x]||[]).length])), labels=[];
 let bs=blocks();for(let i=0;i<n;i++)labels.push(bs[i]?(bs[i].label||`${bs[i].start||bs[i].startTime||""}–${bs[i].end||bs[i].endTime||""}`):`Block ${i+1}`);
 let pb=Array(n).fill(0),ab=Array(n).fill(0);use.forEach(x=>{for(let i=0;i<n;i++){pb[i]+=Number(P[x]?.[i]||0);
  // นับ Actual เฉพาะ Model/Door ที่ยังอยู่ใน Plan ปัจจุบัน — กัน key เก่าที่
  // ค้างมาจากก่อนเปลี่ยนชื่อ Model ใน Master ไม่ให้บวกเข้าไปในยอดรวมซ้ำซ้อน
  if(P[x])ab[i]+=Number(A[x]?.[i]||0);
 }});
 // gapPlan = เทียบ Adjusted Plan เต็มกะ (secondary, ใต้ Adjusted Plan) — ยังคง
 // สูตรเดิมไว้ ไม่ลบทิ้ง แค่ลดความเด่น
 // gapExpected = เทียบ Expected Now (real-time pacing) — ตัวหลักที่โชว์เด่น
 // ใน Header/Primary KPI ตามที่ยืนยันไว้ (spec §1 + §13 — สองค่านี้คนละความหมาย
 // กัน ไม่ได้แก้สูตร Plan/Actual/Expected เดิมเลย แค่เพิ่มค่าที่ derive จากของ
 // ที่มีอยู่แล้วและเปลี่ยนว่าตัวไหนโชว์เด่นกว่า)
 let plan=pb.reduce((a,b)=>a+b,0),actual=ab.reduce((a,b)=>a+b,0),gapPlan=actual-plan,ach=plan?actual/plan*100:0,loss=lossRows().filter(x=>x.category!=="Material").reduce((s,x)=>s+Number(x.minutes||0),0),material=lossRows().filter(x=>x.category==="Material").reduce((s,x)=>s+Number(x.minutes||0),0);
 let expected=expectedByNow(pb,bs,$("dashDate").value);
 let gapExpected=actual-expected;
 let status=expected>0?(actual>=expected?"ON TARGET":"BEHIND PLAN"):"ON TARGET";
 let lineName=S.lines.find(x=>(x.lineId||x.code||x.id||"").toUpperCase()===$("dashLine").value.toUpperCase())?.lineName||$("dashLine").value;
 let contextLine=`LINE ${lineName} · ${$("dashShift").value} SHIFT · ${formatContextDate($("dashDate").value)}`;
 statusBanner(status,actual,expected,gapExpected,ach,contextLine);
 insightBanner(P,A,use,loss,material);
 primaryKpis(expected,actual,gapExpected,ach,plan,gapPlan);
 lossSummaryCard(loss,material);
 mostAffectedCard(P,A,use);
 actionCard();
 top3BehindPlanCard(P,A,use);
 achievementBar(plan,actual,ach);
 thisBlockCard(labels,pb,ab,bs,$("dashDate").value,P,A,use);
 charts(labels,pb,ab); performance(P,A,use); lossView(); S.hourlyArgs={labels,bs,P,A,use}; S.todayAch=ach;S.todayMaterial=material; hourlySummary(); note(`Dashboard loaded · ${$("dashDate").value} · Line ${$("dashLine").value} / ${$("dashShift").value}`,"plan-ok");
}
function achievementBar(plan,actual,ach){
 let host=$("dashAchievementBar");
 if(!host)return;
 if(!plan){host.innerHTML="";return}
 let pct=Math.min(100,Math.max(0,ach));
 let remaining=Math.max(plan-actual,0);
 let sub=actual>=plan?"Plan achieved":`${remaining.toLocaleString()} pcs remaining to Plan`;
 host.innerHTML=`<div class="dash-ach-head"><span>Achievement</span><b>${ach.toFixed(1)}%</b></div><div class="dash-ach-track"><div class="dash-ach-fill${ach>=100?" full":""}" style="width:${pct}%"></div></div><div class="dash-ach-sub">${sub}</div>`;
}
function hourlySummary(){
 let host=$("dashHourly"),sel=$("dashHourlySelect");
 if(!host||!S.hourlyArgs)return;
 let {labels,bs,P,A,use}=S.hourlyArgs;
 // Populate the block picker (WORK blocks only) — keep whatever was already
 // selected if it's still a valid option after reloading.
 if(sel){
  let keepVal=sel.value;
  let opts=['<option value="ALL">ทุกช่วงเวลา</option>'];
  for(let i=0;i<labels.length;i++)if(bs[i]?.type!=="BREAK")opts.push(`<option value="${i}">${esc(labels[i]||"")}</option>`);
  sel.innerHTML=opts.join("");
  if([...sel.options].some(o=>o.value===keepVal))sel.value=keepVal;
 }
 let want=sel?sel.value:"ALL";
 let n=labels.length,h="";
 for(let i=0;i<n;i++){
  if(bs[i]?.type==="BREAK")continue;
  if(want!=="ALL"&&String(i)!==want)continue;
  let rows=(use||[]).map(x=>{let pv=Number(P[x]?.[i]||0),av=Number(A[x]?.[i]||0);return {x,p:pv,a:av,d:av-pv}}).filter(r=>r.p||r.a);
  if(!rows.length)continue;
  rows.sort((r1,r2)=>r1.d-r2.d);
  let tp=rows.reduce((s,r)=>s+r.p,0),ta=rows.reduce((s,r)=>s+r.a,0),td=ta-tp;
  h+=`<div class="dash-hour-block"><div class="dash-hour-block-title">${esc(labels[i]||"")}</div><div class="table-scroll"><table class="grid mobile-cards"><thead><tr><th>Model</th><th>Door</th><th>Plan</th><th>Actual</th><th>Diff</th></tr></thead><tbody>`;
  rows.forEach(r=>{let q=splitKey(r.x);h+=`<tr><td data-label="Model">${esc(q.model)}</td><td data-label="Door">${esc(q.door)}</td><td data-label="Plan">${r.p}</td><td data-label="Actual"><b>${r.a}</b></td><td data-label="Diff" class="${r.d<0?"kpi-bad":"kpi-good"}">${r.d>0?"+":""}${r.d}</td></tr>`});
  h+=`<tr class="dash-this-block-total"><td colspan="2" data-label="">Total</td><td data-label="Plan">${tp}</td><td data-label="Actual"><b>${ta}</b></td><td data-label="Diff" class="${td<0?"kpi-bad":"kpi-good"}">${td>0?"+":""}${td}</td></tr>`;
  h+=`</tbody></table></div></div>`;
 }
 host.innerHTML=h||'<div class="empty-state">ไม่มีข้อมูล</div>';
}
function statusBanner(status,actual,expected,gapExpected,ach,contextLine){
 let ok=status==="ON TARGET";
 let host=$("dashStatusBanner");
 if(!host)return;
 host.className="dash-status-banner "+(ok?"kpi-good-bg":"kpi-bad-bg");
 let ctx=contextLine?`<div class="dash-status-context">${esc(contextLine)}</div>`:"";
 host.innerHTML=`${ctx}<div class="dash-status-main"><span class="dash-status-icon">${ok?"🟢":"🔴"}</span><span class="dash-status-text">${status}</span></div><div class="dash-status-sub">Actual ${actual.toLocaleString()} / Expected (Now) ${Math.round(expected).toLocaleString()}</div>`;
}
function currentBlockIndex(bs,viewDate){
 // "Current block" only makes sense when looking at TODAY — a past/future
 // date has no "now" inside its own timeline.
 if(viewDate!==localDate()||!bs.length)return -1;
 let u=unwrapBlockTimes(bs),now=nowMinutes();
 if(now<u[0].startU)now+=1440;
 for(let i=0;i<u.length;i++)if(now>=u[i].startU&&now<u[i].endU)return i;
 return -1;
}
function thisBlockCard(labels,pb,ab,bs,viewDate,P,A,use){
 let host=$("dashThisBlock"),tableHost=$("dashThisBlockTable");
 if(!host)return;
 let idx=currentBlockIndex(bs,viewDate);
 if(idx<0||bs[idx]?.type==="BREAK"){
  host.innerHTML="";host.style.display="none";
  if(tableHost){tableHost.innerHTML="";tableHost.style.display="none"}
  return;
 }
 let p=Number(pb[idx]||0),a=Number(ab[idx]||0),d=a-p;
 host.style.display="block";
 host.innerHTML=`<div class="dash-this-block-label">THIS BLOCK · ${esc(labels[idx]||"")}</div><div class="dash-this-block-nums"><span>Plan <b>${p}</b></span><span>Actual <b>${a}</b></span><span class="dash-this-block-diff ${d<0?"kpi-bad":"kpi-good"}">Diff <b>${d>0?"+":""}${d}</b></span></div>`;
 if(!tableHost)return;
 // Per-Model/Door breakdown for just this one block — worst Diff first, so
 // whichever model is dragging this hour down shows up right at the top.
 let rows=(use||[]).map(x=>{
  let pv=Number(P[x]?.[idx]||0),av=Number(A[x]?.[idx]||0);
  return {x,p:pv,a:av,d:av-pv};
 }).filter(r=>r.p||r.a);
 if(!rows.length){tableHost.innerHTML="";tableHost.style.display="none";return}
 rows.sort((r1,r2)=>r1.d-r2.d);
 let h=`<div class="table-scroll"><table class="grid mobile-cards"><thead><tr><th>Model</th><th>Door</th><th>Plan</th><th>Actual</th><th>Diff</th></tr></thead><tbody>`;
 rows.forEach(r=>{let q=splitKey(r.x);h+=`<tr><td data-label="Model">${esc(q.model)}</td><td data-label="Door">${esc(q.door)}</td><td data-label="Plan">${r.p}</td><td data-label="Actual"><b>${r.a}</b></td><td data-label="Diff" class="${r.d<0?"kpi-bad":"kpi-good"}">${r.d>0?"+":""}${r.d}</td></tr>`});
 h+=`<tr class="dash-this-block-total"><td colspan="2" data-label="">Total</td><td data-label="Plan">${p}</td><td data-label="Actual"><b>${a}</b></td><td data-label="Diff" class="${d<0?"kpi-bad":"kpi-good"}">${d>0?"+":""}${d}</td></tr>`;
 h+=`</tbody></table></div>`;
 tableHost.style.display="block";
 tableHost.innerHTML=h;
}
let datalabelsRegistered=false;
function ensureDatalabels(){
 if(!datalabelsRegistered&&window.ChartDataLabels){Chart.register(window.ChartDataLabels);datalabelsRegistered=true}
}
function charts(labels,p,a){
 ensureDatalabels();
 if(S.hourly)S.hourly.destroy();if(S.cum)S.cum.destroy();
 const planColor="#64748b",actualColor="#2563eb";
 S.hourly=new Chart($("hourlyChart"),{type:"bar",data:{labels,datasets:[{label:"Adjusted Plan",data:p,backgroundColor:planColor,borderColor:planColor,borderRadius:3},{label:"Actual",data:a,backgroundColor:actualColor,borderColor:actualColor,borderRadius:3}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true}},plugins:{datalabels:{display:false},tooltip:{mode:"index",intersect:false,callbacks:{
  title:items=>items.length?labels[items[0].dataIndex]:"",
  filter:()=>false,
  afterBody:items=>{
   if(!items.length)return[];
   let i=items[0].dataIndex,pv=Number(p[i]||0),av=Number(a[i]||0),gap=av-pv;
   return [`Plan: ${pv.toLocaleString()}`,`Actual: ${av.toLocaleString()}`,`Gap: ${gap>0?"+":""}${gap.toLocaleString()}`];
  }
 }}}}});
 let cp=[],ca=[],x=0,y=0;p.forEach(v=>cp.push(x+=v));a.forEach(v=>ca.push(y+=v));
 S.cum=new Chart($("cumChart"),{type:"line",data:{labels,datasets:[{label:"Cumulative Plan",data:cp,tension:.25,borderColor:planColor,backgroundColor:planColor,pointRadius:2},{label:"Cumulative Actual",data:ca,tension:.25,borderColor:actualColor,backgroundColor:actualColor,pointRadius:2}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true}},plugins:{datalabels:{display:false}}}});
}
function statusBadge(gap){
 // Same thresholds as before (gap>=0 / gap>=-20 / gap<-20) — only the
 // presentation changed, from an emoji dot to a labeled subtle badge.
 if(gap>=0)return '<span class="status-badge status-good">ON TARGET</span>';
 if(gap>=-20)return '<span class="status-badge status-watch">WATCH</span>';
 return '<span class="status-badge status-bad">BEHIND PLAN</span>';
}
function achClass(z){return z>=100?"kpi-good":z>=95?"kpi-watch":"kpi-bad"}
function plannedRowsSorted(P,A,use){
 // Shared by the full Model/Door Performance table AND the compact Top-3
 // card — Plan>0 only (unplanned extra production never counts as "worst"),
 // worst Achievement% first. Single source of truth so both views agree.
 return use.map(x=>{let p=(P[x]||[]).reduce((a,b)=>a+Number(b||0),0),a=(A[x]||[]).reduce((a,b)=>a+Number(b||0),0);return {x,p,a,g:a-p,z:p?a/p*100:0}})
  .filter(r=>r.p>0).sort((r1,r2)=>r1.z-r2.z);
}
const MONTHS_EN=["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
function formatContextDate(dateStr){
 let [y,m,d]=String(dateStr||"").split("-").map(Number);
 if(!y||!m||!d)return dateStr||"";
 return `${d} ${MONTHS_EN[m-1]||""} ${y}`;
}
// ข้อเสนอแนะสั้นๆ ต่อ Loss category — ใครควรถูกตามก่อนเมื่อ category นี้เป็นสาเหตุหลัก
const CATEGORY_ACTIONS={
 "Material":"→ ติดต่อฝ่ายคลัง/จัดซื้อ ตรวจสอบ Lead Time วัตถุดิบ",
 "Machine":"→ แจ้งฝ่ายซ่อมบำรุง ตรวจเครื่องจักร",
 "Robot":"→ แจ้งทีม Automation ตรวจ Robot",
 "Jig":"→ ตรวจสอบ Jig/อุปกรณ์จับยึด",
 "Pallet Change":"→ ทบทวนแผนเปลี่ยน Pallet ระหว่างกะ กับหัวหน้าไลน์",
};
function topLossCategory(){
 let byCat={};
 lossRows().forEach(x=>{let c=x.category||"Other";byCat[c]=(byCat[c]||0)+Number(x.minutes||0)});
 let entries=Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
 return {entries,total:entries.reduce((s,[,v])=>s+v,0),top:entries[0]?entries[0][0]:null,topMin:entries[0]?entries[0][1]:0};
}
function insightBanner(P,A,use,loss,material){
 let host=$("dashInsightBanner");
 if(!host)return;
 // สาเหตุหลัก: เทียบทุก Loss category (รวม Material ด้วย) หา category ที่กิน
 // เวลามากที่สุด — ไม่ใช่แค่ Material vs รวม Loss อื่น เผื่อวันไหน Machine/Jig
 // เป็นตัวการหลักแทน
 let {entries:catEntries,total:totalLossAllCats,top:topCatShared,topMin:topMinShared}=topLossCategory();
 // ตัวร้ายจริง: เฉพาะ Model/Door ที่ "มีแผน" (p>0) — ไม่เอาแถวที่ไม่ได้วางแผนไว้
 // (ซึ่งเป็นของแถมที่ทีมงานผลิตเสริม ไม่ใช่ปัญหา) มาปนเป็นตัวร้ายอันดับ 1
 let worst=use.map(x=>{
  let p=(P[x]||[]).reduce((a,b)=>a+Number(b||0),0),a=(A[x]||[]).reduce((a,b)=>a+Number(b||0),0);
  return {x,p,a,g:a-p,z:p?a/p*100:0};
 }).filter(r=>r.p>0).sort((r1,r2)=>r1.z-r2.z)[0];
 if(!catEntries.length&&!worst){host.innerHTML="";return}
 let parts=[];
 let topCat=topCatShared;
 if(catEntries.length){
  let pct=totalLossAllCats?Math.round(topMinShared/totalLossAllCats*100):0;
  parts.push(`สาเหตุหลัก: <b>${esc(topCat)} ${topMinShared} นาที</b> (${pct}% ของเวลาที่เสียทั้งหมด)`);
 }
 if(worst){
  let q=splitKey(worst.x);
  parts.push(`รุ่นที่กระทบหนักสุด: <b>${esc(q.model)} ${esc(q.door)}</b> (${worst.g>0?"+":""}${worst.g.toLocaleString()} ชิ้น, ${worst.z.toFixed(0)}%)`);
 }
 let action=topCat&&CATEGORY_ACTIONS[topCat]?`<span class="dash-insight-action">${esc(CATEGORY_ACTIONS[topCat])}</span>`:"";
 host.innerHTML=`<span class="dash-insight-icon">💡</span><span class="dash-insight-text">${parts.join(" · ")}${action}</span>`;
}
function performance(P,A,keys){
 if(!keys.length){$("performanceTable").innerHTML='<div class="empty-state">ไม่มี Model/Door สำหรับตัวกรองนี้</div>';return}
 let all=keys.map(x=>{let p=(P[x]||[]).reduce((a,b)=>a+Number(b||0),0),a=(A[x]||[]).reduce((a,b)=>a+Number(b||0),0);return {x,p,a,g:a-p,z:p?a/p*100:0}});
 // แยก 2 กลุ่ม: มีแผน (p>0) เรียง Achievement ต่ำสุดก่อน = ตัวที่แย่จริงต้อง
 // แก้ก่อน — กับ ไม่มีแผน (p=0) ที่ทำเพิ่มนอกแผน เรียง Actual มากสุดก่อน ไม่ให้
 // มาปนอยู่บนสุดจนบังตัวร้ายจริง (เพราะ Achievement คำนวณไม่ได้เมื่อ Plan=0)
 let planned=plannedRowsSorted(P,A,keys);
 let unplanned=all.filter(r=>r.p===0).sort((r1,r2)=>r2.a-r1.a);
 let rowHtml=r=>{let q=splitKey(r.x);return `<tr><td data-label="Model">${esc(q.model)}</td><td data-label="Door">${esc(q.door)}</td><td data-label="Plan">${r.p}</td><td data-label="Actual"><b>${r.a}</b></td><td data-label="Gap" class="${r.g<0?"kpi-bad":"kpi-good"}">${r.g>0?"+":""}${r.g}</td><td data-label="Ach." class="${r.p?achClass(r.z):""}">${r.p?r.z.toFixed(1)+"%":"—"}</td><td data-label="Status">${r.p?statusBadge(r.g):"—"}</td></tr>`};
 let h='<div class="table-scroll"><table class="grid mobile-cards"><thead><tr><th>Model</th><th>Door</th><th>Plan</th><th>Actual</th><th>Gap</th><th>Ach.</th><th>Status</th></tr></thead><tbody>';
 planned.forEach(r=>h+=rowHtml(r));
 if(unplanned.length){
  h+=`<tr><td colspan="7" class="dash-perf-divider">นอกแผน (ผลิตเพิ่มนอกแผนวันนี้)</td></tr>`;
  unplanned.forEach(r=>h+=rowHtml(r));
 }
 let rows=all,tp=rows.reduce((s,r)=>s+r.p,0),ta=rows.reduce((s,r)=>s+r.a,0),tg=ta-tp,tz=tp?ta/tp*100:0;
 h+=`<tr class="dash-this-block-total"><td data-label="">TOTAL</td><td data-label=""></td><td data-label="Plan">${tp}</td><td data-label="Actual"><b>${ta}</b></td><td data-label="Gap" class="${tg<0?"kpi-bad":"kpi-good"}">${tg>0?"+":""}${tg}</td><td data-label="Ach." class="${tp?achClass(tz):""}">${tz.toFixed(1)}%</td><td data-label="Status">${tp?statusBadge(tg):"—"}</td></tr>`;
 h+='</tbody></table></div>';$("performanceTable").innerHTML=h;
}
function primaryKpis(expected,actual,gapExpected,ach,plan,gapPlan){
 let host=$("dashPrimaryKpis");
 if(host)host.innerHTML=`<div class="dash-pkpi"><small>EXPECTED NOW</small><b>${Math.round(expected).toLocaleString()}</b></div><div class="dash-pkpi dash-pkpi-actual"><small>ACTUAL</small><b>${actual.toLocaleString()}</b></div><div class="dash-pkpi"><small>GAP</small><b class="${gapExpected<0?"kpi-bad":"kpi-good"}">${gapExpected>0?"+":""}${gapExpected.toLocaleString()}</b><span class="dash-pkpi-ref">vs Expected Now</span></div><div class="dash-pkpi dash-pkpi-actual"><small>ACHIEVEMENT</small><b class="${achClass(ach)}">${ach.toFixed(1)}%</b><span class="dash-pkpi-ref">vs Adjusted Plan · full shift</span></div>`;
 // Adjusted Plan demoted to a small secondary caption (still visible, not
 // competing visually with Expected Now) — reuses the old #dashKpis host.
 let sec=$("dashKpis");
 if(sec)sec.innerHTML=`<span>Adjusted Plan (full shift): <b>${plan.toLocaleString()}</b></span><span class="dash-secondary-sep">·</span><span>vs Adjusted Plan: <b class="${gapPlan<0?"kpi-bad":"kpi-good"}">${gapPlan>0?"+":""}${gapPlan.toLocaleString()}</b></span>`;
}
function lossSummaryCard(loss,material){
 let host=$("dashLossSummary");
 if(!host)return;
 let {entries,total}=topLossCategory();
 if(!entries.length){host.innerHTML='<h3>MAIN LOSS</h3><div class="empty-state">No production loss recorded</div>';return}
 let [topName,topMin]=entries[0];
 let pct=total?Math.round(topMin/total*100):0;
 let top3=entries.slice(0,3);
 host.innerHTML=`<h3>MAIN LOSS</h3>
  <div class="dash-main-loss"><div class="dash-main-loss-name">${esc(topName)}</div><div class="dash-main-loss-num">${topMin} min <span>· ${pct}% of Total Loss</span></div></div>
  <div class="dash-loss-total">TOTAL LOSS: <b>${total} min</b></div>
  <div class="dash-loss-top3">${top3.map(([c,m],i)=>`<div class="dash-loss-top3-row"><span>${i+1}. ${esc(c)}</span><b>${m} min</b><small>${total?Math.round(m/total*100):0}%</small></div>`).join("")}</div>`;
}
function mostAffectedCard(P,A,use){
 let host=$("dashMostAffected");
 if(!host)return;
 let worst=plannedRowsSorted(P,A,use)[0];
 if(!worst){host.innerHTML='<h3>MOST AFFECTED</h3><div class="empty-state">No planned Model/Door behind today</div>';return}
 let q=splitKey(worst.x);
 host.innerHTML=`<h3>MOST AFFECTED</h3>
  <div class="dash-affected-name">${esc(q.model)} <small>${esc(q.door)}</small></div>
  <div class="dash-affected-nums">
   <span>Plan <b>${worst.p.toLocaleString()}</b></span>
   <span>Actual <b>${worst.a.toLocaleString()}</b></span>
   <span>Gap <b class="${worst.g<0?"kpi-bad":"kpi-good"}">${worst.g>0?"+":""}${worst.g.toLocaleString()}</b></span>
   <span>Achievement <b class="${achClass(worst.z)}">${worst.z.toFixed(1)}%</b></span>
  </div>`;
}
function actionCard(){
 let host=$("dashActionCard");
 if(!host)return;
 let {top:topCat}=topLossCategory();
 if(!topCat){host.innerHTML="";return}
 let action=CATEGORY_ACTIONS[topCat]||"→ ตรวจสอบสาเหตุเพิ่มเติมกับหัวหน้ากะ";
 host.innerHTML=`<div class="dash-action-strip">
  <span class="dash-action-strip-label">ACTION</span>
  <span class="dash-action-strip-cat">${esc(topCat)}</span>
  <span class="dash-action-strip-text">${esc(action)}</span>
  <span class="dash-action-strip-meta">Owner: — · Status: — · ETA: —</span>
 </div>`;
}
function top3BehindPlanCard(P,A,use){
 let host=$("dashTop3");
 if(!host)return;
 // อันดับตาม Gap (ชิ้น) ไม่ใช่ Achievement% — ต่างจากตาราง Performance หลัก
 // ที่เรียงตาม Achievement — ที่นี่ต้องการ "กระทบยอดรวมมากสุด" ไม่ใช่
 // "สัดส่วนพลาดมากสุด" ตัวเลข pcs ที่หายไปเยอะสุดสำคัญกว่าสำหรับสรุปผู้บริหาร
 let rows=[...plannedRowsSorted(P,A,use)].sort((r1,r2)=>r1.g-r2.g).slice(0,3);
 if(!rows.length){host.innerHTML='<h3>TOP 3 BEHIND PLAN</h3><div class="empty-state">No planned Model/Door behind today</div>';return}
 host.innerHTML=`<h3>TOP 3 BEHIND PLAN</h3><div class="dash-top3-list">${rows.map((r,i)=>{let q=splitKey(r.x);return `<div class="dash-top3-row"><span class="dash-top3-rank">${i+1}</span><span class="dash-top3-name">${esc(q.model)} <small>${esc(q.door)}</small></span><b class="${r.g<0?"kpi-bad":"kpi-good"}">${r.g>0?"+":""}${r.g.toLocaleString()} pcs</b></div>`}).join("")}</div>`;
}
function lossView(){
 let rows=lossRows(),t={};
 rows.forEach(x=>{let c=x.category||"Other";(t[c]??=[]).push(x)});
 let groups=Object.entries(t).map(([c,items])=>({c,items,total:items.reduce((s,x)=>s+Number(x.minutes||0),0)}));
 groups.sort((a,b)=>b.total-a.total);
 if(!groups.length){$("lossAnalysis").innerHTML='<div class="empty-state">No production loss recorded</div>';return}
 let max=Math.max(...groups.map(g=>g.total),1);
 let h='<div class="loss-pareto">';
 groups.forEach((g,gi)=>{
  let pct=Math.round(g.total/max*100);
  h+=`<div class="loss-pareto-row loss-cat-toggle" data-idx="${gi}">
   <span class="loss-pareto-chevron">▸</span>
   <div class="loss-pareto-label">${esc(g.c)}</div>
   <div class="loss-pareto-track"><div class="loss-pareto-fill" style="width:${pct}%"></div></div>
   <div class="loss-pareto-value">${g.total} min</div>
  </div>`;
 });
 h+='</div>';
 groups.forEach((g,gi)=>{
  let items=[...g.items].sort((a,b)=>String(a.start||"").localeCompare(String(b.start||"")));
  h+=`<div class="loss-cat-detail" id="lossCatDetail${gi}" style="display:none">`;
  items.forEach(x=>h+=`<div class="loss-detail-row"><span>${esc(x.start||"")}–${esc(x.end||"")}</span><b>${x.minutes} min</b>${x.remark?`<small>${esc(x.remark)}</small>`:""}</div>`);
  h+=`</div>`;
 });
 $("lossAnalysis").innerHTML=h;
 groups.forEach((g,gi)=>{
  let chip=document.querySelector(`.loss-cat-toggle[data-idx="${gi}"]`),detail=$(`lossCatDetail${gi}`);
  if(!chip||!detail)return;
  chip.onclick=()=>{let open=detail.style.display!=="none";detail.style.display=open?"none":"block";chip.classList.toggle("open",!open)};
 });
}
async function load(){
 let d=$("dashDate").value,l=$("dashLine").value.toUpperCase(),sh=$("dashShift").value;ProdV2Context.set({date:d,lineId:l,shift:sh});stat("Loading...");
 try{
  let [p,a,loss]=await Promise.all([
   ProdV2DB.collection("prodV2_dailyPlans").doc(`plan_${d}_${l}_${sh}`).get(),
   ProdV2DB.collection("prodV2_actualLogs").doc(`actual_${d}_${l}_${sh}`).get(),
   ProdV2DB.collection("prodV2_lossLogs").where("date","==",d).where("lineId","==",l).where("shift","==",sh).get()
  ]);
  S.plan=p.exists?{id:p.id,...p.data()}:null;S.actual=a.exists?{id:a.id,...a.data()}:null;S.manual=loss.docs.map(x=>({id:x.id,...x.data()}));
  if(!S.plan)note("ไม่พบ Saved Daily Plan สำหรับชุดนี้","plan-warn");render();stat("Loaded","ok");
  trendCompare(d,l,sh);otherLinesToday(d,sh,l);
 }catch(e){console.error(e);note(e.message,"plan-warn");stat("Load failed","err")}
}
async function trendCompare(d,l,sh){
 // ค่าเฉลี่ย Achievement / Material ของ 7 วันย้อนหลัง (ไม่รวมวันนี้) เทียบกับ
 // ของวันนี้ — บอกว่าวันนี้แย่กว่าปกติจริง หรือเป็นสภาพปกติที่เกิดทุกสัปดาห์
 // อยู่แล้ว ยิงแยกจาก render() หลัก เพราะต้องอ่านย้อนหลัง 7 วัน (ช้ากว่า) และ
 // ไม่ควรบล็อกไม่ให้ตัวเลขหลักของวันนี้ขึ้นก่อน
 let host=$("dashTrendLine");
 if(!host)return;
 host.innerHTML="";
 try{
  let days=[];for(let i=1;i<=7;i++)days.push(addDays(d,-i));
  let rows=await Promise.all(days.map(async dt=>{
   let [p,a,loss]=await Promise.all([
    ProdV2DB.collection("prodV2_dailyPlans").doc(`plan_${dt}_${l}_${sh}`).get(),
    ProdV2DB.collection("prodV2_actualLogs").doc(`actual_${dt}_${l}_${sh}`).get(),
    ProdV2DB.collection("prodV2_lossLogs").where("date","==",dt).where("lineId","==",l).where("shift","==",sh).get()
   ]);
   if(!p.exists)return null;
   let plan=(p.data().blocks||[]).reduce((s,b)=>s+(b.cells||[]).reduce((s2,c)=>s2+Number(c.plan||0),0),0);
   let cells=a.exists?(a.data().actualByCell||{}):{};
   let actual=Object.values(cells).reduce((s,v)=>s+Number(v||0),0);
   let material=loss.docs.map(x=>x.data()).filter(x=>x.category==="Material").reduce((s,x)=>s+Number(x.minutes||0),0);
   return {plan,actual,material};
  }));
  let valid=rows.filter(Boolean);
  if(!valid.length||S.todayAch==null)return;
  let avgAch=valid.reduce((s,r)=>s+(r.plan?r.actual/r.plan*100:0),0)/valid.length;
  let avgMaterial=valid.reduce((s,r)=>s+r.material,0)/valid.length;
  let achDiff=S.todayAch-avgAch;
  let achArrow=achDiff>=0?"↑":"↓";
  let achTxt=`<div class="dash-trend-headline ${achDiff>=0?"kpi-good":"kpi-bad"}">${achArrow} ${Math.abs(achDiff).toFixed(1)} pts</div><div class="dash-trend-detail">Today: <b>${S.todayAch.toFixed(1)}%</b> · 7-Day Avg: <b>${avgAch.toFixed(1)}%</b></div>`;
  let matTxt="";
  if(avgMaterial>0){
   let ratio=S.todayMaterial/avgMaterial;
   matTxt=`<div class="dash-trend-detail dash-trend-material">Material Today: <b>${S.todayMaterial.toFixed(0)} min</b> · 7-Day Avg: <b>${avgMaterial.toFixed(0)} min</b> ${ratio>=1?`<span class="kpi-bad">↑ ${ratio.toFixed(1)}×</span>`:`<span class="kpi-good">↓ lower</span>`}</div>`;
  }
  host.innerHTML=`${achTxt}${matTxt}`;
 }catch(e){console.error(e)}
}
async function otherLinesToday(d,sh,currentLineId){
 // สรุป Achievement ของทุก Line วันเดียวกัน/กะเดียวกัน แบบย่อในหน้า Dashboard
 // เอง กันต้องสลับไปหน้า Executive Summary เพื่อเทียบ Line ระหว่างพรีเซนต์สด
 let host=$("dashOtherLines");
 if(!host)return;
 host.innerHTML="";
 try{
  let lines=S.lines.length?S.lines:(await all("prodV2_lines")).filter(x=>x.active!==false);
  let rows=await Promise.all(lines.map(async ln=>{
   let lid=(ln.lineId||ln.code||ln.id||"").toUpperCase();
   let [p,a]=await Promise.all([
    ProdV2DB.collection("prodV2_dailyPlans").doc(`plan_${d}_${lid}_${sh}`).get(),
    ProdV2DB.collection("prodV2_actualLogs").doc(`actual_${d}_${lid}_${sh}`).get()
   ]);
   if(!p.exists)return {lid,name:ln.lineName||ln.name||lid,plan:0,actual:0,ach:0};
   let plan=(p.data().blocks||[]).reduce((s,b)=>s+(b.cells||[]).reduce((s2,c)=>s2+Number(c.plan||0),0),0);
   let cells=a.exists?(a.data().actualByCell||{}):{};
   let actual=Object.values(cells).reduce((s,v)=>s+Number(v||0),0);
   return {lid,name:ln.lineName||ln.name||lid,plan,actual,ach:plan?actual/plan*100:0};
  }));
  if(!rows.length)return;
  host.innerHTML=rows.map(r=>{let dot=!r.plan?"⚪":r.ach>=100?"🟢":r.ach>=95?"🟠":"🔴";return `<div class="dash-other-line-chip${r.lid===currentLineId?" current":""}"><span>${dot} ${esc(r.name)}</span><b class="${r.plan?achClass(r.ach):""}">${r.plan?r.ach.toFixed(1)+"%":"—"}</b>${r.lid===currentLineId?'<small>← CURRENT</small>':""}</div>`}).join("");
 }catch(e){console.error(e)}
}
async function init(){
 $("dashDate").value=localDate();$("dashModel").onchange=render;$("dashDoor").onchange=render;
 // เปลี่ยน Date/Line/Shift แล้วโหลดใหม่ทันที ไม่ต้องกด Load Dashboard เอง —
 // ปุ่มยังอยู่เผื่ออยากรีเฟรชข้อมูลซ้ำที่ตัวกรองเดิม (เช่น มีคนกรอก Actual เพิ่มระหว่างเปิดหน้าไว้)
 $("dashDate").onchange=load;$("dashLine").onchange=load;$("dashShift").onchange=load;
 $("dashHourlyToggle")?.addEventListener("click",()=>{
  let open=$("dashHourly").style.display!=="none";
  $("dashHourly").style.display=open?"none":"block";
  $("dashHourlyToggle").textContent=open?"ดูสรุปรายชั่วโมง":"ซ่อนสรุปรายชั่วโมง";
 });
 $("dashHourlySelect")?.addEventListener("change",hourlySummary);
 try{S.lines=(await all("prodV2_lines")).filter(x=>x.active!==false).sort((a,b)=>(a.order||99)-(b.order||99));$("dashLine").innerHTML=S.lines.map(x=>`<option value="${x.lineId||x.code||x.id}">${esc(x.lineName||x.name||"Line "+(x.lineId||x.code||x.id))}</option>`).join("");let c=ProdV2Context.get();if(c.date)$("dashDate").value=c.date;if(c.lineId&&[...$("dashLine").options].some(o=>o.value===c.lineId))$("dashLine").value=c.lineId;if(c.shift)$("dashShift").value=c.shift;if($("dashDate").value&&$("dashLine").value&&$("dashShift").value)load()}catch(e){note(e.message,"plan-warn")}
}
addEventListener("DOMContentLoaded",init)})();