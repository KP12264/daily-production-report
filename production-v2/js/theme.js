// Production V2 — Light/Dark theme toggle. Persisted per-device (localStorage),
// applied via [data-theme="dark"] on <html>, which app.css keys its dark
// palette off of. A tiny inline snippet in each page's <head> (see the
// "theme-init" script tag) already applies the saved choice before first
// paint, so this file only needs to wire up the toggle button's click.
(()=>{
 const KEY="prodv2-theme";
 function current(){return document.documentElement.getAttribute("data-theme")==="dark"?"dark":"light"}
 function apply(theme){
  document.documentElement.setAttribute("data-theme",theme==="dark"?"dark":"light");
  const btn=document.getElementById("themeToggle");
  if(btn)btn.textContent=theme==="dark"?"☀️ Light":"🌙 Dark";
 }
 function toggle(){
  const next=current()==="dark"?"light":"dark";
  try{localStorage.setItem(KEY,next)}catch(e){/* private mode etc — theme just won't persist */}
  apply(next);
 }
 function init(){
  apply(current()); // sync button label with whatever the head snippet already applied
  const btn=document.getElementById("themeToggle");
  if(btn)btn.onclick=toggle;
 }
 if(document.readyState==="loading")addEventListener("DOMContentLoaded",init);else init();
 window.ProdV2Theme={toggle,current};
})();
