// Production V2 Auth layer.
// Sign-in only — there is intentionally NO sign-up call anywhere in this file.
// Accounts are created by an admin in Firebase Console (Authentication > Users).
// Being signed in is necessary but not sufficient to write: Firestore Rules also
// require the user's email to exist in the prodV2_authorizedUsers collection.
(()=>{
 let authV2=null;
 try{if(typeof firebase!=="undefined"&&firebase.apps&&firebase.apps.length)authV2=firebase.auth();}catch(e){console.error("Production V2 Auth init failed",e)}

 function onAuthChange(cb){if(!authV2)return;authV2.onAuthStateChanged(cb)}
 async function signIn(email,password){if(!authV2)throw new Error("Auth not available");return authV2.signInWithEmailAndPassword(String(email||"").trim(),password)}
 async function signOutV2(){if(!authV2)return;return authV2.signOut()}
 function currentUser(){return authV2?authV2.currentUser:null}
 async function sendPasswordReset(email){if(!authV2)throw new Error("Auth not available");return authV2.sendPasswordResetEmail(String(email||"").trim())}

 // Renders a full-page login gate into `hostId` and calls onReady() once a signed-in
 // user is confirmed. Also wires up a "logout" control if `logoutHostId` is given.
 function mountGate({hostId,logoutHostId,onReady}){
  const host=document.getElementById(hostId);
  if(!host)return;
  host.innerHTML=`
   <div class="auth-gate">
    <div class="auth-card">
     <h2>เข้าสู่ระบบ Production V2</h2>
     <p>ต้อง Login ด้วยบัญชีพนักงานที่แอดมินสร้างให้ก่อนใช้งานหน้านี้</p>
     <label><span>EMAIL</span><input id="authEmail" type="email" autocomplete="username"></label>
     <label><span>PASSWORD</span><input id="authPassword" type="password" autocomplete="current-password"></label>
     <button id="authSignInBtn" class="primary">เข้าสู่ระบบ</button>
     <button id="authForgotBtn" class="link-btn" style="margin-top:10px">ลืมรหัสผ่าน?</button>
     <div id="authError" class="notice info-notice" style="display:none"></div>
     <div id="authInfo" class="notice info-notice" style="display:none;background:#f0fdf4;border-color:#bbf7d0;color:#15803d"></div>
    </div>
   </div>`;
  const err=host.querySelector("#authError"),info=host.querySelector("#authInfo");
  function showErr(msg){info.style.display="none";err.textContent=msg;err.style.display="block"}
  function showInfo(msg){err.style.display="none";info.textContent=msg;info.style.display="block"}
  host.querySelector("#authSignInBtn").onclick=async()=>{
   let email=host.querySelector("#authEmail").value,pw=host.querySelector("#authPassword").value;
   if(!email||!pw){showErr("กรอก Email และ Password");return}
   try{err.style.display="none";await signIn(email,pw)}
   catch(e){showErr("เข้าสู่ระบบไม่สำเร็จ: "+(e.message||e.code||"unknown error"))}
  };
  host.querySelector("#authForgotBtn").onclick=async()=>{
   let email=host.querySelector("#authEmail").value;
   if(!email){showErr("กรอก Email ในช่องด้านบนก่อน แล้วกดลืมรหัสผ่านอีกครั้ง");return}
   try{await sendPasswordReset(email);showInfo("ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ "+email+" แล้ว (เช็คใน Inbox / Spam)")}
   catch(e){showErr("ส่งลิงก์ไม่สำเร็จ: "+(e.message||e.code||"unknown error"))}
  };
  host.querySelectorAll("#authEmail,#authPassword").forEach(el=>el.addEventListener("keydown",e=>{if(e.key==="Enter")host.querySelector("#authSignInBtn").click()}));

  onAuthChange(user=>{
   if(user){
    host.style.display="none";
    if(logoutHostId){
     const lh=document.getElementById(logoutHostId);
     if(lh)lh.innerHTML=`<span class="auth-user">${user.email}</span> <button id="authSignOutBtn" class="link-btn">ออกจากระบบ</button>`,
      document.getElementById("authSignOutBtn").onclick=()=>signOutV2();
    }
    onReady&&onReady(user);
   }else{
    host.style.display="";
    if(logoutHostId){const lh=document.getElementById(logoutHostId);if(lh)lh.innerHTML=""}
   }
  });
 }

 window.ProdV2Auth={signIn,signOut:signOutV2,currentUser,onAuthChange,mountGate,sendPasswordReset};
})();
