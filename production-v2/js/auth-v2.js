// Production V2 Auth layer.
// Sign-in only — there is intentionally NO sign-up call anywhere in this file.
// Accounts are created by an admin in Firebase Console (Authentication > Users).
// Being signed in is necessary but not sufficient to write: Firestore Rules also
// require the user's derived address to exist in the prodV2_authorizedUsers collection.
//
// Employees log in with a short "รหัสพนักงาน" (employee code) instead of a real
// email address. Firebase Auth still requires an email-shaped identifier under the
// hood, so every code is silently suffixed with EMPLOYEE_DOMAIN before use — e.g.
// code "KP001" becomes "kp001@prodv2.local". Nothing is ever sent to that address;
// it's just an identifier. When creating accounts in Firebase Console > Users, use
// this same "<code>@prodv2.local" form (lowercase) as the email field, and use the
// identical string as the Document ID in prodV2_authorizedUsers.
(()=>{
 let authV2=null;
 const EMPLOYEE_DOMAIN="@prodv2.local";
 try{if(typeof firebase!=="undefined"&&firebase.apps&&firebase.apps.length)authV2=firebase.auth();}catch(e){console.error("Production V2 Auth init failed",e)}

 function codeToEmail(code){return String(code||"").trim().toLowerCase().replace(/\s+/g,"")+EMPLOYEE_DOMAIN}
 function emailToCode(email){return String(email||"").replace(EMPLOYEE_DOMAIN,"")}

 function onAuthChange(cb){if(!authV2)return;authV2.onAuthStateChanged(cb)}
 async function signIn(code,password){if(!authV2)throw new Error("Auth not available");return authV2.signInWithEmailAndPassword(codeToEmail(code),password)}
 async function signOutV2(){if(!authV2)return;return authV2.signOut()}
 function currentUser(){return authV2?authV2.currentUser:null}
 function isLoggedIn(){return !!currentUser()}
 // Turns a raw Firestore/Auth error into a message a factory-floor user can act on.
 // Every write path in this app should route its catch-block error through this.
 function friendlyError(e){
  let code=(e&&e.code)||"",msg=(e&&e.message)||String(e||"");
  if(code==="permission-denied"||/permission-denied/i.test(msg))return accessRole==="viewer"?"บันทึกไม่สำเร็จ: บัญชีนี้มีสิทธิ์ดูอย่างเดียว (Viewer)":"บันทึกไม่สำเร็จ: ต้อง Login ก่อนถึงจะแก้ไขข้อมูลได้ (กด Login ที่แถบด้านบน)";
  return msg||code||"unknown error";
 }

 // ── Access (Security plan A): every page reads Production V2 data only after sign-in AND a role.
 // The role comes from the user's OWN prodV2_authorizedUsers/{email} document (one get, never a list):
 //   no document / active:false → "none" · role "viewer" → read only · role "editor" or no role → read + write
 // (the existing allowlist documents have no role and stay editors). Firestore Rules enforce the same.
 function roleOf(d){if(!d||d.active===false)return"none";const r=d.role==null?"editor":String(d.role);return r==="viewer"||r==="editor"?r:"none"}
 let accessRole=null;const accessWaiters=[];
 function domReady(fn){if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",fn,{once:true});else fn()}
 function fireAccess(role){accessRole=role;domReady(()=>{while(accessWaiters.length){try{accessWaiters.shift()(role)}catch(e){console.error(e)}}})}
 // Pages call whenAccess(init) instead of DOMContentLoaded: init runs once, after the DOM is ready and access is granted.
 function whenAccess(fn){accessWaiters.push(fn);if(accessRole)fireAccess(accessRole)}
 async function fetchRole(user){
  const snap=await ProdV2DB.collection("prodV2_authorizedUsers").doc(String(user.email||"").toLowerCase()).get();
  return roleOf(snap.exists?snap.data():null);
 }
 // Login gate that hides the page's data until the user has a role. Same banner markup / CSS as mountGate.
 //   contentId:     element to hide while locked (pages with #appMain)
 //   hideFollowing: hide the host's following sibling elements instead (pages without a wrapper; no new markup)
 //   lockTargetId:  gets "readonly-mode" for viewers (existing CSS greys out write-only controls)
 function requireAccess({hostId,logoutHostId,lockTargetId,contentId,hideFollowing}){
  const host=document.getElementById(hostId);if(!host)return;
  const content=contentId?document.getElementById(contentId):null,lockTarget=lockTargetId?document.getElementById(lockTargetId):null;
  const following=[];if(hideFollowing){let n=host.nextElementSibling;while(n){if(n.tagName!=="SCRIPT")following.push(n);n=n.nextElementSibling}}
  const show=v=>(content?[content]:following).forEach(el=>{el.style.display=v?"":"none"});
  show(false);
  host.innerHTML=`
   <div class="auth-banner" id="authBanner">
    <span class="auth-banner-icon">🔒</span>
    <span class="auth-banner-text" id="authBannerText">ต้อง Login ก่อนจึงจะดูข้อมูลได้</span>
    <span id="authForm"><input id="authEmail" type="text" placeholder="รหัสพนักงาน" autocomplete="username">
    <input id="authPassword" type="password" placeholder="Password" autocomplete="current-password">
    <button id="authSignInBtn">เข้าสู่ระบบ</button></span>
    <button id="authSignOutGateBtn" style="display:none">ออกจากระบบ</button>
    <span id="authError" class="auth-banner-err" style="display:none"></span>
   </div>`;
  const $h=s=>host.querySelector(s),err=$h("#authError");
  const banner=(text,form)=>{host.style.display="";$h("#authBannerText").textContent=text;$h("#authForm").style.display=form?"":"none";$h("#authSignOutGateBtn").style.display=form?"none":""};
  $h("#authSignInBtn").onclick=async()=>{
   const code=$h("#authEmail").value,pw=$h("#authPassword").value;
   if(!code||!pw){err.textContent="กรอกรหัสพนักงานและ Password";err.style.display="inline";return}
   try{err.style.display="none";await signIn(code,pw)}catch(e){err.textContent="เข้าสู่ระบบไม่สำเร็จ: "+(e.message||e.code||"unknown error");err.style.display="inline"}
  };
  host.querySelectorAll("#authEmail,#authPassword").forEach(el=>el.addEventListener("keydown",e=>{if(e.key==="Enter")$h("#authSignInBtn").click()}));
  $h("#authSignOutGateBtn").onclick=()=>signOutV2();
  if(!authV2){banner("ระบบ Login ไม่พร้อมใช้งาน — โหลดหน้าใหม่",false);$h("#authSignOutGateBtn").style.display="none";return}
  let seenUser=false;
  onAuthChange(async user=>{
   if(!user){if(seenUser){location.reload();return}banner("ต้อง Login ก่อนจึงจะดูข้อมูลได้",true);show(false);return}
   seenUser=true;banner("กำลังตรวจสิทธิ์…",false);$h("#authSignOutGateBtn").style.display="none";
   let role;try{role=await fetchRole(user)}catch(e){console.error(e);banner("ตรวจสิทธิ์ไม่สำเร็จ — โหลดหน้าใหม่อีกครั้ง",false);return}
   if(role!=="viewer"&&role!=="editor"){banner("บัญชีนี้ไม่มีสิทธิ์ดูข้อมูล Production V2 — ติดต่อผู้ดูแลระบบ",false);show(false);return}
   host.style.display="none";
   if(lockTarget)lockTarget.classList.toggle("readonly-mode",role==="viewer");
   if(logoutHostId){const lh=document.getElementById(logoutHostId);if(lh){lh.innerHTML=`<span class="auth-user">${emailToCode(user.email)}</span> <button id="authSignOutBtn" class="link-btn">ออกจากระบบ</button>`;document.getElementById("authSignOutBtn").onclick=()=>signOutV2()}}
   show(true);fireAccess(role);
  });
 }

 // Renders a slim, non-blocking banner into `hostId` — page content underneath
 // stays visible and usable for everyone (viewers included) at all times; only
 // actual Firestore *writes* are blocked (by Firestore Rules, not by hiding UI).
 // The banner shows a compact login form while signed out, and disappears once
 // signed in (logoutHostId then shows "<code> · ออกจากระบบ").
 // lockTargetId (optional): an element (e.g. "appMain") that gets a
 // "readonly-mode" class while signed out, so CSS can grey out / disable the
 // specific write-only controls each page has marked (see app.css) — without
 // needing every render() call across the app to know about auth state.
 function mountGate({hostId,logoutHostId,lockTargetId,onReady}){
  const host=document.getElementById(hostId);
  if(!host)return;
  host.innerHTML=`
   <div class="auth-banner" id="authBanner">
    <span class="auth-banner-icon">🔒</span>
    <span class="auth-banner-text">กำลังดูแบบอ่านอย่างเดียว — Login เพื่อแก้ไขข้อมูล</span>
    <input id="authEmail" type="text" placeholder="รหัสพนักงาน" autocomplete="username">
    <input id="authPassword" type="password" placeholder="Password" autocomplete="current-password">
    <button id="authSignInBtn">เข้าสู่ระบบ</button>
    <span id="authError" class="auth-banner-err" style="display:none"></span>
   </div>`;
  const err=host.querySelector("#authError");
  function showErr(msg){err.textContent=msg;err.style.display="inline"}
  host.querySelector("#authSignInBtn").onclick=async()=>{
   let code=host.querySelector("#authEmail").value,pw=host.querySelector("#authPassword").value;
   if(!code||!pw){showErr("กรอกรหัสพนักงานและ Password");return}
   try{err.style.display="none";await signIn(code,pw)}
   catch(e){showErr("เข้าสู่ระบบไม่สำเร็จ: "+(e.message||e.code||"unknown error"))}
  };
  host.querySelectorAll("#authEmail,#authPassword").forEach(el=>el.addEventListener("keydown",e=>{if(e.key==="Enter")host.querySelector("#authSignInBtn").click()}));

  const lockTarget=lockTargetId?document.getElementById(lockTargetId):null;
  onAuthChange(user=>{
   if(user){
    host.style.display="none";
    lockTarget?.classList.remove("readonly-mode");
    if(logoutHostId){
     const lh=document.getElementById(logoutHostId);
     if(lh)lh.innerHTML=`<span class="auth-user">${emailToCode(user.email)}</span> <button id="authSignOutBtn" class="link-btn">ออกจากระบบ</button>`,
      document.getElementById("authSignOutBtn").onclick=()=>signOutV2();
    }
    onReady&&onReady(user);
   }else{
    host.style.display="";
    lockTarget?.classList.add("readonly-mode");
    if(logoutHostId){const lh=document.getElementById(logoutHostId);if(lh)lh.innerHTML=""}
    onReady&&onReady(null);
   }
  });
 }

 window.ProdV2Auth={signIn,signOut:signOutV2,currentUser,isLoggedIn,friendlyError,onAuthChange,mountGate,codeToEmail,roleOf,requireAccess,whenAccess,role:()=>accessRole};
})();
