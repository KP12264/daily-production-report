const LINE_COLLECTION='prodV2_lines';
const statusEl=document.getElementById('saveStatus');
const body=document.getElementById('lineRows');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function setStatus(t,c=''){statusEl.textContent=t;statusEl.className='status '+c}

function rowHtml(x={},docId='',isNew=false){
  const id=x.lineId||'', name=x.lineName||'', order=Number(x.order||0);
  return `<tr>
    <td><input value="${esc(id)}" placeholder="A" data-k="lineId" ${isNew?'':'readonly'}></td>
    <td><input value="${esc(name)}" placeholder="Line A" data-k="lineName"></td>
    <td><input type="number" min="1" value="${order||''}" data-k="order"></td>
    <td><select data-k="active"><option value="true" ${x.active!==false?'selected':''}>Active</option><option value="false" ${x.active===false?'selected':''}>Inactive</option></select></td>
    <td class="right"><button ${isNew?'data-save-new':`data-save="${esc(docId)}"`}>Save</button></td>
  </tr>`;
}

async function loadLines(){
  body.innerHTML='<tr><td colspan="5" class="empty">Loading…</td></tr>';
  try{
    const snap=await ProdV2DB.collection(LINE_COLLECTION).orderBy('order').get();
    if(snap.empty){
      body.innerHTML='<tr><td colspan="5" class="empty">ยังไม่มี Line ใน V2 — กด Add Line เพื่อเริ่มสร้าง Master</td></tr>';
      return;
    }
    body.innerHTML='';
    snap.forEach(d=>body.insertAdjacentHTML('beforeend',rowHtml(d.data(),d.id,false)));
  }catch(e){
    setStatus(e.message,'err');
    body.innerHTML='<tr><td colspan="5" class="empty">โหลดไม่ได้ — ตรวจ Firestore Rules/Internet</td></tr>';
  }
}

document.getElementById('addLine').addEventListener('click',()=>{
  body.querySelector('.empty')?.closest('tr')?.remove();
  const orders=[...body.querySelectorAll('[data-k="order"]')].map(el=>Number(el.value)||0);
  const nextOrder=Math.max(0,...orders)+1;
  body.insertAdjacentHTML('beforeend',rowHtml({order:nextOrder,active:true},'',true));
  body.lastElementChild.querySelector('[data-k="lineId"]').focus();
  setStatus('New line ready');
});

body.addEventListener('click',async e=>{
  const btn=e.target.closest('button');
  if(!btn || (!btn.hasAttribute('data-save') && !btn.hasAttribute('data-save-new'))) return;
  const tr=btn.closest('tr'), get=k=>tr.querySelector(`[data-k="${k}"]`).value;
  const lineId=get('lineId').trim().toUpperCase();
  if(!lineId) return alert('กรุณาใส่ Line ID');
  const data={lineId,lineName:get('lineName').trim()||('Line '+lineId),order:Number(get('order'))||0,active:get('active')==='true',updatedAt:Date.now()};
  const id=btn.dataset.save||('line_'+lineId.replace(/[^a-zA-Z0-9_-]/g,'_'));
  try{
    setStatus('Saving…'); btn.disabled=true;
    await ProdV2DB.set(LINE_COLLECTION,id,data,{merge:true});
    setStatus('✓ Saved','ok');
    await loadLines();
  }catch(err){setStatus(err.message,'err');btn.disabled=false}
});
loadLines();
