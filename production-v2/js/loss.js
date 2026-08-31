(()=>{const $=id=>document.getElementById(id);let S={lines:[],plan:null,manual:[],loaded:false};
const val=x=>String(x??"").trim();
function localDate(d=new Date()){const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
function mins(t){let [h,m]=String(t).split(":").map(Number);return h*60+m}
function norm(t){let s=val(t).replace(/[^\d:]/g,"");if(/^\d{4}$/.test(s))s=s.slice(0,2)+":"+s.slice(2);if(!/^\d{1,2}:\d{2}$/.test(s))return null;let [h,m]=s.split(":").map(Number);if(h>23||m>59)return null;return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`}
function duration(a,b){let x=mins(b)-mins(a);if(x<0)x+=1440;return x}
function note(t,c=""){$("lossMessage").textContent=t;$("lossMessage").className="notice info-notice "+c}
function stat(t,c=""){$("lossStatus").textContent=t;$("lossStatus").className="hero-status "+c}
async function all(n){const s=await ProdV2DB.collection(n).get();return s.docs.map(d=>({id:d.id,...d.data()}))}
function autoLosses(){return S.plan?.masterSnapshot?.palletChangeLosses||[]}
function allLosses(){return [...autoLosses().map((x,i)=>({...x,id:`auto_${i}`,auto:true,category:x.category||"Pallet Change",remark:"จาก Daily Plan"})),...S.manual.map(x=>({...x,auto:false}))]}
function render(){
 let rows=allLosses(),total=rows.reduce((s,x)=>s+Number(x.minutes||duration(x.start,x.end)||0),0),auto=rows.filter(x=>x.auto).reduce((s,x)=>s+Number(x.minutes||0),0),manual=total-auto;
 $("lossKpis").innerHTML=`<div class="entry-kpi"><small>TOTAL LOSS</small><b>${total} min</b></div><div class="entry-kpi"><small>PALLET CHANGE</small><b>${auto} min</b></div><div class="entry-kpi"><small>OTHER LOSS</small><b>${manual} min</b></div><div class="entry-kpi"><small>RECORDS</small><b>${rows.length}</b></div>`;
 if(!rows.length){$("lossList").innerHTML='<div class="empty-state">ยังไม่มี Loss ในกะนี้</div>';return}
 let h='<div class="table-scroll"><table class="grid loss-table"><thead><tr><th>Start</th><th>End</th><th>Minutes</th><th>Category</th><th>Remark</th><th>Source</th><th></th></tr></thead><tbody>';
 rows.forEach(x=>{h+=`<tr><td>${x.start||"-"}</td><td>${x.end||"-"}</td><td><b>${Number(x.minutes||duration(x.start,x.end)||0)}</b></td><td>${x.category||x.type||"-"}</td><td>${x.remark||"-"}</td><td>${x.auto?'<span class="source-auto">DAILY PLAN</span>':'MANUAL'}</td><td>${x.auto?"":`<button class="loss-delete" data-del="${x.id}">Delete</button>`}</td></tr>`});h+='</tbody></table></div>';$("lossList").innerHTML=h;
 document.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>remove(b.dataset.del))
}
async function load(){
 let d=$("lossDate").value,l=$("lossLine").value.toUpperCase(),sh=$("lossShift").value,pid=`plan_${d}_${l}_${sh}`;
 try{stat("Loading...");let [pd,snap]=await Promise.all([ProdV2DB.collection("prodV2_dailyPlans").doc(pid).get(),ProdV2DB.collection("prodV2_lossLogs").where("date","==",d).where("lineId","==",l).where("shift","==",sh).get()]);
 S.plan=pd.exists?{id:pd.id,...pd.data()}:null;S.manual=snap.docs.map(x=>({id:x.id,...x.data()}));S.loaded=true;render();$("lossBadge").textContent="LOADED";note(pd.exists?"โหลดข้อมูลสำเร็จ · Pallet Change Loss เชื่อมจาก Saved Daily Plan แล้ว":"โหลดข้อมูลสำเร็จ · ไม่พบ Saved Daily Plan จึงไม่มี Pallet Change Loss อัตโนมัติ",pd.exists?"plan-ok":"plan-warn");stat("Loaded","ok")
 }catch(e){console.error(e);note(e.message,"plan-warn");stat("Load failed","err")}
}
async function add(){
 if(!S.loaded){note("กด Load ก่อนเพิ่ม Loss","plan-warn");return}
 let start=norm($("lossStart").value),end=norm($("lossEnd").value),category=$("lossCategory").value,remark=val($("lossRemark").value);
 if(!start||!end){note("กรุณาใส่เวลา 24 ชั่วโมง เช่น 14:20 และ 14:30","plan-warn");return}
 let m=duration(start,end);if(m<=0){note("End ต้องต่างจาก Start","plan-warn");return}
 let data={date:$("lossDate").value,lineId:$("lossLine").value.toUpperCase(),shift:$("lossShift").value,category,start,end,minutes:m,remark,source:"MANUAL",updatedAt:firebase.firestore.FieldValue.serverTimestamp(),version:1};
 try{stat("Saving...");let r=await ProdV2DB.add("prodV2_lossLogs",data);S.manual.push({id:r.id,...data});render();$("lossStart").value="";$("lossEnd").value="";$("lossRemark").value="";note(`บันทึก ${category} Loss ${m} นาทีแล้ว`,"plan-ok");stat("Saved","ok")}catch(e){note(e.message,"plan-warn");stat("Save failed","err")}
}
async function remove(id){try{await ProdV2DB.delete("prodV2_lossLogs",id);S.manual=S.manual.filter(x=>x.id!==id);render();note("ลบ Loss แล้ว","plan-ok")}catch(e){note(e.message,"plan-warn")}}
async function init(){$("lossDate").value=localDate();$("loadLossBtn").onclick=load;$("addLossBtn").onclick=add;["lossStart","lossEnd"].forEach(id=>$(id).onblur=()=>{let t=norm($(id).value);if(t)$(id).value=t});try{S.lines=(await all("prodV2_lines")).filter(x=>x.active!==false).sort((a,b)=>(a.order||99)-(b.order||99));$("lossLine").innerHTML=S.lines.map(x=>`<option value="${x.lineId||x.code||x.id}">${x.name||"Line "+(x.lineId||x.code||x.id)}</option>`).join("")}catch(e){note(e.message,"plan-warn")}}
addEventListener("DOMContentLoaded",init)})();