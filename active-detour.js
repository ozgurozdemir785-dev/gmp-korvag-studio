(()=>{
'use strict';

/* ACTIVE_DETOUR_RUNTIME_V16_LOCAL_FOCUS */
const oldBuildSimRoute=buildSimRoute;
const oldBuildDriveRoute=buildDriveRoute;
const oldRenderOverlay=renderOverlay;
const oldRenderDetourWorkflowState=renderDetourWorkflowState;
const oldSnapDetour=typeof snapDetour==='function'?snapDetour:null;

function routeSig(route){
  if(!route?.length)return'';
  const idx=[0,.18,.36,.54,.72,.9,1].map(t=>Math.min(route.length-1,Math.round((route.length-1)*t)));
  return route.length+'|'+idx.map(i=>route[i].map(x=>(+x).toFixed(5)).join(',')).join('|');
}
function join(parts){
  const out=[];
  for(const part of parts||[])for(const c of part||[]){
    if(!c||!Number.isFinite(+c[0])||!Number.isFinite(+c[1]))continue;
    const p=[+c[0],+c[1]];
    if(!out.length||hav(out.at(-1),p)>.7)out.push(p);else out[out.length-1]=p;
  }
  return out;
}
function distAtIndex(route,index){
  if(!route?.length)return 0;
  const i=Math.max(0,Math.min(route.length-1,+index||0));
  return nearestPointOnRoute(route,route[i])?.distance||0;
}
function displayRoute(route,maxPts=650){
  if(!route?.length||route.length<=maxPts)return route||[];
  const step=Math.max(2,Math.ceil(route.length/maxPts)),out=[];
  for(let i=0;i<route.length;i+=step)out.push(route[i]);
  if(out.at(-1)!==route.at(-1))out.push(route.at(-1));
  return out;
}
function composeActive(d){
  if(!d?.ordinary?.length||d.ordinary.length<2||!d?.detour?.length||d.detour.length<2)return null;
  const total=routeLength(d.ordinary),sliceStep=5.5;
  if(Number.isFinite(d.cutDistance)){
    const cut=Math.max(0,Math.min(total,d.cutDistance)),prefix=routeSliceByDistance(d.ordinary,0,cut,sliceStep),start=pointAtDistance(d.ordinary,cut),det=d.detour.map(c=>[+c[0],+c[1]]);
    if(start&&det.length&&hav(start,det[0])<90)det[0]=start;
    return join([prefix,det]);
  }
  if(d.affected&&d._affDone){
    let [ia,ib]=d.affected.map(Number);if(ia>ib)[ia,ib]=[ib,ia];
    const a=distAtIndex(d.ordinary,ia),b=distAtIndex(d.ordinary,ib);
    if(b>a+5){
      const prefix=routeSliceByDistance(d.ordinary,0,a,sliceStep),suffix=routeSliceByDistance(d.ordinary,b,total,sliceStep),det=d.detour.map(c=>[+c[0],+c[1]]),start=pointAtDistance(d.ordinary,a),end=pointAtDistance(d.ordinary,b);
      if(start&&det.length)det[0]=start;if(end&&det.length)det[det.length-1]=end;
      return join([prefix,det,suffix]);
    }
  }
  const a=nearestPointOnRoute(d.ordinary,d.detour[0]),b=nearestPointOnRoute(d.ordinary,d.detour.at(-1));
  if(!a||!b||b.distance<=a.distance+5)return d.detour.map(c=>[+c[0],+c[1]]);
  const prefix=routeSliceByDistance(d.ordinary,0,a.distance,sliceStep),suffix=routeSliceByDistance(d.ordinary,b.distance,total,sliceStep),det=d.detour.map(c=>[+c[0],+c[1]]);
  det[0]=a.coord;det[det.length-1]=b.coord;
  return join([prefix,det,suffix]);
}
function activeValid(d){return !!(d?._activeDetourRoute?.length>1&&d?.detour?.length>1&&d._activeDetourSig===routeSig(d.detour)&&d._activeDetourBaseSig===routeSig(d.ordinary))}
function clearActive(d){if(!d)return;d._activeDetourRoute=[];d._activeDetourSig='';d._activeDetourBaseSig='';state.driveRoute=null;syncActivateButton()}
function focusDetour(d,active){
  try{
    let focus=(d?.detour||[]).map(c=>[+c[0],+c[1]]);
    if(d?.affected&&d._affDone&&d?.ordinary?.length){
      let [ia,ib]=d.affected.map(Number);if(ia>ib)[ia,ib]=[ib,ia];
      const a=distAtIndex(d.ordinary,ia),b=distAtIndex(d.ordinary,ib);
      const blocked=routeSliceByDistance(d.ordinary,a,b,12);
      focus=join([blocked,focus]);
    }
    if(focus?.length>1)fitCoords(focus,115);else fitCoords(active,70);
  }catch{}
}
function activate(label='Ny omläggning'){
  const d=dir(),active=composeActive(d);
  if(!active?.length||active.length<2){try{toast('Det finns ingen färdig omläggning att aktivera ännu.',3500)}catch{}return false}
  d._activeDetourRoute=active;d._activeDetourSig=routeSig(d.detour);d._activeDetourBaseSig=routeSig(d.ordinary);
  d.routeSource=(d.routeSource||label).replace(/\s*•\s*AKTIV KÖRVÄG/g,'')+' • AKTIV KÖRVÄG';d.freeActive=false;
  if(state.visibility){state.visibility.detour=true;state.visibility.affected=true;state.visibility.driveLine=true;state.visibility.baseRoute=true}
  state.playing=false;state.paused=false;state.busProgress=0;state.simSpeed=0;state.driveRoute=buildDriveRoute(d);
  try{resetReplay()}catch{};focusDetour(d,active);requestAnimationFrame(()=>{try{renderAll()}catch{}});syncActivateButton();
  const st=document.getElementById('autoDetourStatus');if(st){st.className='autoDetourStatus';st.innerHTML='✓ <b>AKTIV KÖRVÄG</b> – orange omläggning är nu bussens riktiga körväg.'}
  try{toast(label+' är aktiv. Bussen kör nu på den orange omläggningen.',4200)}catch{}
  const sig=d._activeDetourSig;setTimeout(()=>{if(d._activeDetourSig!==sig)return;try{enrichDirRoadMeta(d,active).catch(()=>{})}catch{}},1400);
  return true;
}

buildSimRoute=function(d){return activeValid(d)?d._activeDetourRoute:oldBuildSimRoute(d)};
buildDriveRoute=function(d){return activeValid(d)?resampleRoute(d._activeDetourRoute,4):oldBuildDriveRoute(d)};
renderOverlay=function(){
  const d=dir(),on=activeValid(d)&&!state.showBoth,wanted=state.visibility?.driveLine!==false;let restore;
  if(on&&wanted&&state.visibility){restore=state.visibility.driveLine;state.visibility.driveLine=false}
  oldRenderOverlay();if(restore!==undefined)state.visibility.driveLine=restore;if(!on||!wanted)return;
  const svg=$('overlay'),route=displayRoute(d._activeDetourRoute,state.playing?420:700);if(!svg||route.length<2)return;
  drawPath(svg,route,'#6d3df5',5.6);if(!state.playing&&state.visibility?.directionArrows!==false)drawDirectionArrows(svg,route,'#6d3df5',105);
};
renderDetourWorkflowState=function(){
  oldRenderDetourWorkflowState();const d=dir(),el=$('detourWorkflowState');
  if(el&&activeValid(d)){const html='<b>✓ AKTIV KÖRVÄG</b><span>Orange omläggning ersätter ordinarie sträcka. Bussen använder den nya rutten i 2D och 3D.</span>';if(el.innerHTML!==html)el.innerHTML=html}
  syncActivateButton();
};

function installActivateButton(){
  if(document.getElementById('activateDetourBtn'))return;
  const anchor=document.getElementById('detourWorkflowState')||document.getElementById('autoDetourBox');if(!anchor?.parentNode)return;
  const wrap=document.createElement('div');wrap.id='activateDetourWrap';wrap.style.cssText='display:grid;grid-template-columns:1fr;gap:5px;margin:8px 0;';
  wrap.innerHTML='<button id="activateDetourBtn" class="btn green" style="font-weight:900;min-height:38px">🚌 KÖR PÅ ORANGE OMLÄGGNING</button><div id="activateDetourHint" style="font-size:9px;color:#667085;text-align:center">Välj/rita omläggningen först. Tryck sedan här för att göra den till bussens riktiga körväg.</div>';
  anchor.parentNode.insertBefore(wrap,anchor);document.getElementById('activateDetourBtn').onclick=()=>activate('Orange omläggning');syncActivateButton();
}
function syncActivateButton(){
  const b=document.getElementById('activateDetourBtn'),h=document.getElementById('activateDetourHint');if(!b)return;
  const d=dir(),has=!!(d?.detour?.length>1),on=activeValid(d),text=on?'✓ ORANGE OMLÄGGNING AKTIV':'🚌 KÖR PÅ ORANGE OMLÄGGNING',hint=on?'Bussen följer nu omläggningen. Tryck Kör/Start för simulering.':has?'Omläggningen är klar – tryck knappen för att koppla den till bussen.':'Välj eller rita en omläggning först.';
  b.disabled=!has;if(b.textContent!==text)b.textContent=text;if(h&&h.textContent!==hint)h.textContent=hint;b.style.opacity=has?'1':'.55';
}

function fallbackRejoin(d,startDistance,rawEnd){
  const route=d?.ordinary;if(!route?.length||route.length<2||!rawEnd)return null;const total=routeLength(route),min=Math.min(total,startDistance+45);let best=null;
  for(let dist=min;dist<=total;dist+=65){const coord=pointAtDistance(route,dist);if(!coord)continue;const gap=hav(rawEnd,coord),score=gap+(dist-min)*.012;if(!best||score<best.score)best={coord,distance:dist,gap,score}}
  if(!best||best.gap>2200)return null;best.index=typeof nearestIndex==='function'?nearestIndex(route,best.coord):0;best.name='nästa blå linje';return best;
}
function autoAttachDrawnDetour(raw){
  const d=dir();if(!Array.isArray(raw)||raw.length<2||!d?.ordinary?.length||d.ordinary.length<2)return raw;if(Number.isFinite(d.cutDistance)||(d.affected&&d._affDone))return raw;
  const first=raw[0],last=raw.at(-1),startN=nearestPointOnRoute(d.ordinary,first);if(!startN||startN.offset>500)return raw;
  let rejoin=null;try{if(typeof nextStopRejoinTarget==='function')rejoin=nextStopRejoinTarget(d,startN.distance,startN.distance+45,last)}catch{};if(!rejoin)rejoin=fallbackRejoin(d,startN.distance,last);if(!rejoin||rejoin.distance<=startN.distance+30)return raw;
  const startIndex=typeof nearestIndex==='function'?nearestIndex(d.ordinary,startN.coord):0,endIndex=Number.isFinite(rejoin.index)?rejoin.index:(typeof nearestIndex==='function'?nearestIndex(d.ordinary,rejoin.coord):d.ordinary.length-1);
  d.cutDistance=null;d.affected=[startIndex,endIndex];d._affDone=true;
  const out=raw.map(c=>[+c[0],+c[1]]);if(hav(startN.coord,out[0])<120){if(hav(startN.coord,out[0])<10)out[0]=startN.coord;else out.unshift(startN.coord)}if(hav(rejoin.coord,out.at(-1))<10)out[out.length-1]=rejoin.coord;else out.push(rejoin.coord);
  try{toast('Ritningen kopplas automatiskt tillbaka till '+(rejoin.name||'nästa blå linje')+'.',3200)}catch{};return out;
}
if(oldSnapDetour){snapDetour=async function(raw){const prepared=autoAttachDrawnDetour(raw);await oldSnapDetour(prepared);if(dir()?.detour?.length>1)activate('Ritad omläggning')}}

document.addEventListener('click',e=>{
  if(e.target?.closest?.('#autoDetourApply'))setTimeout(()=>activate('Vald auto-omläggning'),0);
  if(e.target?.closest?.('#autoDetourPreview'))setTimeout(syncActivateButton,0);
  if(e.target?.closest?.('#clearDetourBtn'))setTimeout(()=>{clearActive(dir());renderAll()},0);
  if(e.target?.closest?.('#lineBtn,#setOrdinaryBtn')){for(const d of Object.values(state.dirs||{}))clearActive(d);state.driveRoute=null}
  setTimeout(syncActivateButton,30);
});

function loadSmartAuto(){
  if(document.getElementById('smartAutoDetourScript'))return;
  const s=document.createElement('script');s.id='smartAutoDetourScript';s.src='/smart-auto-detour.js?v=linne-v3-20261015-1152';document.head.appendChild(s);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{setTimeout(installActivateButton,180);setTimeout(loadSmartAuto,260)});
else{setTimeout(installActivateButton,180);setTimeout(loadSmartAuto,260)}
setTimeout(installActivateButton,1200);
setTimeout(()=>{const d=dir();if(activeValid(d)){state.driveRoute=buildDriveRoute(d);requestAnimationFrame(()=>renderAll())}else if(d?.detour?.length>1&&(d._affDone||Number.isFinite(d.cutDistance)))activate('Sparad omläggning');installActivateButton();syncActivateButton();loadSmartAuto()},300);

})();
