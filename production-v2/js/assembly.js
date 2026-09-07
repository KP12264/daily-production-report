(()=>{const $=id=>document.getElementById(id);
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function stat(t,c=""){$("asmStatus").textContent=t;$("asmStatus").className="hero-status "+c}
function note(t,c=""){$("asmMessage").textContent=t;$("asmMessage").className="notice info-notice "+c}
function localDate(d=new Date()){const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
async function all(n){let s=await ProdV2DB.collection(n).get();return s.docs.map(d=>({id:d.id,...d.data()}))}

/* ===== BOM (Bill of Materials) — confirmed with the user turn by turn.
   Each cabinet lists the Doors it needs (qty always 1 here) and which POOL
   supplies that Door. A pool is a set of raw (Model,Door) actual-data keys
   whose quantities get SUMMED before checking availability — this is how
   "Common" parts work: even when two cabinets' doors are recorded under
   different Model names in Actual, if they're physically the same
   interchangeable part, their actual quantities pool together.
   NOTE: pool key names below are best-effort guesses at the exact Model
   names used for shared parts (e.g. "636" for the F shared by both 620/550
   variants, matching the Model name already registered in Master). If any
   pool maps to the wrong real Model/Door, correct it here — everything
   downstream (grouping, shortage warnings) follows from this table alone. */
const POOLS={
  bm_rr:[["BM","RR"]], bm_rl:[["BM","RL"]], bm_ft:[["BM","FT"]], bm_fb:[["BM","FB"]],
  bm28_fr:[["BM28","FR"]], bm28_fl:[["BM28","FL"]],
  glass_rr:[["BM28 Glass","RR"]], glass_rl:[["BM28 Glass","RL"]], glass_ft:[["BM28 Glass","FT"]], glass_fb:[["BM28 Glass","FB"]],
  glasstd_fr:[["BM28 Glass T-Door","FR"]], glasstd_fl:[["BM28 Glass T-Door","FL"]],
  fuf14_r:[["FUF14","R"]], fuf1822_r:[["FUF18/22","R"]],
  tm14_f:[["TM14","F"]], tm14_r:[["TM14","R"]],
  tm1921_f:[["TM19/21","F"]], tm1921_r:[["TM19/21","R"]],
  ehrt_f_common:[["EHRT 2070 NL","F"],["EHRT 2570 NL","F"]],
  ehrt2070_r:[["EHRT 2070 NL","R"]],
  ehrt2570_r:[["EHRT 2570 NL","R"]],
  door53c_r:[["Door 5.3 Cu.(159) C","R"]], door53f_r:[["Door 5.3 Cu.(159) F","R"]],
  door66c_r:[["Door 6.6 Cu.(199) C","R"]], door66f_r:[["Door 6.6 Cu.(199) F","R"]],
  f636:[["636","F"]],
  d620flat_r:[["620 550 หน้าเรียบ","R"]], d620faucet_r:[["620 550 ก๊อกน้ำ","R"]],
  d520_rl:[["520 หน้าเรียบ","RL"],["520 ก๊อกน้ำ","RL"]],
  d520flat_rr:[["520 หน้าเรียบ","RR"]], d520faucet_rr:[["520 ก๊อกน้ำ","RR"]],
  frfl_big4_fr:[["520 หน้าเรียบ","FR"],["520 ก๊อกน้ำ","FR"],["T-Door Horizontal เรียบ","FR"],["T-Door Horizontal ก๊อก","FR"]],
  frfl_big4_fl:[["520 หน้าเรียบ","FL"],["520 ก๊อกน้ำ","FL"],["T-Door Horizontal เรียบ","FL"],["T-Door Horizontal ก๊อก","FL"]],
  tdh_flat_rr:[["T-Door Horizontal เรียบ","RR"]], tdh_flat_rl:[["T-Door Horizontal เรียบ","RL"]],
  tdh_faucet_rr:[["T-Door Horizontal ก๊อก","RR"]], tdh_faucet_rl:[["T-Door Horizontal ก๊อก","RL"]],
  tdus_rr:[["T-Door US","RR"]], tdus_rl:[["T-Door US","RL"]], tdus_fr:[["T-Door US","FR"]], tdus_fl:[["T-Door US","FL"]],
  tm1012_f:[["TM10/12","F"]], tm1012_r:[["TM10/12","R"]],
  g3320_f:[["G3 320","F"]], g3320_r:[["G3 320","R"]],
  g3350_f:[["G3 350","F"]], g3350_r:[["G3 350","R"]],
};
const BOM=[
 {group:"BM (Common RR/RL)",cabinets:[
   {name:"BM (BM23+BM29)",parts:{RR:"bm_rr",RL:"bm_rl",FT:"bm_ft",FB:"bm_fb"}},
   {name:"BM28",parts:{RR:"bm_rr",RL:"bm_rl",FR:"bm28_fr",FL:"bm28_fl"}},
 ]},
 {group:"BM28 Glass (Common RR/RL)",cabinets:[
   {name:"BM28 Glass",parts:{RR:"glass_rr",RL:"glass_rl",FT:"glass_ft",FB:"glass_fb"}},
   {name:"BM28 Glass T-Door",parts:{RR:"glass_rr",RL:"glass_rl",FR:"glasstd_fr",FL:"glasstd_fl"}},
 ]},
 {group:"FUF",cabinets:[
   {name:"FUF14",parts:{R:"fuf14_r"}},
   {name:"FUF18/22",parts:{R:"fuf1822_r"}},
 ]},
 {group:"TM14 / TM19-21",cabinets:[
   {name:"TM14",parts:{F:"tm14_f",R:"tm14_r"}},
   {name:"TM19/21",parts:{F:"tm1921_f",R:"tm1921_r"}},
 ]},
 {group:"EHRT",cabinets:[
   {name:"EHRT 2070 NL",parts:{F:"ehrt_f_common",R:"ehrt2070_r"}},
   {name:"EHRT 2570 NL",parts:{F:"ehrt_f_common",R:"ehrt2570_r"}},
 ]},
 {group:"Door 5.3 / 6.6 Cu",cabinets:[
   {name:"Door 5.3 Cu.(159) C",parts:{R:"door53c_r"}},
   {name:"Door 5.3 Cu.(159) F",parts:{R:"door53f_r"}},
   {name:"Door 6.6 Cu.(199) C",parts:{R:"door66c_r"}},
   {name:"Door 6.6 Cu.(199) F",parts:{R:"door66f_r"}},
 ]},
 {group:"620/550 (Common F=636)",cabinets:[
   {name:"620 550 หน้าเรียบ",parts:{R:"d620flat_r",F:"f636"}},
   {name:"620 550 ก๊อกน้ำ",parts:{R:"d620faucet_r",F:"f636"}},
 ]},
 {group:"520 + T-Door Horizontal (Common FR/FL ทั้ง 4 / RL เฉพาะ 520)",cabinets:[
   {name:"520 หน้าเรียบ",parts:{RR:"d520flat_rr",RL:"d520_rl",FR:"frfl_big4_fr",FL:"frfl_big4_fl"}},
   {name:"520 ก๊อกน้ำ",parts:{RR:"d520faucet_rr",RL:"d520_rl",FR:"frfl_big4_fr",FL:"frfl_big4_fl"}},
   {name:"T-Door Horizontal เรียบ",parts:{RR:"tdh_flat_rr",RL:"tdh_flat_rl",FR:"frfl_big4_fr",FL:"frfl_big4_fl"}},
   {name:"T-Door Horizontal ก๊อก",parts:{RR:"tdh_faucet_rr",RL:"tdh_faucet_rl",FR:"frfl_big4_fr",FL:"frfl_big4_fl"}},
 ]},
 {group:"T-Door US (ไม่ Common กับใคร)",cabinets:[
   {name:"T-Door US",parts:{RR:"tdus_rr",RL:"tdus_rl",FR:"tdus_fr",FL:"tdus_fl"}},
 ]},
 {group:"TM10/12, G3",cabinets:[
   {name:"TM10/12",parts:{F:"tm1012_f",R:"tm1012_r"}},
   {name:"G3 320",parts:{F:"g3320_f",R:"g3320_r"}},
   {name:"G3 350",parts:{F:"g3350_f",R:"g3350_r"}},
 ]},
];

async function load(){
 const date=$("asmDate").value,shift=$("asmShift").value;
 if(!date)return note("เลือกวันที่ก่อน","plan-warn");
 stat("Loading…");note("กำลังโหลด…");
 try{
  const logs=await all("prodV2_actualLogs");
  const matched=logs.filter(x=>x.date===date&&(!shift||x.shift===shift));
  const totals={}; // "Model|||Door" -> qty
  matched.forEach(doc=>{
   Object.entries(doc.actualByCell||{}).forEach(([k,v])=>{
    const p=k.split("|||"); if(p.length<3)return;
    const mk=p[1]+"|||"+p[2];
    totals[mk]=(totals[mk]||0)+Number(v||0);
   });
  });
  render(totals,matched.length);
  note(`โหลดแล้ว · ${date}${shift?" · "+shift:" · ทุกกะ"} · รวม ${matched.length} Actual Log`,"plan-ok");
  stat("Loaded","ok");
 }catch(e){note(window.ProdV2Auth?ProdV2Auth.friendlyError(e):e.message,"plan-warn");stat("Load failed","err");}
}
function poolTotal(poolKey,totals){return (POOLS[poolKey]||[]).reduce((s,[m,d])=>s+Number(totals[m+"|||"+d]||0),0)}
function render(totals,logCount){
 window.currentAsmTotals=totals; // so the filter dropdown can re-render without reloading
 const host=$("asmResults");
 const filterVal=$("asmGroupFilter")?.value||"";
 let h="";
 BOM.filter(g=>!filterVal||g.group===filterVal).forEach(g=>{
  // Per-cabinet ceiling: if this cabinet alone got 100% of every pool it
  // needs, how many could it make? This is an upper bound, not a number
  // that's already netted against what other cabinets in the group want.
  const rows=g.cabinets.map(cab=>{
   const parts=Object.entries(cab.parts).map(([door,poolKey])=>({door,poolKey,available:poolTotal(poolKey,totals)}));
   const bottleneck=parts.reduce((min,p)=>p.available<min.available?p:min,parts[0]);
   return {name:cab.name,parts,possible:bottleneck.available,bottleneckDoor:bottleneck.door};
  });
  // Group-level shared-pool shortage check — sum what every cabinet in this
  // group would need from a pool if each got its own full ceiling amount,
  // versus what's actually available in that pool.
  const poolKeysInGroup=[...new Set(g.cabinets.flatMap(c=>Object.values(c.parts)))];
  const poolDemand=poolKeysInGroup.map(pk=>{
   const demand=rows.filter((r,i)=>Object.values(g.cabinets[i].parts).includes(pk)).reduce((s,r)=>s+r.possible,0);
   const available=poolTotal(pk,totals);
   const usedByMultiple=g.cabinets.filter(c=>Object.values(c.parts).includes(pk)).length>1;
   return {pk,demand,available,usedByMultiple,short:usedByMultiple&&demand>available};
  }).filter(p=>p.usedByMultiple);
  h+=`<section class="section-card"><div class="section-title-row"><div><h2>${esc(g.group)}</h2></div></div>`;
  h+='<div class="table-scroll"><table class="grid mobile-cards"><thead><tr><th>Model</th><th>สูตร (Door)</th><th>ประกอบได้สูงสุด</th><th>ติดคอขวดที่</th></tr></thead><tbody>';
  rows.forEach(r=>{
   h+=`<tr><td data-label="Model"><b>${esc(r.name)}</b></td><td data-label="สูตร">${r.parts.map(p=>`${esc(p.door)}:${p.available}`).join(" + ")}</td><td data-label="ประกอบได้สูงสุด"><b>${r.possible.toLocaleString()}</b> ตู้</td><td data-label="ติดคอขวด">${esc(r.bottleneckDoor)}</td></tr>`;
  });
  h+="</tbody></table></div>";
  const shortages=poolDemand.filter(p=>p.short);
  if(shortages.length){
   h+=`<div class="notice plan-warn" style="margin-top:12px">⚠️ ชิ้นส่วนร่วมไม่พอสำหรับทุก Model เต็มที่พร้อมกัน:<br>${shortages.map(p=>`มีอยู่ ${p.available.toLocaleString()} ชิ้น แต่ถ้าทุก Model ที่ใช้ร่วมกันอยากได้เต็มที่ต้องใช้รวม ${p.demand.toLocaleString()} ชิ้น (ขาด ${(p.demand-p.available).toLocaleString()}) — ต้องเลือกว่าจะให้ Model ไหนก่อน`).join("<br>")}</div>`;
  }
  h+="</section>";
 });
 host.innerHTML=h;
}
function init(){
 $("asmDate").value=localDate();
 $("asmLoadBtn").onclick=load;
 const sel=$("asmGroupFilter");
 if(sel){
  sel.innerHTML='<option value="">ทุก Model</option>'+BOM.map(g=>`<option value="${esc(g.group)}">${esc(g.group)}</option>`).join("");
  sel.addEventListener("change",()=>{if(window.currentAsmTotals)render(window.currentAsmTotals,0)});
 }
}
if(document.readyState==="loading")addEventListener("DOMContentLoaded",init);else init();
})();
