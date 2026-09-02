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

 // Renders a full-page login gate into `hostId` and calls onReady() once a signed-in
 // user is confirmed. Also wires up a "logout" control if `logoutHostId` is given.
 function mountGate({hostId,logoutHostId,onReady}){
  const host=document.getElementById(hostId);
  if(!host)return;
  host.innerHTML=`
   <div class="auth-gate">
    <div class="auth-card">
     <h2>เข้าสู่ระบบ Production V2</h2>
     <p>ต้อง Login ด้วยรหัสพนักงานที่แอดมินสร้างให้ก่อนใช้งานหน้านี้</p>
     <label><span>รหัสพนักงาน</span><input id="authEmail" type="text" autocomplete="username" placeholder="เช่น KP001"></label>
     <label><span>PASSWORD</span><input id="authPassword" type="password" autocomplete="current-password"></label>
     <button id="authSignInBtn" class="primary">เข้าสู่ระบบ</button>
     <p class="auth-forgot-note">ลืมรหัสผ่าน? ติดต่อแอดมินให้ตั้งรหัสใหม่ให้ (ไม่มีอีเมลรับลิงก์ตั้งรหัสผ่านเอง)</p>
     <div id="authError" class="notice info-notice" style="display:none"></div>
    </div>
   </div>`;
  const err=host.querySelector("#authError");
  function showErr(msg){err.textContent=msg;err.style.display="block"}
  host.querySelector("#authSignInBtn").onclick=async()=>{
   let code=host.querySelector("#authEmail").value,pw=host.querySelector("#authPassword").value;
   if(!code||!pw){showErr("กรอกรหัสพนักงานและ Password");return}
   try{err.style.display="none";await signIn(code,pw)}
   catch(e){showErr("เข้าสู่ระบบไม่สำเร็จ: "+(e.message||e.code||"unknown error"))}
  };
  host.querySelectorAll("#authEmail,#authPassword").forEach(el=>el.addEventListener("keydown",e=>{if(e.key==="Enter")host.querySelector("#authSignInBtn").click()}));

  onAuthChange(user=>{
   if(user){
    host.style.display="none";
    if(logoutHostId){
     const lh=document.getElementById(logoutHostId);
     if(lh)lh.innerHTML=`<span class="auth-user">${emailToCode(user.email)}</span> <button id="authSignOutBtn" class="link-btn">ออกจากระบบ</button>`,
      document.getElementById("authSignOutBtn").onclick=()=>signOutV2();
    }
    onReady&&onReady(user);
   }else{
    host.style.display="";
    if(logoutHostId){const lh=document.getElementById(logoutHostId);if(lh)lh.innerHTML=""}
   }
  });
 }

 window.ProdV2Auth={signIn,signOut:signOutV2,currentUser,onAuthChange,mountGate,codeToEmail};
})();
