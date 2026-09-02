(()=>{const $=id=>document.getElementById(id);let S={lines:[],plan:null,actual:null,manual:[],hourly:null,cum:null,keys:[]};
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
function localDate(d=new Date()){const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
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
 let pb=Array(n).fill(0),ab=Array(n).fill(0);use.forEach(x=>{for(let i=0;i<n;i++){pb[i]+=Number(P[x]?.[i]||0);ab[i]+=Number(A[x]?.[i]||0)}});
 let plan=pb.reduce((a,b)=>a+b,0),actual=ab.reduce((a,b)=>a+b,0),gap=actual-plan,ach=plan?actual/plan*100:0,loss=lossRows().reduce((s,x)=>s+Number(x.minutes||0),0);
 let expected=expectedByNow(pb,bs,$("dashDate").value);
 let status=expected>0?(actual>=expected?"ON TARGET":"BEHIND PLAN"):"ON TARGET";
 statusBanner(status,actual,expected);
 $("dashKpis").innerHTML=`<div class="entry-kpi"><small>ADJUSTED PLAN</small><b>${plan.toLocaleString()}</b></div><div class="entry-kpi"><small>EXPECTED (NOW)</small><b>${Math.round(expected).toLocaleString()}</b></div><div class="entry-kpi"><small>ACTUAL</small><b>${actual.toLocaleString()}</b></div><div class="entry-kpi"><small>GAP</small><b class="${gap<0?"kpi-bad":"kpi-good"}">${gap>0?"+":""}${gap.toLocaleString()}</b></div><div class="entry-kpi"><small>ACHIEVEMENT</small><b>${ach.toFixed(1)}%</b></div><div class="entry-kpi"><small>LOSS</small><b>${loss} min</b></div>`;
 charts(labels,pb,ab); performance(P,A,use); lossView(); note(`Dashboard loaded · ${$("dashDate").value} · Line ${$("dashLine").value} / ${$("dashShift").value}`,"plan-ok");
}
function statusBanner(status,actual,expected){
 let ok=status==="ON TARGET";
 let host=$("dashStatusBanner");
 if(!host)return;
 host.className="dash-status-banner "+(ok?"kpi-good-bg":"kpi-bad-bg");
 host.innerHTML=`<span class="dash-status-icon">${ok?"🟢":"🔴"}</span><span class="dash-status-text">${status}</span><span class="dash-status-sub">Actual ${actual.toLocaleString()} / Expected (Now) ${Math.round(expected).toLocaleString()}</span>`;
}
function charts(labels,p,a){
 if(S.hourly)S.hourly.destroy();if(S.cum)S.cum.destroy();
 S.hourly=new Chart($("hourlyChart"),{type:"bar",data:{labels,datasets:[{label:"Adjusted Plan",data:p},{label:"Actual",data:a}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true}}}});
 let cp=[],ca=[],x=0,y=0;p.forEach(v=>cp.push(x+=v));a.forEach(v=>ca.push(y+=v));
 S.cum=new Chart($("cumChart"),{type:"line",data:{labels,datasets:[{label:"Cumulative Plan",data:cp,tension:.25},{label:"Cumulative Actual",data:ca,tension:.25}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true}}}});
}
function performance(P,A,keys){
 if(!keys.length){$("performanceTable").innerHTML='<div class="empty-state">ไม่มี Model/Door สำหรับตัวกรองนี้</div>';return}
 // Worst-Achievement-first — so the thing most in need of attention is always
 // at the top, instead of a fixed Model order the reader has to scan through.
 let rows=keys.map(x=>{let p=(P[x]||[]).reduce((a,b)=>a+Number(b||0),0),a=(A[x]||[]).reduce((a,b)=>a+Number(b||0),0);return {x,p,a,g:a-p,z:p?a/p*100:0}});
 rows.sort((r1,r2)=>r1.z-r2.z);
 let h='<div class="table-scroll"><table class="grid"><thead><tr><th>Model</th><th>Door</th><th>Plan</th><th>Actual</th><th>Gap</th><th>Ach.</th></tr></thead><tbody>';
 rows.forEach(r=>{let q=splitKey(r.x);h+=`<tr><td>${esc(q.model)}</td><td>${esc(q.door)}</td><td>${r.p}</td><td><b>${r.a}</b></td><td class="${r.g<0?"kpi-bad":"kpi-good"}">${r.g>0?"+":""}${r.g}</td><td>${r.z.toFixed(1)}%</td></tr>`});h+='</tbody></table></div>';$("performanceTable").innerHTML=h;
}
function lossView(){let rows=lossRows(),t={};rows.forEach(x=>{let c=x.category||"Other";t[c]=(t[c]||0)+Number(x.minutes||0)});let arr=Object.entries(t).sort((a,b)=>b[1]-a[1]);$("lossAnalysis").innerHTML=arr.length?'<div class="loss-category-summary">'+arr.map(([c,m])=>`<div class="loss-cat"><span>${esc(c)}</span><b>${m} min</b></div>`).join("")+'</div>':'<div class="empty-state">ไม่มี Loss</div>'}
async function load(){
 let d=$("dashDate").value,l=$("dashLine").value.toUpperCase(),sh=$("dashShift").value;ProdV2Context.set({date:d,lineId:l,shift:sh});stat("Loading...");
 try{
  let [p,a,loss]=await Promise.all([
   ProdV2DB.collection("prodV2_dailyPlans").doc(`plan_${d}_${l}_${sh}`).get(),
   ProdV2DB.collection("prodV2_actualLogs").doc(`actual_${d}_${l}_${sh}`).get(),
   ProdV2DB.collection("prodV2_lossLogs").where("date","==",d).where("lineId","==",l).where("shift","==",sh).get()
  ]);
  S.plan=p.exists?{id:p.id,...p.data()}:null;S.actual=a.exists?{id:a.id,...a.data()}:null;S.manual=loss.docs.map(x=>({id:x.id,...x.data()}));
  if(!S.plan)note("ไม่พบ Saved Daily Plan สำหรับชุดนี้","plan-warn");render();stat("Loaded","ok")
 }catch(e){console.error(e);note(e.message,"plan-warn");stat("Load failed","err")}
}
async function init(){
 $("dashDate").value=localDate();$("dashLoadBtn").onclick=load;$("dashModel").onchange=render;$("dashDoor").onchange=render;
 try{S.lines=(await all("prodV2_lines")).filter(x=>x.active!==false).sort((a,b)=>(a.order||99)-(b.order||99));$("dashLine").innerHTML=S.lines.map(x=>`<option value="${x.lineId||x.code||x.id}">${esc(x.lineName||x.name||"Line "+(x.lineId||x.code||x.id))}</option>`).join("");let c=ProdV2Context.get();if(c.date)$("dashDate").value=c.date;if(c.lineId&&[...$("dashLine").options].some(o=>o.value===c.lineId))$("dashLine").value=c.lineId;if(c.shift)$("dashShift").value=c.shift;if(c.date&&c.lineId&&c.shift)load()}catch(e){note(e.message,"plan-warn")}
}
addEventListener("DOMContentLoaded",init)})();