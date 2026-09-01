(()=> {
  const KEY="prodV2_lastContext";
  function get(){try{return JSON.parse(localStorage.getItem(KEY)||"{}")||{}}catch(e){return{}}}
  function set(ctx){const next={...get(),...ctx};localStorage.setItem(KEY,JSON.stringify(next));return next}
  function bind(dateEl,lineEl,shiftEl){
    const ctx=get();
    if(dateEl&&ctx.date)dateEl.value=ctx.date;
    if(lineEl&&ctx.lineId&&[...lineEl.options].some(o=>o.value===ctx.lineId))lineEl.value=ctx.lineId;
    if(shiftEl&&ctx.shift&&[...shiftEl.options].some(o=>o.value===ctx.shift))shiftEl.value=ctx.shift;
    const save=()=>set({date:dateEl?.value||"",lineId:lineEl?.value||"",shift:shiftEl?.value||""});
    [dateEl,lineEl,shiftEl].filter(Boolean).forEach(el=>el.addEventListener("change",save));
  }
  window.ProdV2Context={get,set,bind};
})();
