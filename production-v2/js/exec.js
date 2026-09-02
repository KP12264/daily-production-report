(()=>{const $=id=>document.getElementById(id);
let S={lines:[],trendDays:7,trendChart:null,detailOpen:false};
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
const SHIFTS=["DAY","NIGHT"];
function localDate(d=new Date()){const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
function addDays(dateStr,n){let d=new Date(dateStr+"T12:00:00");d.setDate(d.getDate()+n);return localDate(d)}
function stat(t,c=""){$("execStatus").textContent=t;$("execStatus").className="hero-status "+c}
function note(t,c=""){$("execMessage").textContent=t;$("execMessage").className="notice info-notice "+c}
async function all(n){let s=await ProdV2DB.collection(n).get();return s.docs.map(d=>({id:d.id,...d.data()}))}
const k=(m,d)=>`${m}|||${d}`;
function splitKey(x){let p=String(x).split("|||");return {model:p[0]||"",door:p[1]||""}}

function actualTotalOf(doc){if(!doc)return 0;return Object.values(doc.actualByCell||{}).reduce((s,v)=>s+Number(v||0),0)}
function lossTotalOf(planDoc,manualRows){
 let auto=(planDoc?.masterSnapshot?.palletChangeLosses||[]).reduce((s,x)=>s+Number(x.minutes||0),0);
 let manual=(manualRows||[]).reduce((s,x)=>s+Number(x.minutes||0),0);
 return auto+manual;
}
// Fetch every Line × Shift combo for one date in parallel. Returns per-(line,shift)
// docs so callers can aggregate however they need (overall total, per-line, per
// model/door, loss-by-category, etc.) without re-fetching.
async function fetchDay(date,lines){
 let combos=[];lines.forEach(l=>SHIFTS.forEach(sh=>combos.push({lineId:l.lineId||l.code||l.id,shift:sh})));
 let docs=await Promise.all(combos.map(async c=>{
  let pid=`plan_${date}_${c.lineId}_${c.shift}`,aid=`actual_${date}_${c.lineId}_${c.shift}`;
  let [p,a]=await Promise.all([ProdV2DB.collection("prodV2_dailyPlans").doc(pid).get(),ProdV2DB.collection("prodV2_actualLogs").doc(aid).get()]);
  return {lineId:c.lineId,shift:c.shift,plan:p.exists?{id:p.id,...p.data()}:null,actual:a.exists?{id:a.id,...a.data()}:null};
 }));
 return docs;
}
async function fetchLoss(date,lines){
 let combos=[];lines.forEach(l=>SHIFTS.forEach(sh=>combos.push({lineId:l.lineId||l.code||l.id,shift:sh})));
 let rows=await Promise.all(combos.map(async c=>{
  let snap=await ProdV2DB.collection("prodV2_lossLogs").where("date","==",date).where("lineId","==",c.lineId).where("shift","==",c.shift).get();
  return snap.docs.map(x=>({id:x.id,...x.data()}));
 }));
 return combos.map((c,i)=>({...c,manual:rows[i]}));
}

function lineLabel(l){return l.lineName||l.name||"Line "+(l.lineId||l.code||l.id)}

async function loadToday(){
 let date=$("execDate").value;
 stat("Loading...");
 try{
  let [dayDocs,lossDocs]=await Promise.all([fetchDay(date,S.lines),fetchLoss(date,S.lines)]);
  renderHero(dayDocs);
  renderLineCards(dayDocs);
  renderLoss(dayDocs,lossDocs);
  renderDetail(dayDocs);
  note(`Executive Summary · ${date} · ทุก Line / ทุกกะ`,"plan-ok");
  stat("Loaded","ok");
 }catch(e){console.error(e);note(e.message,"plan-warn");stat("Load failed","err")}
}

function renderHero(dayDocs){
 let plan=dayDocs.reduce((s,d)=>s+Number(d.plan?.adjustedPlan||0),0);
 let actual=dayDocs.reduce((s,d)=>s+actualTotalOf(d.actual),0);
 let ach=plan?actual/plan*100:0,gap=actual-plan,status=plan&&actual>=plan?"ON TARGET":(plan?"BEHIND PLAN":"NO PLAN");
 $("execHero").innerHTML=`
  <div class="exec-hero-main">
   <div class="exec-hero-label">ACHIEVEMENT วันนี้ · ทุก Line รวมกัน</div>
   <div class="exec-hero-num ${ach>=100?'kpi-good':'kpi-bad'}">${ach.toFixed(1)}%</div>
   <div class="exec-hero-status ${status==='ON TARGET'?'kpi-good':'kpi-bad'}">${status}</div>
  </div>
  <div class="exec-hero-side">
   <div><small>ACTUAL</small><b>${actual.toLocaleString()}</b></div>
   <div><small>ADJUSTED PLAN</small><b>${plan.toLocaleString()}</b></div>
   <div><small>GAP</small><b class="${gap<0?'kpi-bad':'kpi-good'}">${gap>0?'+':''}${gap.toLocaleString()}</b></div>
  </div>`;
}

function renderLineCards(dayDocs){
 let byLine={};
 S.lines.forEach(l=>{let id=l.lineId||l.code||l.id;byLine[id]={label:lineLabel(l),plan:0,actual:0}});
 dayDocs.forEach(d=>{if(!byLine[d.lineId])return;byLine[d.lineId].plan+=Number(d.plan?.adjustedPlan||0);byLine[d.lineId].actual+=actualTotalOf(d.actual)});
 let cards=Object.values(byLine).map(x=>{
  let ach=x.plan?x.actual/x.plan*100:0,ok=x.plan&&x.actual>=x.plan;
  return `<div class="exec-line-card">
   <div class="exec-line-name">${esc(x.label)}</div>
   <div class="exec-line-ach ${x.plan?(ok?'kpi-good':'kpi-bad'):''}">${x.plan?ach.toFixed(1)+'%':'—'}</div>
   <div class="exec-line-sub">${x.actual.toLocaleString()} / ${x.plan.toLocaleString()}</div>
  </div>`;
 }).join("");
 $("execLineCards").innerHTML=cards||'<div class="empty-state">ไม่มี Line</div>';
}

function renderLoss(dayDocs,lossDocs){
 let totals={};
 dayDocs.forEach(d=>{(d.plan?.masterSnapshot?.palletChangeLosses||[]).forEach(x=>{let c=x.category||"Pallet Change";totals[c]=(totals[c]||0)+Number(x.minutes||0)})});
 lossDocs.forEach(d=>{(d.manual||[]).forEach(x=>{let c=x.category||"Other";totals[c]=(totals[c]||0)+Number(x.minutes||0)})});
 let arr=Object.entries(totals).sort((a,b)=>b[1]-a[1]);
 $("execLoss").innerHTML=arr.length?'<div class="loss-category-summary">'+arr.map(([c,m])=>`<div class="loss-cat"><span>${esc(c)}</span><b>${m} min</b></div>`).join("")+'</div>':'<div class="empty-state">ไม่มี Loss</div>';
}

function renderDetail(dayDocs){
 let P={},A={};
 dayDocs.forEach(d=>{
  (d.plan?.blocks||[]).forEach(b=>(b.cells||[]).forEach(c=>{let kk=k(c.model,c.door);P[kk]=(P[kk]||0)+Number(c.plan||0)}));
  Object.entries(d.actual?.actualByCell||{}).forEach(([cell,v])=>{let p=cell.split("|||"),kk=k(p[1],p[2]);A[kk]=(A[kk]||0)+Number(v||0)});
 });
 let keys=[...new Set([...Object.keys(P),...Object.keys(A)])].sort();
 if(!keys.length){$("execDetail").innerHTML='<div class="empty-state">ไม่มีข้อมูล Model/Door</div>';return}
 let h='<div class="table-scroll"><table class="grid"><thead><tr><th>Model</th><th>Door</th><th>Plan</th><th>Actual</th><th>Gap</th><th>Ach.</th></tr></thead><tbody>';
 keys.forEach(x=>{let p=P[x]||0,a=A[x]||0,g=a-p,z=p?a/p*100:0,q=splitKey(x);h+=`<tr><td>${esc(q.model)}</td><td>${esc(q.door)}</td><td>${p}</td><td><b>${a}</b></td><td class="${g<0?'kpi-bad':'kpi-good'}">${g>0?'+':''}${g}</td><td>${z.toFixed(1)}%</td></tr>`});
 h+='</tbody></table></div>';$("execDetail").innerHTML=h;
}

async function loadTrend(){
 let end=$("execDate").value,days=S.trendDays,labels=[],ach=[];
 $("trendMsg").textContent=`กำลังโหลดย้อนหลัง ${days} วัน…`;
 try{
  for(let i=days-1;i>=0;i--){
   let date=addDays(end,-i);
   let dayDocs=await fetchDay(date,S.lines);
   let plan=dayDocs.reduce((s,d)=>s+Number(d.plan?.adjustedPlan||0),0);
   let actual=dayDocs.reduce((s,d)=>s+actualTotalOf(d.actual),0);
   labels.push(date.slice(5));ach.push(plan?Math.round(actual/plan*1000)/10:null);
  }
  if(S.trendChart)S.trendChart.destroy();
  S.trendChart=new Chart($("trendChart"),{type:"line",data:{labels,datasets:[{label:"Achievement %",data:ach,tension:.25,spanGaps:true,borderColor:"#b45309",backgroundColor:"#b45309",pointRadius:3}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,suggestedMax:120}}}});
  $("trendMsg").textContent=`Achievement % ย้อนหลัง ${days} วัน (รวมทุก Line/กะ) · วันที่ไม่มี Saved Plan จะเว้นช่องว่าง`;
 }catch(e){console.error(e);$("trendMsg").textContent="โหลดเทรนด์ไม่สำเร็จ: "+e.message}
}

async function init(){
 $("execDate").value=localDate();
 $("execLoadBtn").onclick=loadToday;
 $("trend7Btn").onclick=()=>{S.trendDays=7;$("trend7Btn").classList.add("active");$("trend30Btn").classList.remove("active");loadTrend()};
 $("trend30Btn").onclick=()=>{S.trendDays=30;$("trend30Btn").classList.add("active");$("trend7Btn").classList.remove("active");loadTrend()};
 $("detailToggle").onclick=()=>{S.detailOpen=!S.detailOpen;$("execDetail").style.display=S.detailOpen?"":"none";$("detailToggle").textContent=S.detailOpen?"ซ่อนรายละเอียด Model/Door":"ดูรายละเอียด Model/Door"};
 try{
  S.lines=(await all("prodV2_lines")).filter(x=>x.active!==false).sort((a,b)=>(a.order||99)-(b.order||99));
  await loadToday();
  await loadTrend();
 }catch(e){console.error(e);note(e.message,"plan-warn")}
}
addEventListener("DOMContentLoaded",init)})();
