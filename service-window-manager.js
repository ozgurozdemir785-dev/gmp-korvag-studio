(()=>{
'use strict';
/* GMP_SERVICE_WINDOW_MANAGER_V1
   Originalrutten visas alltid komplett.
   Användaren kan välja från vilken hållplats bussen ska sättas i trafik.
   Valfritt kan även sista trafikerade hållplats väljas.
   Själva körningen begränsas till valt fönster; ordinarie linjegeometri ändras inte.
*/
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function A(){return window.GMP_APP||null}
function stopKey(st,i){return String(st?.id||st?.code||((st?.name||'Hållplats')+'#'+i))}
function currentStops(){const a=A(),d=a?.dir?.();return d?.stops||[]}
function ensureUI(){
  const host=$('leftSecRoute')?.querySelector('.sectionBody')||$('autoDetourBox');
  if(!host||$('serviceWindowBox'))return;
  const box=document.createElement('div');box.id='serviceWindowBox';box.style.cssText='grid-column:1/-1;border:1px solid #cfd8e6;background:#fff;border-radius:10px;padding:8px;margin:6px 0';
  box.innerHTML=`
    <div style="display:flex;justify-content:space-between;gap:6px;align-items:center"><b style="font-size:11px">🚌 Trafikstart / trafikslut</b><button id="serviceWindowReset" class="btn small">Hela linjen</button></div>
    <div style="font-size:9px;color:#667085;margin:5px 0 7px">Originalrutten ligger alltid kvar. Här bestämmer du bara var bussen börjar och, om du vill, var den slutar trafikera.</div>
    <label style="display:block;font-size:9px;font-weight:800;color:#475467;margin-bottom:3px">Sätt bussen i trafik från</label>
    <select id="serviceStartStop" style="width:100%;padding:7px;border:1px solid #cfd8e6;border-radius:8px;background:#fff"></select>
    <label style="display:block;font-size:9px;font-weight:800;color:#475467;margin:7px 0 3px">Sista trafikerade hållplats (valfritt)</label>
    <select id="serviceEndStop" style="width:100%;padding:7px;border:1px solid #cfd8e6;border-radius:8px;background:#fff"></select>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px"><button id="serviceWindowApply" class="btn primary small">✓ Använd</button><button id="serviceWindowStartNow" class="btn green small">▶ Börja här nu</button></div>
    <div id="serviceWindowStatus" style="font-size:9px;color:#475467;margin-top:6px">Hela linjen körs.</div>`;
  const anchor=$('autoDetourBox')||$('detourWorkflowState');
  if(anchor&&anchor.parentElement===host)host.insertBefore(box,anchor);else host.appendChild(box);
  $('serviceWindowReset').onclick=resetWindow;
  $('serviceWindowApply').onclick=()=>applyWindow(false);
  $('serviceWindowStartNow').onclick=()=>applyWindow(true);
  refresh();
}
function refresh(){
  ensureUI();const a=A(),d=a?.dir?.();if(!d||!$('serviceStartStop'))return;
  const stops=currentStops(),startSel=$('serviceStartStop'),endSel=$('serviceEndStop');
  const currentStart=String(d.serviceStartStopId||''),currentEnd=String(d.serviceEndStopId||'');
  const opts=stops.map((st,i)=>`<option value="${esc(stopKey(st,i))}">${i+1}. ${esc(st.name||'Hållplats')}${st.code?' · '+esc(st.code):''}${st.serve===false||st.closed?' · INDRAGEN':''}</option>`).join('');
  startSel.innerHTML='<option value="">Första hållplatsen – hela linjen</option>'+opts;
  endSel.innerHTML='<option value="">Sista hållplatsen – hela linjen</option>'+opts;
  if([...startSel.options].some(o=>o.value===currentStart))startSel.value=currentStart;else startSel.value='';
  if([...endSel.options].some(o=>o.value===currentEnd))endSel.value=currentEnd;else endSel.value='';
  updateStatus();
}
function selectedStopByKey(key){const stops=currentStops();for(let i=0;i<stops.length;i++)if(stopKey(stops[i],i)===String(key))return{st:stops[i],i};return null}
function updateStatus(){const a=A(),d=a?.dir?.(),el=$('serviceWindowStatus');if(!d||!el)return;const s=selectedStopByKey(d.serviceStartStopId),e=selectedStopByKey(d.serviceEndStopId);if(!s&&!e){el.textContent='Hela linjen körs.';return}el.textContent=`Aktiv körning: ${s?.st?.name||'första hållplatsen'} → ${e?.st?.name||'sista hållplatsen'}. Originalrutten visas fortfarande komplett.`}
function resetWindow(){const a=A(),d=a?.dir?.();if(!a||!d)return;delete d.serviceStartStopId;delete d.serviceEndStopId;a.state.driveRoute=null;a.state.busProgress=0;a.state.simSpeed=0;refresh();a.renderAll?.();try{a.toast?.('Hela linjen är åter vald som aktiv körning.',3000)}catch{}}
function applyWindow(startNow){
  const a=A(),d=a?.dir?.();if(!a||!d)return;const sk=$('serviceStartStop')?.value||'',ek=$('serviceEndStop')?.value||'',s=selectedStopByKey(sk),e=selectedStopByKey(ek);
  if(s&&e&&e.i<=s.i){const el=$('serviceWindowStatus');if(el)el.textContent='⚠ Sluthållplatsen måste ligga efter starthållplatsen i vald riktning.';return}
  if(s&&(s.st.serve===false||s.st.closed)){const el=$('serviceWindowStatus');if(el)el.textContent='⚠ Den valda starthållplatsen är indragen. Välj ett aktivt eller alternativt hållplatsläge.';return}
  if(e&&(e.st.serve===false||e.st.closed)){const el=$('serviceWindowStatus');if(el)el.textContent='⚠ Den valda sluthållplatsen är indragen. Välj ett aktivt eller alternativt hållplatsläge.';return}
  d.serviceStartStopId=sk||'';d.serviceEndStopId=ek||'';a.state.driveRoute=null;a.state.busProgress=0;a.state.simSpeed=0;
  const route=a.buildDriveRoute?.(d)||[];
  if(s&&route.length>1){const n=a.nearestPointOnRoute?.(route,s.st.coord);if(!n||n.offset>65){const el=$('serviceWindowStatus');if(el)el.textContent='⚠ Vald starthållplats ligger inte på den aktiva körvägen. Välj en trafikerad hållplats eller ändra omläggningen.';return}}
  if(e&&route.length>1){const n=a.nearestPointOnRoute?.(route,e.st.coord);if(!n||n.offset>65){const el=$('serviceWindowStatus');if(el)el.textContent='⚠ Vald sluthållplats ligger inte på den aktiva körvägen.';return}}
  updateStatus();a.renderStopManager?.();a.renderAll?.();
  try{a.toast?.(`Bussen ${s?'sätts i trafik vid '+s.st.name:'kör från linjens början'}${e?' och slutar vid '+e.st.name:''}. Originalrutten ligger kvar.`,4000)}catch{}
  if(startNow){try{if(a.state.playing)a.state.playing=false}catch{};setTimeout(()=>document.getElementById('playBtn')?.click(),120)}
}
function watch(){ensureUI();const a=A(),d=a?.dir?.();if(!d)return;const sig=(d.stops||[]).map((s,i)=>stopKey(s,i)+'|'+(s.name||'')+'|'+(s.serve!==false&&!s.closed)).join('§')+'|'+(a.state?.direction||'');if(watch.sig!==sig){watch.sig=sig;refresh()}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{setInterval(watch,850);setTimeout(watch,200)});else{setInterval(watch,850);setTimeout(watch,200)}
})();
