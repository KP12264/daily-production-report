(()=>{const $=id=>document.getElementById(id);let S={lines:[],plan:null,actual:null,manual:[],hourly:null,cum:null,keys:[]};
const esc=s=>String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
function localDate(d=new Date()){const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
function stat(t,c=""){$("dashStatus").textContent=t;$("dashStatus").className="hero-status "+c}
function note(t,c=""){$("dashMessage").textContent=t;$("dashMessage").className="notice info-notice "+c}
async function all(n){let s=await ProdV2DB.collection(n).get();return s.docs.map(d=>({id:d.id,...d.data()}))}
const key=(m,d)=>`${m}|||${d}`;
function splitKey(x){let p=String(x).split("|||");return {model:p[0]||"",door:p[1]||""}}

function planBlocks(){return Array.isArray(S.plan?.blocks)?S.plan.blocks:[]}
function planRows(){
  const out={};
  planBlocks().forEach((b,bi)=>{
    (b.cells||[]).forEach(c=>{
      const kk=key(c.model,c.door);
      (out[kk]??=[])[bi]=Number(c.plan||0);
    });
  });
  return out;
}
function actualRows(){
  const out={}, map=S.actual?.actualByCell||{};
  Object.entries(map).forEach(([cell,v])=>{
    const p=cell.split("|||"), bi=Number(p[0]), kk=key(p[1],p[2]);
    (out[kk]??=[])[bi]=Number(v||0);
  });
  return out;
}
function autoLoss(){
  const a=S.plan?.masterSnapshot?.palletChangeLosses||[];
  if(a.length)return a;
  const m=Number(S.plan?.lossMinutes||0);
  return m?[{category:"Pallet Change",minutes:m}]:[];
}
function lossRows(){return [...autoLoss().map(x=>({...x,category:x.category||"Pallet Change"})),...S.manual]}
function filterKeys(keys){
  const models=[...new Set(keys.map(x=>splitKey(x).model).filter(Boolean))].sort();
  const doors=[...new Set(keys.map(x=>splitKey(x).door).filter(Boolean))].sort();
  const mv=$("dashModel").value,dv=$("dashDoor").value;
  $("dashModel").innerHTML='<option value="">All Models</option>'+models.map(x=>`<option value="${esc(x)}" ${x===mv?"selected":""}>${esc(x)}</option>`).join("");
  $("dashDoor").innerHTML='<option value="">All Doors</option>'+doors.map(x=>`<option value="${esc(x)}" ${x===dv?"selected":""}>${esc(x)}</option>`).join("");
}
function selected(keys){
  const m=$("dashModel").value,d=$("dashDoor").value;
  return keys.filter(x=>(!m||splitKey(x).model===m)&&(!d||splitKey(x).door===d));
}
function blockLabels(n){
  const b=planBlocks(), labels=[];
  for(let i=0;i<n;i++)labels.push(b[i]?`${b[i].start||""}–${b[i].end||""}`:`Block ${i+1}`);
  return labels;
}
function render(){
  const P=planRows(),A=actualRows();
  const keys=[...new Set([...Object.keys(P),...Object.keys(A)])];
  S.keys=keys;filterKeys(keys);
  const use=selected(keys);
  const n=Math.max(0,...use.flatMap(x=>[(P[x]||[]).length,(A[x]||[]).length]));
  const labels=blockLabels(n), pb=Array(n).fill(0),ab=Array(n).fill(0);
  use.forEach(x=>{for(let i=0;i<n;i++){pb[i]+=Number(P[x]?.[i]||0);ab[i]+=Number(A[x]?.[i]||0)}});

  let plan=pb.reduce((a,b)=>a+b,0), actual=ab.reduce((a,b)=>a+b,0);if(!plan&&!$("dashModel").value&&!$("dashDoor").value)plan=Number(S.plan?.adjustedPlan??S.plan?.totalPlan??0);
  const gap=actual-plan, ach=plan?actual/plan*100:0;
  const loss=lossRows().reduce((s,x)=>s+Number(x.minutes||0),0);
  const status=plan>0 && actual>=plan?"ON TARGET":"BEHIND PLAN";

  $("dashKpis").innerHTML=
   `<div class="entry-kpi"><small>ADJUSTED PLAN</small><b>${plan.toLocaleString()}</b></div>`+
   `<div class="entry-kpi"><small>ACTUAL</small><b>${actual.toLocaleString()}</b></div>`+
   `<div class="entry-kpi"><small>GAP</small><b class="${gap<0?"kpi-bad":"kpi-good"}">${gap>0?"+":""}${gap.toLocaleString()}</b></div>`+
   `<div class="entry-kpi"><small>ACHIEVEMENT</small><b>${ach.toFixed(1)}%</b></div>`+
   `<div class="entry-kpi"><small>LOSS</small><b>${loss} min</b></div>`+
   `<div class="entry-kpi"><small>STATUS</small><b class="${status==="ON TARGET"?"kpi-good":"kpi-bad"}">${status}</b></div>`;

  charts(labels,pb,ab);performance(P,A,use);lossView();
  note(`Dashboard loaded · ${$("dashDate").value} · Line ${$("dashLine").value} / ${$("dashShift").value}`,"plan-ok");
}
function charts(labels,p,a){
  if(S.hourly)S.hourly.destroy();if(S.cum)S.cum.destroy();
  S.hourly=new Chart($("hourlyChart"),{type:"bar",data:{labels,datasets:[{label:"Adjusted Plan",data:p},{label:"Actual",data:a}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true}}}});
  let cp=[],ca=[],x=0,y=0;p.forEach(v=>cp.push(x+=v));a.forEach(v=>ca.push(y+=v));
  S.cum=new Chart($("cumChart"),{type:"line",data:{labels,datasets:[{label:"Cumulative Plan",data:cp,tension:.25},{label:"Cumulative Actual",data:ca,tension:.25}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true}}}});
}
function performance(P,A,keys){
  if(!keys.length){$("performanceTable").innerHTML='<div class="empty-state">ไม่มี Model/Door สำหรับตัวกรองนี้</div>';return}
  let h='<div class="table-scroll"><table class="grid"><thead><tr><th>Model</th><th>Door</th><th>Plan</th><th>Actual</th><th>Gap</th><th>Ach.</th></tr></thead><tbody>';
  keys.forEach(x=>{
    const p=(P[x]||[]).reduce((a,b)=>a+Number(b||0),0),a=(A[x]||[]).reduce((a,b)=>a+Number(b||0),0),g=a-p,z=p?a/p*100:0,q=splitKey(x);
    h+=`<tr><td>${esc(q.model)}</td><td>${esc(q.door)}</td><td>${p}</td><td><b>${a}</b></td><td class="${g<0?"kpi-bad":"kpi-good"}">${g>0?"+":""}${g}</td><td>${z.toFixed(1)}%</td></tr>`;
  });
  h+='</tbody></table></div>';$("performanceTable").innerHTML=h;
}
function lossView(){
  const totals={};lossRows().forEach(x=>{let c=x.category||"Other";totals[c]=(totals[c]||0)+Number(x.minutes||0)});
  const arr=Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  $("lossAnalysis").innerHTML=arr.length?'<div class="loss-category-summary">'+arr.map(([c,m])=>`<div class="loss-cat"><span>${esc(c)}</span><b>${m} min</b></div>`).join("")+'</div>':'<div class="empty-state">ไม่มี Loss</div>';
}
async function load(){
  const d=$("dashDate").value,l=$("dashLine").value.toUpperCase(),sh=$("dashShift").value;
  ProdV2Context.set({date:d,lineId:l,shift:sh});stat("Loading...");
  try{
    const [p,a,loss]=await Promise.all([
      ProdV2DB.collection("prodV2_dailyPlans").doc(`plan_${d}_${l}_${sh}`).get(),
      ProdV2DB.collection("prodV2_actualLogs").doc(`actual_${d}_${l}_${sh}`).get(),
      ProdV2DB.collection("prodV2_lossLogs").where("date","==",d).where("lineId","==",l).where("shift","==",sh).get()
    ]);
    S.plan=p.exists?{id:p.id,...p.data()}:null;
    S.actual=a.exists?{id:a.id,...a.data()}:null;
    S.manual=loss.docs.map(x=>({id:x.id,...x.data()}));
    if(!S.plan)note("ไม่พบ Saved Daily Plan สำหรับชุดนี้","plan-warn");
    render();stat("Loaded","ok");
  }catch(e){console.error(e);note(e.message,"plan-warn");stat("Load failed","err")}
}
async function init(){
  $("dashDate").value=localDate();$("dashLoadBtn").onclick=load;$("dashModel").onchange=render;$("dashDoor").onchange=render;
  try{
    S.lines=(await all("prodV2_lines")).filter(x=>x.active!==false).sort((a,b)=>(a.order||99)-(b.order||99));
    $("dashLine").innerHTML=S.lines.map(x=>`<option value="${x.lineId||x.code||x.id}">${esc(x.name||"Line "+(x.lineId||x.code||x.id))}</option>`).join("");
    let c=ProdV2Context.get();
    if(c.date)$("dashDate").value=c.date;
    if(c.lineId&&[...$("dashLine").options].some(o=>o.value===c.lineId))$("dashLine").value=c.lineId;
    if(c.shift)$("dashShift").value=c.shift;
    if(c.date&&c.lineId&&c.shift)load();
  }catch(e){note(e.message,"plan-warn")}
}
addEventListener("DOMContentLoaded",init)})();