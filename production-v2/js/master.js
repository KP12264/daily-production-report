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
  catch(err){setStatus(err.message,'err');btn.disabled=false}
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
    setStatus(err.message,'err');
    alert('Initialize ไม่สำเร็จ: '+err.message);
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
  }catch(err){setStatus(err.message,'err');btn.disabled=false}
});

(async()=>{await loadLines();})();
