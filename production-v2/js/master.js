const LINE_COLLECTION='prodV2_lines';
const MODEL_COLLECTION='prodV2_models';
const statusEl=document.getElementById('saveStatus');
const lineBody=document.getElementById('lineRows');
const modelBody=document.getElementById('modelRows');
const modelLineFilter=document.getElementById('modelLineFilter');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setStatus(t,c=''){statusEl.textContent=t;statusEl.className='status '+c}
function safeKey(s){return String(s||'').trim().replace(/[^a-zA-Z0-9_-]/g,'_')}

/* Tabs */
document.querySelectorAll('[data-tab]').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===btn));
  document.querySelectorAll('[data-pane]').forEach(x=>x.classList.toggle('active',x.dataset.pane===btn.dataset.tab));
  if(btn.dataset.tab==='models') loadModels();
}));

/* Lines */
function lineRowHtml(x={},docId='',isNew=false){
  const id=x.lineId||'',name=x.lineName||'',order=Number(x.order||0);
  return `<tr>
    <td><input value="${esc(id)}" placeholder="A" data-k="lineId" ${isNew?'':'readonly'}></td>
    <td><input value="${esc(name)}" placeholder="Line A" data-k="lineName"></td>
    <td><input type="number" min="1" value="${order||''}" data-k="order"></td>
    <td><select data-k="active"><option value="true" ${x.active!==false?'selected':''}>Active</option><option value="false" ${x.active===false?'selected':''}>Inactive</option></select></td>
    <td class="right"><button ${isNew?'data-save-line-new':`data-save-line="${esc(docId)}"`}>Save</button></td>
  </tr>`;
}
async function loadLines(){
  lineBody.innerHTML='<tr><td colspan="5" class="empty">Loading…</td></tr>';
  try{
    const snap=await ProdV2DB.collection(LINE_COLLECTION).orderBy('order').get();
    if(snap.empty){
      lineBody.innerHTML='<tr><td colspan="5" class="empty">ยังไม่มี Line ใน V2 — กด Add Line เพื่อเริ่มสร้าง Master</td></tr>';
      modelLineFilter.innerHTML='<option value="">No active lines</option>';
      return;
    }
    lineBody.innerHTML='';
    const lines=[];
    snap.forEach(d=>{const x=d.data(); lines.push(x); lineBody.insertAdjacentHTML('beforeend',lineRowHtml(x,d.id,false));});
    const current=modelLineFilter.value;
    modelLineFilter.innerHTML=lines.filter(x=>x.active!==false).map(x=>`<option value="${esc(x.lineId)}">${esc(x.lineName||x.lineId)}</option>`).join('');
    if(lines.some(x=>x.lineId===current&&x.active!==false)) modelLineFilter.value=current;
  }catch(e){
    setStatus(e.message,'err');
    lineBody.innerHTML='<tr><td colspan="5" class="empty">โหลดไม่ได้ — ตรวจ Firestore Rules/Internet</td></tr>';
  }
}
document.getElementById('addLine').addEventListener('click',()=>{
  lineBody.querySelector('.empty')?.closest('tr')?.remove();
  const orders=[...lineBody.querySelectorAll('[data-k="order"]')].map(el=>Number(el.value)||0);
  lineBody.insertAdjacentHTML('beforeend',lineRowHtml({order:Math.max(0,...orders)+1,active:true},'',true));
  lineBody.lastElementChild.querySelector('[data-k="lineId"]').focus();
  setStatus('New line ready');
});
lineBody.addEventListener('click',async e=>{
  const btn=e.target.closest('button');
  if(!btn||(!btn.hasAttribute('data-save-line')&&!btn.hasAttribute('data-save-line-new')))return;
  const tr=btn.closest('tr'),get=k=>tr.querySelector(`[data-k="${k}"]`).value;
  const lineId=get('lineId').trim().toUpperCase();
  if(!lineId)return alert('กรุณาใส่ Line ID');
  const data={lineId,lineName:get('lineName').trim()||('Line '+lineId),order:Number(get('order'))||0,active:get('active')==='true',updatedAt:Date.now()};
  const id=btn.dataset.saveLine||('line_'+safeKey(lineId));
  try{setStatus('Saving…');btn.disabled=true;await ProdV2DB.set(LINE_COLLECTION,id,data,{merge:true});setStatus('✓ Saved','ok');await loadLines();}
  catch(err){setStatus((window.ProdV2Auth?ProdV2Auth.friendlyError(err):err.message),'err');btn.disabled=false}
});


/* Initial Model & Door seed.
   This creates/merges only prodV2_models. Existing matching IDs are not duplicated. */
const INITIAL_MODEL_DOORS = [
  // Line A — confirmed/historical model-door names from the production workbook.
  ['A','620/550 หน้าเรียบ','R'],
  ['A','620/550 ก๊อกน้ำ','R'],
  ['A','636','F'],
  ['A','520 หน้าเรียบ','RR'],
  ['A','520 ก๊อกน้ำ','RR'],
  ['A','520','RL'],
  ['A','G3 320','F'], ['A','G3 320','R'],
  ['A','G3 350','F'], ['A','G3 350','R'],
  ['A','T-Door US','RR'], ['A','T-Door US','RL'], ['A','T-Door US','FR'], ['A','T-Door US','FL'],
  ['A','T-Door Horizontal เรียบ','RR'], ['A','T-Door Horizontal เรียบ','RL'], ['A','T-Door Horizontal เรียบ','FR'], ['A','T-Door Horizontal เรียบ','FL'],
  ['A','T-Door Horizontal ก๊อก','RR'], ['A','T-Door Horizontal ก๊อก','RL'], ['A','T-Door Horizontal ก๊อก','FR'], ['A','T-Door Horizontal ก๊อก','FL'],
  ['A','TM1012','F'], ['A','TM1012','R'],

  // Line B
  ['B','EHRT 2070 NL','F'], ['B','EHRT 2070 NL','R'],
  ['B','EHRT 2570 NL','F'], ['B','EHRT 2570 NL','R'],
  ['B','Door 5.3 Cu.(159) C','R'],
  ['B','Door 5.3 Cu.(159) F','R'],
  ['B','Door 6.6 Cu.(199) C','R'],
  ['B','Door 6.6 Cu.(199) F','R'],

  // Line C — current confirmed layout/model-door set.
  ['C','BM','RR'], ['C','BM','RL'], ['C','BM','FT'], ['C','BM','FB'],
  ['C','FUF14','R'],
  ['C','FUF18/22','R'],
  ['C','TM19','F'], ['C','TM19','R'],
  ['C','TM14','F'], ['C','TM14','R'],
  ['C','BMT-G','RR'], ['C','BMT-G','RL'], ['C','BMT-G','FT'], ['C','BMT-G','FB'],
  ['C','BM28','FR'], ['C','BM28','FL']
];

document.getElementById('initModelMaster').addEventListener('click', async ()=>{
  const ok = confirm(`Initialize ${INITIAL_MODEL_DOORS.length} Model / Door records for Lines A, B and C?\n\nExisting matching records will be merged, not duplicated.`);
  if(!ok) return;
  const btn=document.getElementById('initModelMaster');
  try{
    btn.disabled=true;
    setStatus('Initializing Master…');
    const counters={A:0,B:0,C:0};
    for(const [lineId,modelName,doorCode] of INITIAL_MODEL_DOORS){
      counters[lineId]+=1;
      const data={
        lineId, modelName, doorCode,
        displayName:`${modelName} / ${doorCode}`,
        order:counters[lineId],
        active:true,
        source:'initial-master-v1',
        updatedAt:Date.now()
      };
      const id=`model_${safeKey(lineId)}_${safeKey(modelName)}_${safeKey(doorCode)}`;
      await ProdV2DB.set(MODEL_COLLECTION,id,data,{merge:true});
    }
    setStatus(`✓ Initialized ${INITIAL_MODEL_DOORS.length} records`,'ok');
    await loadModels();
    alert('Initialize Master Data สำเร็จ\n\nLine A, B และ C ถูกสร้างใน prodV2_models แล้ว');
  }catch(err){
    setStatus((window.ProdV2Auth?ProdV2Auth.friendlyError(err):err.message),'err');
    alert('Initialize ไม่สำเร็จ: '+(window.ProdV2Auth?ProdV2Auth.friendlyError(err):err.message));
  }finally{
    btn.disabled=false;
  }
});


/* Model & Door */
function modelRowHtml(x={},docId='',isNew=false){
  const lineId=x.lineId||modelLineFilter.value||'';
  const model=x.modelName||'',door=x.doorCode||'',display=x.displayName||'',order=Number(x.order||0);
  return `<tr>
    <td><input value="${esc(lineId)}" data-k="lineId" readonly></td>
    <td><input value="${esc(model)}" placeholder="TM14" data-k="modelName" ${isNew?'':'readonly'}></td>
    <td><input value="${esc(door)}" placeholder="F" data-k="doorCode" ${isNew?'':'readonly'}></td>
    <td><input value="${esc(display)}" placeholder="TM14 / F" data-k="displayName"></td>
    <td><input type="number" min="1" value="${order||''}" data-k="order"></td>
    <td><select data-k="active"><option value="true" ${x.active!==false?'selected':''}>Active</option><option value="false" ${x.active===false?'selected':''}>Inactive</option></select></td>
    <td class="right"><button ${isNew?'data-save-model-new':`data-save-model="${esc(docId)}"`}>Save</button></td>
  </tr>`;
}
async function loadModels(){
  const lineId=modelLineFilter.value;
  if(!lineId){modelBody.innerHTML='<tr><td colspan="7" class="empty">กรุณาสร้าง Active Line ก่อน</td></tr>';return}
  modelBody.innerHTML='<tr><td colspan="7" class="empty">Loading…</td></tr>';
  try{
    const snap=await ProdV2DB.collection(MODEL_COLLECTION).where('lineId','==',lineId).get();
    const rows=[];
    snap.forEach(d=>rows.push({id:d.id,...d.data()}));
    rows.sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0)||String(a.modelName).localeCompare(String(b.modelName))||String(a.doorCode).localeCompare(String(b.doorCode)));
    if(!rows.length){modelBody.innerHTML='<tr><td colspan="7" class="empty">ยังไม่มี Model / Door สำหรับ Line นี้ — กด Add Model / Door</td></tr>';return}
    modelBody.innerHTML=rows.map(x=>modelRowHtml(x,x.id,false)).join('');
  }catch(e){setStatus(e.message,'err');modelBody.innerHTML='<tr><td colspan="7" class="empty">โหลด Model / Door ไม่ได้</td></tr>'}
}
modelLineFilter.addEventListener('change',loadModels);
document.getElementById('addModelDoor').addEventListener('click',()=>{
  const lineId=modelLineFilter.value;
  if(!lineId)return alert('กรุณาเลือก Line');
  modelBody.querySelector('.empty')?.closest('tr')?.remove();
  const orders=[...modelBody.querySelectorAll('[data-k="order"]')].map(el=>Number(el.value)||0);
  modelBody.insertAdjacentHTML('beforeend',modelRowHtml({lineId,order:Math.max(0,...orders)+1,active:true},'',true));
  modelBody.lastElementChild.querySelector('[data-k="modelName"]').focus();
  setStatus('New Model / Door ready');
});
modelBody.addEventListener('click',async e=>{
  const btn=e.target.closest('button');
  if(!btn||(!btn.hasAttribute('data-save-model')&&!btn.hasAttribute('data-save-model-new')))return;
  const tr=btn.closest('tr'),get=k=>tr.querySelector(`[data-k="${k}"]`).value;
  const lineId=get('lineId').trim().toUpperCase(),modelName=get('modelName').trim(),doorCode=get('doorCode').trim().toUpperCase();
  if(!lineId||!modelName||!doorCode)return alert('กรุณาใส่ Line, Model และ Door ให้ครบ');
  const data={lineId,modelName,doorCode,displayName:get('displayName').trim()||`${modelName} / ${doorCode}`,order:Number(get('order'))||0,active:get('active')==='true',updatedAt:Date.now()};
  const id=btn.dataset.saveModel||(`model_${safeKey(lineId)}_${safeKey(modelName)}_${safeKey(doorCode)}`);
  try{
    setStatus('Saving…');btn.disabled=true;
    await ProdV2DB.set(MODEL_COLLECTION,id,data,{merge:true});
    setStatus('✓ Saved','ok');await loadModels();
  }catch(err){setStatus((window.ProdV2Auth?ProdV2Auth.friendlyError(err):err.message),'err');btn.disabled=false}
});

(async()=>{await loadLines();})();


/* Step 3 — Physical Pallet/Jig Layout */
const LAYOUT_COLLECTION='prodV2_jigLayouts';

async function v2ReadAll(collectionName){
  if(!String(collectionName).startsWith('prodV2_')) throw new Error('V2 read blocked: invalid collection');
  const ref=ProdV2DB.collection(collectionName);
  const snap=await ref.get();
  return snap.docs.map(d=>({id:d.id,...d.data()}));
}

function lineCPallets(){
  const rows=[];
  const add=(palletNo, positions)=>rows.push({
    lineId:'C', palletNo, palletName:`C-P${String(palletNo).padStart(2,'0')}`,
    positions, pcsPerRound:positions.reduce((s,p)=>s+Number(p.qty||0),0),
    active:true, source:'line-c-confirmed-v1', updatedAt:Date.now()
  });
  let n=1;
  for(let i=0;i<5;i++) add(n++,[{modelName:'BM',doorCode:'RR',qty:1},{modelName:'BM',doorCode:'RL',qty:1},{modelName:'BM',doorCode:'FT',qty:1},{modelName:'BM',doorCode:'FB',qty:1}]);
  for(let i=0;i<6;i++) add(n++,[{modelName:'FUF14',doorCode:'R',qty:1}]);
  for(let i=0;i<6;i++) add(n++,[{modelName:'FUF18/22',doorCode:'R',qty:1}]);
  for(let i=0;i<2;i++) add(n++,[{modelName:'TM19',doorCode:'F',qty:1},{modelName:'TM19',doorCode:'R',qty:1}]);
  for(let i=0;i<3;i++) add(n++,[{modelName:'TM14',doorCode:'F',qty:1},{modelName:'TM14',doorCode:'R',qty:1}]);
  add(n++,[{modelName:'BMT-G',doorCode:'RR',qty:1},{modelName:'BMT-G',doorCode:'RL',qty:1},{modelName:'BMT-G',doorCode:'FT',qty:1},{modelName:'BMT-G',doorCode:'FB',qty:1}]);
  add(n++,[{modelName:'BM',doorCode:'RL',qty:2},{modelName:'BM28',doorCode:'FR',qty:1},{modelName:'BM28',doorCode:'FL',qty:1}]);
  return rows;
}
const LINE_C_LAYOUT=lineCPallets();

function lineBPallets(){
  // Note: EHRT 2070 NL and EHRT 2570 NL physically share the same F (front)
  // door part — interchangeable on the real production line. This system still
  // tracks them as separate Model/Door entries per the "อย่ารวมทุกอย่างเป็นชื่อ
  // Model เดียว" rule, so this has no effect on pallet composition, counts, or
  // Plan/Actual math — it's just a fact worth knowing if BOM/inventory data
  // ever gets linked in later.
  const rows=[];
  const add=(palletNo, positions)=>rows.push({
    lineId:'B', palletNo, palletName:`B-P${String(palletNo).padStart(2,'0')}`,
    positions, pcsPerRound:positions.reduce((s,p)=>s+Number(p.qty||0),0),
    active:true, source:'line-b-confirmed-v1', updatedAt:Date.now()
  });
  let n=1;
  for(let i=0;i<4;i++) add(n++,[{modelName:'EHRT 2070 NL',doorCode:'F',qty:1},{modelName:'EHRT 2070 NL',doorCode:'R',qty:1}]);
  for(let i=0;i<4;i++) add(n++,[{modelName:'EHRT 2570 NL',doorCode:'F',qty:1},{modelName:'EHRT 2570 NL',doorCode:'R',qty:1}]);
  for(let i=0;i<4;i++) add(n++,[{modelName:'Door 5.3 Cu.(159) C',doorCode:'R',qty:1}]);
  for(let i=0;i<4;i++) add(n++,[{modelName:'Door 5.3 Cu.(159) F',doorCode:'R',qty:1}]);
  for(let i=0;i<4;i++) add(n++,[{modelName:'Door 6.6 Cu.(199) C',doorCode:'R',qty:1}]);
  for(let i=0;i<4;i++) add(n++,[{modelName:'Door 6.6 Cu.(199) F',doorCode:'R',qty:1}]);
  return rows;
}
const LINE_B_LAYOUT=lineBPallets();

function layoutCompositionText(row){
  return (row.positions||[]).map(p=>`${p.modelName} ${p.doorCode} ×${p.qty}`).join(' + ');
}
async function loadLayouts(){
  const select=document.getElementById('layoutLineFilter');
  if(!select) return;
  if(!select.options.length){
    const lines=await v2ReadAll(LINE_COLLECTION);
    select.innerHTML=lines.sort((a,b)=>(a.order||999)-(b.order||999)).map(l=>`<option value="${esc(l.lineId)}">Line ${esc(l.lineId)}</option>`).join('');
    if([...select.options].some(o=>o.value==='C')) select.value='C';
    select.addEventListener('change',loadLayouts);
  }
  const lineId=select.value;
  const all=await v2ReadAll(LAYOUT_COLLECTION);
  const rows=all.filter(x=>x.lineId===lineId).sort((a,b)=>(a.palletNo||0)-(b.palletNo||0));
  const body=document.getElementById('layoutRows');
  const sum=document.getElementById('layoutSummary');
  if(!rows.length){
    body.innerHTML=`<tr><td colspan="4">ยังไม่มี Physical Pallet Layout สำหรับ Line ${esc(lineId)}</td></tr>`;
    sum.textContent=`Line ${lineId}: ยังไม่มี Layout`;
    return;
  }
  const pcs=rows.filter(x=>x.active!==false).reduce((s,x)=>s+Number(x.pcsPerRound||0),0);
  sum.textContent=`Line ${lineId}: ${rows.length} physical pallets • ${pcs} pcs / full round`;
  body.innerHTML=rows.map(r=>`<tr><td>${esc(r.palletName)}</td><td>${esc(layoutCompositionText(r))}</td><td>${r.pcsPerRound}</td><td>${r.active===false?'Inactive':'Active'}</td></tr>`).join('');
}

document.getElementById('initLineCLayout')?.addEventListener('click',async()=>{
  if(!confirm('Initialize confirmed Line C physical layout?\\n24 pallets / 50 pcs per full round\\n\\nExisting C-P01…C-P24 records will be merged, not duplicated.')) return;
  const btn=document.getElementById('initLineCLayout');
  try{
    btn.disabled=true; setStatus('Initializing Line C Layout…');
    for(const row of LINE_C_LAYOUT){
      const id=`layout_C_P${String(row.palletNo).padStart(2,'0')}`;
      await ProdV2DB.set(LAYOUT_COLLECTION,id,row,{merge:true});
    }
    setStatus('✓ Line C Layout initialized','ok');
    const sel=document.getElementById('layoutLineFilter'); if(sel) sel.value='C';
    await loadLayouts();
    alert('Line C Layout สำเร็จ\\n24 physical pallets / 50 pcs per full round');
  }catch(err){ setStatus((window.ProdV2Auth?ProdV2Auth.friendlyError(err):err.message),'err'); alert('Initialize ไม่สำเร็จ: '+(window.ProdV2Auth?ProdV2Auth.friendlyError(err):err.message)); }
  finally{btn.disabled=false;}
});

document.getElementById('initLineBLayout')?.addEventListener('click',async()=>{
  if(!confirm('Initialize confirmed Line B physical layout?\\n24 pallets / 32 pcs per full round\\n\\nExisting B-P01…B-P24 records will be merged, not duplicated.\\nAny old B-D01…B-D06 draft pallets will be removed (superseded by this confirmed data).')) return;
  const btn=document.getElementById('initLineBLayout');
  try{
    btn.disabled=true; setStatus('Initializing Line B Layout…');
    for(const row of LINE_B_LAYOUT){
      const id=`layout_B_P${String(row.palletNo).padStart(2,'0')}`;
      await ProdV2DB.set(LAYOUT_COLLECTION,id,row,{merge:true});
    }
    // Remove the old Line B DRAFT pallets (from the earlier "Initialize A/B
    // Draft" version, before Line B had confirmed counts) — otherwise they sit
    // alongside B-P01…B-P24 and double-count the physical pallet total.
    for(let i=1;i<=6;i++){
      const id=`layout_B_D${String(i).padStart(2,'0')}`;
      try{await ProdV2DB.delete(LAYOUT_COLLECTION,id)}catch(e){/* fine if it never existed */}
    }
    setStatus('✓ Line B Layout initialized','ok');
    const sel=document.getElementById('layoutLineFilter'); if(sel) sel.value='B';
    await loadLayouts();
    alert('Line B Layout สำเร็จ\\n24 physical pallets / 32 pcs per full round\\n\\nPallet Draft เก่า (B-D01–B-D06) ถูกลบออกให้แล้ว');
  }catch(err){ setStatus((window.ProdV2Auth?ProdV2Auth.friendlyError(err):err.message),'err'); alert('Initialize ไม่สำเร็จ: '+(window.ProdV2Auth?ProdV2Auth.friendlyError(err):err.message)); }
  finally{btn.disabled=false;}
});

/* Load Step 3 data when its tab is opened */
document.querySelector('[data-tab="pallets"]')?.addEventListener('click',()=>loadLayouts().catch(e=>setStatus(e.message,'err')));


/* Step 3B — Line A draft physical layout (composition-only, no confirmed count).
   Line B used to be drafted here too, but is now confirmed — see lineBPallets()
   above — so it's no longer generated by this function. */
function draftABPallets(){
  const rows=[]; let seq={A:1};
  const add=(lineId,label,positions)=>{
    const palletNo=seq[lineId]++;
    rows.push({
      lineId,palletNo,palletName:`${lineId}-D${String(palletNo).padStart(2,'0')}`,
      layoutLabel:label,positions,
      pcsPerRound:positions.reduce((s,p)=>s+Number(p.qty||0),0),
      active:true, verificationStatus:'PENDING',
      source:'draft-ab-composition-v1',updatedAt:Date.now()
    });
  };

  /* A: only confirmed composition relationships; quantities/counts remain draft. */
  add('A','G3 320 F+R',[{modelName:'G3 320',doorCode:'F',qty:1},{modelName:'G3 320',doorCode:'R',qty:1}]);
  add('A','G3 350 F+R',[{modelName:'G3 350',doorCode:'F',qty:1},{modelName:'G3 350',doorCode:'R',qty:1}]);
  add('A','T-Door Horizontal ก๊อก RR+FR',[{modelName:'T-Door Horizontal ก๊อก',doorCode:'RR',qty:1},{modelName:'T-Door Horizontal ก๊อก',doorCode:'FR',qty:1}]);
  add('A','T-Door Horizontal ก๊อก RL+FL',[{modelName:'T-Door Horizontal ก๊อก',doorCode:'RL',qty:1},{modelName:'T-Door Horizontal ก๊อก',doorCode:'FL',qty:1}]);
  add('A','TM1012 F+R',[{modelName:'TM1012',doorCode:'F',qty:1},{modelName:'TM1012',doorCode:'R',qty:1}]);
  return rows;
}
const AB_DRAFT_LAYOUT=draftABPallets();

document.getElementById('initABLayout')?.addEventListener('click',async()=>{
  if(!confirm('Initialize Line A DRAFT composition?\\n\\nThese records are marked PENDING verification. Jig counts and rounds/hour are NOT locked.')) return;
  const btn=document.getElementById('initABLayout');
  try{
    btn.disabled=true; setStatus('Initializing A Draft…');
    for(const row of AB_DRAFT_LAYOUT){
      const id=`layout_${row.lineId}_D${String(row.palletNo).padStart(2,'0')}`;
      await ProdV2DB.set(LAYOUT_COLLECTION,id,row,{merge:true});
    }
    setStatus('✓ Line A Draft initialized — Pending Verification','ok');
    const sel=document.getElementById('layoutLineFilter'); if(sel) sel.value='A';
    await loadLayouts();
    alert('Line A Draft Layout สำเร็จ\\nข้อมูลถูกทำเครื่องหมาย Pending Verification\\nยังไม่ได้ล็อก Jig count หรือ rounds/hour');
  }catch(err){setStatus((window.ProdV2Auth?ProdV2Auth.friendlyError(err):err.message),'err');alert('Initialize ไม่สำเร็จ: '+(window.ProdV2Auth?ProdV2Auth.friendlyError(err):err.message));}
  finally{btn.disabled=false;}
});


/* Step 4 — Shift & Time Master */
const SHIFT_COLLECTION='prodV2_shiftMaster';

const C_DAY_BLOCKS=[
  ['08:00','09:00','WORK',60,10,6],
  ['09:00','10:00','WORK',60,10,6],
  ['10:00','11:40','WORK',100,10,10],
  ['11:40','12:20','BREAK',40,null,0],
  ['12:20','13:00','WORK',40,10,4],
  ['13:00','14:00','WORK',60,10,6],
  ['14:00','14:40','WORK',40,10,4],
  ['14:40','15:00','BREAK',20,null,0],
  ['15:00','16:00','WORK',60,10,6],
  ['16:00','17:00','WORK',60,10,6],
  ['17:00','17:20','BREAK',20,null,0],
  ['17:20','18:00','WORK',40,10,4],
  ['18:00','19:00','WORK',60,10,6],
  ['19:00','19:50','WORK',50,10,5]
];

/* Night shift: fully confirmed 2026-09-02. 19:50–08:00 (next day), cycle 10 min/round.
   630 work min / 63 rounds + 100 break min — totals match Day shift exactly. */
const C_NIGHT_BLOCKS=[
  ['19:50','21:00','WORK',70,10,7],
  ['21:00','22:00','WORK',60,10,6],
  ['22:00','23:10','WORK',70,10,7],
  ['23:10','00:00','BREAK',50,null,0],
  ['00:00','01:00','WORK',60,10,6],
  ['01:00','02:00','WORK',60,10,6],
  ['02:00','02:30','WORK',30,10,3],
  ['02:30','03:00','BREAK',30,null,0],
  ['03:00','04:00','WORK',60,10,6],
  ['04:00','05:10','WORK',70,10,7],
  ['05:10','05:30','BREAK',20,null,0],
  ['05:30','06:00','WORK',30,10,3],
  ['06:00','07:00','WORK',60,10,6],
  ['07:00','08:00','WORK',60,10,6]
];

function shiftRecord(lineId,shift,blocks,status,cycleMin){
  return {
    lineId,shift,blocks:blocks.map((b,i)=>({
      order:i+1,start:b[0],end:b[1],type:b[2],minutes:b[3],
      cycleMin:b[4],plannedRounds:b[5]
    })),
    standardCycleMinPerRound:cycleMin,
    verificationStatus:status,
    active:true,updatedAt:Date.now()
  };
}
async function saveShift(id,data){ await ProdV2DB.set(SHIFT_COLLECTION,id,data,{merge:true}); }

async function initLineCShift(){
  await saveShift('shift_C_DAY',shiftRecord('C','DAY',C_DAY_BLOCKS,'CONFIRMED',10));
  await saveShift('shift_C_NIGHT',shiftRecord('C','NIGHT',C_NIGHT_BLOCKS,'CONFIRMED',10));
}
function withCycle(blocks,cycleMin){
  // Reuses Line C's confirmed start/end/type/minutes for each block, but
  // recomputes plannedRounds at a different cycle time (for A/B's still-
  // provisional cycle). BREAK blocks are untouched (no cycle/rounds).
  return blocks.map(([start,end,type,minutes])=>
    type==='WORK' ? [start,end,type,minutes,cycleMin,Math.floor(minutes/cycleMin)]
                  : [start,end,type,minutes,null,0]
  );
}
async function initABShiftDraft(){
  /* Work hours & break windows are now confirmed the SAME across every line
     (per user, 2026-09-02) — so A and B reuse Line C's time blocks exactly.
     What's still provisional for A/B is the cycle time itself (rounds/hour),
     so plannedRounds here is only an estimate at 12 min/round, and
     verificationStatus stays PENDING until that cycle rate is verified. */
  const dayBlocks=withCycle(C_DAY_BLOCKS,12);
  const nightBlocks=withCycle(C_NIGHT_BLOCKS,12);
  for(const lineId of ['A','B']){
    await saveShift(`shift_${lineId}_DAY`,shiftRecord(lineId,'DAY',dayBlocks,'PENDING',12));
    await saveShift(`shift_${lineId}_NIGHT`,shiftRecord(lineId,'NIGHT',nightBlocks,'PENDING',12));
  }
}
async function loadShiftMaster(){
  const lineSel=document.getElementById('shiftLineFilter');
  const shiftSel=document.getElementById('shiftTypeFilter');
  if(!lineSel||!shiftSel)return;
  if(!lineSel.options.length){
    const lines=await v2ReadAll(LINE_COLLECTION);
    lineSel.innerHTML=lines.sort((a,b)=>(a.order||999)-(b.order||999))
      .map(l=>`<option value="${esc(l.lineId)}">Line ${esc(l.lineId)}</option>`).join('');
    if([...lineSel.options].some(o=>o.value==='C'))lineSel.value='C';
    lineSel.addEventListener('change',loadShiftMaster);
    shiftSel.addEventListener('change',loadShiftMaster);
  }
  const id=`shift_${lineSel.value}_${shiftSel.value}`;
  const all=await v2ReadAll(SHIFT_COLLECTION);
  const rec=all.find(x=>x.id===id);
  const body=document.getElementById('shiftRows'), sum=document.getElementById('shiftSummary');
  if(!rec){
    sum.textContent=`Line ${lineSel.value} / ${shiftSel.value}: ยังไม่มี Shift Master`;
    body.innerHTML='<tr><td colspan="6">ยังไม่มีข้อมูล</td></tr>'; return;
  }
  const blocks=rec.blocks||[];
  const workMin=blocks.filter(b=>b.type==='WORK').reduce((s,b)=>s+Number(b.minutes||0),0);
  const rounds=blocks.reduce((s,b)=>s+Number(b.plannedRounds||0),0);
  const state=rec.verificationStatus||'PENDING';
  sum.textContent=`Line ${rec.lineId} / ${rec.shift} • Cycle ${rec.standardCycleMinPerRound||'-'} min/round • ${workMin} work min • ${rounds} planned rounds • ${state}`;
  if(!blocks.length){
    body.innerHTML=`<tr><td colspan="6">Draft only — provisional ${rec.provisionalRoundsPerHour||'-'} rounds/hour. Time blocks Pending Verification.</td></tr>`;
    return;
  }
  body.innerHTML=blocks.map(b=>`<tr>
    <td>${esc(b.start)}–${esc(b.end)}</td><td>${esc(b.type)}</td><td>${b.minutes}</td>
    <td>${b.cycleMin??'-'}</td><td>${b.plannedRounds??0}</td><td>${state}</td>
  </tr>`).join('');
}

document.getElementById('initShiftC')?.addEventListener('click',async()=>{
  if(!confirm('Initialize Line C Shift Master?\n\nDAY = confirmed 63 rounds / 630 work min\nNIGHT = confirmed 63 rounds / 630 work min (19:50–08:00)'))return;
  const btn=document.getElementById('initShiftC');
  try{
    btn.disabled=true;setStatus('Initializing Line C Shift…');
    await initLineCShift();setStatus('✓ Line C Shift initialized','ok');
    document.getElementById('shiftLineFilter').value='C';
    document.getElementById('shiftTypeFilter').value='DAY';
    await loadShiftMaster();
  }catch(e){setStatus((window.ProdV2Auth?ProdV2Auth.friendlyError(e):e.message),'err');alert(window.ProdV2Auth?ProdV2Auth.friendlyError(e):e.message)}finally{btn.disabled=false}
});
document.getElementById('initShiftDraft')?.addEventListener('click',async()=>{
  if(!confirm('Initialize A/B Shift Draft?\n\nWork hours/breaks = same as Line C (confirmed).\nCycle = still provisional 12 min/round — plannedRounds is an estimate, not verified.'))return;
  const btn=document.getElementById('initShiftDraft');
  try{
    btn.disabled=true;setStatus('Initializing A/B Shift Draft…');
    await initABShiftDraft();setStatus('✓ A/B Shift Draft initialized','ok');
    document.getElementById('shiftLineFilter').value='A';
    document.getElementById('shiftTypeFilter').value='DAY';
    await loadShiftMaster();
  }catch(e){setStatus((window.ProdV2Auth?ProdV2Auth.friendlyError(e):e.message),'err');alert(window.ProdV2Auth?ProdV2Auth.friendlyError(e):e.message)}finally{btn.disabled=false}
});
document.querySelector('[data-tab="shifts"]')?.addEventListener('click',()=>loadShiftMaster().catch(e=>setStatus(e.message,'err')));
