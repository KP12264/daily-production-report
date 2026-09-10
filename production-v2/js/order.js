(()=>{const $=id=>document.getElementById(id);
const val=x=>String(x??"").trim();
function stat(t,c=""){$("orderStatus").textContent=t;$("orderStatus").className="hero-status "+c}
function uploadNote(t,c=""){$("uploadMessage").textContent=t;$("uploadMessage").className="notice info-notice "+c}
function note(t,c=""){$("orderMessage").textContent=t;$("orderMessage").className="notice info-notice "+c}
async function all(n){const s=await ProdV2DB.collection(n).get();return s.docs.map(d=>({id:d.id,...d.data()}))}
function localDate(d=new Date()){const z=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`}
function addDays(dateStr,n){let d=new Date(dateStr+"T12:00:00");d.setDate(d.getDate()+n);return localDate(d)}
function daysBetweenInclusive(a,b){let da=new Date(a+"T12:00:00"),db=new Date(b+"T12:00:00");return Math.round((db-da)/86400000)+1}
function slug(s){return String(s||"").trim().toLowerCase().replace(/[^a-z0-9ก-๙]+/g,"-").replace(/^-+|-+$/g,"")||"x"}
function excelDateToStr(v){
 // รับได้ทั้ง string "YYYY-MM-DD" และ Excel serial date number
 if(typeof v==="number"){let d=new Date(Math.round((v-25569)*86400*1000));return localDate(d)}
 let s=val(v);
 let m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
 if(m)return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
 m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); // รองรับ DD/MM/YYYY เผื่อ Excel เซฟมาแบบนี้
 if(m)return `${m[3]}-${String(m[1]).padStart(2,"0")}-${String(m[2]).padStart(2,"0")}`;
 return null;
}

async function uploadOrder(){
 let f=$("orderFile").files?.[0];
 if(!f){uploadNote("เลือกไฟล์ Excel ก่อน","plan-warn");return}
 try{
  uploadNote("กำลังอ่านไฟล์...");
  let buf=await f.arrayBuffer();
  let wb=XLSX.read(buf,{type:"array"});
  let sheet=wb.Sheets[wb.SheetNames[0]];
  let rows=XLSX.utils.sheet_to_json(sheet,{defval:""});
  if(!rows.length){uploadNote("ไม่พบข้อมูลในไฟล์ (แถวแรกต้องเป็นหัวคอลัมน์)","plan-warn");return}
  const getField=(row,names)=>{for(const n of names){for(const k of Object.keys(row)){if(k.trim().toLowerCase()===n)return row[k]}}return ""};
  let ok=0,errors=[];
  for(let i=0;i<rows.length;i++){
   let r=rows[i],rowNo=i+2; // +2 = header row + 1-index
   let lineId=val(getField(r,["line","lineid"])).toUpperCase();
   let model=val(getField(r,["model","modelname"]));
   let door=val(getField(r,["door","doorcode"]));
   let qty=Number(getField(r,["qty","orderqty","จำนวน","จำนวนที่สั่ง"]))||0;
   let startDate=excelDateToStr(getField(r,["startdate","start"]));
   let dueDate=excelDateToStr(getField(r,["duedate","due"]));
   if(!lineId||!model||!qty||!startDate||!dueDate){errors.push(`แถว ${rowNo}: ข้อมูลไม่ครบ (ต้องมี Line, Model, Qty, StartDate, DueDate)`);continue}
   if(dueDate<startDate){errors.push(`แถว ${rowNo}: DueDate ต้องไม่ก่อน StartDate`);continue}
   let id=`order_${lineId}_${slug(model)}_${slug(door)}_${startDate}`;
   await ProdV2DB.set("prodV2_orders",id,{
    lineId,model,door,qty,startDate,dueDate,
    sourceFile:f.name,uploadedAt:Date.now()
   },{merge:true});
   ok++;
  }
  if(errors.length)console.warn("Order upload — แถวที่ข้าม:",errors);
  uploadNote(`อัปโหลดสำเร็จ ${ok} รายการ${errors.length?` · ข้าม ${errors.length} แถว (ดูรายละเอียดใน Console)`:""}`,errors.length?"plan-warn":"plan-ok");
  $("orderFile").value="";
 }catch(e){console.error(e);uploadNote("อัปโหลดไม่สำเร็จ: "+e.message,"plan-warn")}
}

async function loadTracking(){
 let lineFilter=$("orderLineFilter").value;
 try{
  stat("Loading...");
  $("orderBadge").textContent="LOADING";
  let orders=await all("prodV2_orders");
  if(lineFilter)orders=orders.filter(o=>o.lineId===lineFilter);
  if(!orders.length){$("orderTableArea").innerHTML='<div class="empty-state">ยังไม่มี Order ที่อัปโหลด</div>';$("orderBadge").textContent="0 ORDERS";stat("Ready","ok");return}
  const today=localDate();
  // เก็บทุก (date|||line|||shift) ที่ต้องใช้ กันซ้ำก่อนค่อยยิง Firestore ทีเดียว
  const neededKeys=new Set();
  const rangeOf=o=>{
   let endD=o.dueDate<today?o.dueDate:today;
   if(endD<o.startDate)return []; // ยังไม่ถึงวันเริ่ม Order
   let days=[];for(let d=o.startDate;d<=endD;d=addDays(d,1))days.push(d);
   return days;
  };
  orders.forEach(o=>{rangeOf(o).forEach(d=>{["DAY","NIGHT"].forEach(sh=>neededKeys.add(`${d}|||${o.lineId}|||${sh}`))})});
  const cache=new Map();
  const keys=[...neededKeys];
  const CHUNK=25; // จำกัดจำนวน request พร้อมกันต่อรอบ กันยิง Firestore รัวเกินไป
  for(let i=0;i<keys.length;i+=CHUNK){
   await Promise.all(keys.slice(i,i+CHUNK).map(async k=>{
    let [d,l,sh]=k.split("|||");
    let doc=await ProdV2DB.collection("prodV2_actualLogs").doc(`actual_${d}_${l}_${sh}`).get();
    cache.set(k,doc.exists?(doc.data().actualByCell||{}):{});
   }));
  }
  const rows=orders.map(o=>{
   let daysTotal=daysBetweenInclusive(o.startDate,o.dueDate);
   let dailyTarget=o.qty/daysTotal;
   let days=rangeOf(o);
   let daysElapsed=days.length;
   let targetToDate=Math.round(dailyTarget*daysElapsed);
   let actualToDate=0;
   days.forEach(d=>{
    ["DAY","NIGHT"].forEach(sh=>{
     let cell=cache.get(`${d}|||${o.lineId}|||${sh}`)||{};
     Object.entries(cell).forEach(([k,v])=>{
      let parts=k.split("|||"); // blockIndex|||model|||door
      if(parts[1]===o.model&&parts[2]===(o.door||""))actualToDate+=Number(v||0);
     });
    });
   });
   let diff=actualToDate-targetToDate,ach=targetToDate?actualToDate/targetToDate*100:(actualToDate>0?100:0);
   let status=o.startDate>today?{label:"YET TO START",cls:""}:diff>=0?{label:"ON TRACK",cls:"kpi-good"}:{label:"BEHIND",cls:"kpi-bad"};
   return {...o,daysTotal,dailyTarget,daysElapsed,targetToDate,actualToDate,diff,ach,status};
  });
  $("orderBadge").textContent=`${rows.length} ORDER${rows.length>1?"S":""}`;
  let h='<div class="production-matrix-viewport"><table class="grid actual-grid"><thead><tr><th class="model-col">Model / Door</th><th>Line</th><th>Order Qty</th><th>Start → Due</th><th>Day/Target</th><th>Elapsed</th><th>Target-to-date</th><th>Actual-to-date</th><th>Diff</th><th>Ach.</th><th>Status</th></tr></thead><tbody>';
  rows.forEach(r=>{
   h+=`<tr><td class="model-col actual-sticky"><div class="model-cell-clean"><b>${esc(r.model)}</b><small>${esc(r.door||"-")}</small></div></td>
   <td class="actual-cell">${esc(r.lineId)}</td>
   <td class="actual-cell">${r.qty.toLocaleString()}</td>
   <td class="actual-cell">${r.startDate} → ${r.dueDate}</td>
   <td class="actual-cell">${r.daysTotal}d / ${r.dailyTarget.toFixed(1)}</td>
   <td class="actual-cell">${r.daysElapsed}/${r.daysTotal}</td>
   <td class="actual-cell">${r.targetToDate.toLocaleString()}</td>
   <td class="actual-cell"><b>${r.actualToDate.toLocaleString()}</b></td>
   <td class="actual-cell"><b class="${r.diff<0?"kpi-bad":"kpi-good"}">${r.diff>0?"+":""}${r.diff.toLocaleString()}</b></td>
   <td class="actual-cell">${r.ach.toFixed(1)}%</td>
   <td class="actual-cell"><b class="${r.status.cls}">${r.status.label}</b></td></tr>`;
  });
  h+="</tbody></table></div>";
  $("orderTableArea").innerHTML=h;
  note(`โหลด Order Tracking แล้ว · ${rows.length} รายการ`,"plan-ok");
  stat("Loaded","ok");
 }catch(e){console.error(e);note(e.message,"plan-warn");stat("Load failed","err")}
}
function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

async function init(){
 $("uploadOrderBtn").onclick=uploadOrder;
 $("loadOrdersBtn").onclick=loadTracking;
 try{
  let lines=(await all("prodV2_lines")).filter(x=>x.active!==false).sort((a,b)=>(a.order||99)-(b.order||99));
  $("orderLineFilter").innerHTML='<option value="">All Lines</option>'+lines.map(x=>`<option value="${x.lineId||x.code||x.id}">${esc(x.lineName||x.name||"Line "+(x.lineId||x.code||x.id))}</option>`).join("");
  stat("Ready","ok");
 }catch(e){note(e.message,"plan-warn");stat("Load failed","err")}
}
addEventListener("DOMContentLoaded",init)})();
