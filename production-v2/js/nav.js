// Production V2 — grouped nav dropdown (ติดตาม / ทำงาน). Click-to-toggle
// (not hover) so it works on touch; closes on outside click or Escape.
(()=>{
 function closeAll(except){
  document.querySelectorAll(".nav-dropdown.open").forEach(dd=>{if(dd!==except)dd.classList.remove("open")});
 }
 function init(){
  document.querySelectorAll(".nav-group-btn").forEach(btn=>{
   btn.addEventListener("click",e=>{
    e.stopPropagation();
    const dd=btn.nextElementSibling;
    const willOpen=!dd.classList.contains("open");
    closeAll(dd);
    dd.classList.toggle("open",willOpen);
   });
  });
  document.addEventListener("click",()=>closeAll(null));
  document.addEventListener("keydown",e=>{if(e.key==="Escape")closeAll(null)});
 }
 if(document.readyState==="loading")addEventListener("DOMContentLoaded",init);else init();
})();
