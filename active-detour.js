(()=>{
'use strict';

/* ACTIVE_DETOUR_RUNTIME_V13_SPEED */
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
function distanceAtIndex(route,index){
  if(!route?.length)return 0;
  const i=Math.max(0,Math.min(route.length-1,+index||0));
  const n=nearestPointOnRoute(route,route[i]);
  return n?.distance||0;
}
function displayRoute(route,maxPts=650){
  if(!route?.length||route.length<=maxPts)return route||[];
  const step=Math.max(2,Math.ceil(route.length/maxPts)),out=[];
  for(let i=0;i<route.length;i+=step)out.push(route[i]);
  const last=route.at(-1);
  if(out.at(-1)!==last)out.push(last);
  return out;
}
function composeActive(d){
  if(!d?.ordinary?.length||d.ordinary.length<2||!d?.detour?.length||d.detour.length<2)return null;
  const total=routeLength(d.ordinary),sliceStep=5.5;

  if(Number.isFinite(d.cutDistance)){
    const cut=Math.max(0,Math.min(total,d.cutDistance));
    const prefix=routeSliceByDistance(d.ordinary,0,cut,sliceStep);
    const start=pointAtDistance(d.ordinary,cut);
    const det=d.detour.map(c=>[+c[0],+c[1]]);
    if(start&&det.length&&hav(start,det[0])<90)det[0]=start;
    return join([prefix,det]);
  }

  if(d.affected&&d._affDone){
    let [ia,ib]=d.affected.map(Number);if(ia>ib)[ia,ib]=[ib,ia];
    const a=distanceAtIndex(d.ordinary,ia),b=distanceAtIndex(d.ordinary,ib);
    if(b>a+5){
      const prefix=routeSliceByDistance(d.ordinary,0,a,sliceStep);
      const suffix=routeSliceByDistance(d.ordinary,b,total,sliceStep);
      const det=d.detour.map(c=>[+c[0],+c[1]]);
      const start=pointAtDistance(d.ordinary,a),end=pointAtDistance(d.ordinary,b);
      if(start&&det.length)det[0]=start;
      if(end&&det.length)det[det.length-1]=end;
      return join([prefix,det,suffix]);
    }
  }

  const a=nearestPointOnRoute(d.ordinary,d.detour[0]),b=nearestPointOnRoute(d.ordinary,d.detour.at(-1));
  if(!a||!b||b.distance<=a.distance+5)return d.detour.map(c=>[+c[0],+c[1]]);
  const prefix=routeSliceByDistance(d.ordinary,0,a.distance,sliceStep),suffix=routeSliceByDistance(d.ordinary,b.distance,total,sliceStep),det=d.detour.map(c=>[+c[0],+c[1]]);
  if(det.length){det[0]=a.coord;det[det.length-1]=b.coord}
  return join([prefix,det,suffix]);
}
function activeValid(d){
  return !!(d?._activeDetourRoute?.length>1&&d?.detour?.length>1&&d._activeDetourSig===routeSig(d.detour)&&d._activeDetourBaseSig===routeSig(d.ordinary));
}
function clearActive(d){
  if(!d)return;
  d._activeDetourRoute=[];d._activeDetourSig='';d._activeDetourBaseSig='';
  state.driveRoute=null;
  syncActivateButton();
}
function activate(label='Ny omläggning'){
  const d=dir(),active=composeActive(d);
  if(!active?.length||active.length<2){
    try{toast('Det finns ingen färdig omläggning att aktivera ännu.',3500)}catch{}
    return false;
  }
  d._activeDetourRoute=active;
  d._activeDetourSig=routeSig(d.detour);
  d._activeDetourBaseSig=routeSig(d.ordinary);
  d.routeSource=(d.routeSource||label).replace(/\s*•\s*AKTIV KÖRVÄG/g,'')+' • AKTIV KÖRVÄG';
  d.freeActive=false;
  if(state.visibility){state.visibility.detour=true;state.visibility.affected=true;state.visibility.driveLine=true;state.visibility.baseRoute=true}
  state.playing=false;state.paused=false;state.busProgress=0;state.simSpeed=0;
  state.driveRoute=buildDriveRoute(d);
  try{resetReplay()}catch{}
  try{fitCoords(active,70)}catch{}
  requestAnimationFrame(()=>{try{renderAll()}catch{}});
  syncActivateButton();
  const st=document.getElementById('autoDetourStatus');
  if(st){st.className='autoDetourStatus';st.innerHTML='✓ <b>AKTIV KÖRVÄG</b> – orange omläggning är nu bussens riktiga körväg.'}
  try{toast(label+' är aktiv. Bussen kör nu på den orange omläggningen.',4500)}catch{}

  // Tung vägmetadata får aldrig bromsa klicket eller kartan. Hämta den först när UI:t hunnit rita klart.
  const sig=d._activeDetourSig;
  setTimeout(()=>{
    if(d._activeDetourSig!==sig)return;
    try{enrichDirRoadMeta(d,active).catch(()=>{})}catch{}
  },1400);
  return true;
}

buildSimRoute=function(d){
  if(activeValid(d))return d._activeDetourRoute;
  return oldBuildSimRoute(d);
};
buildDriveRoute=function(d){
  if(activeValid(d)){
    // 4 m räcker för mjuk bussrörelse men halverar ungefär mängden punkter jämfört med tidigare.
    return resampleRoute(d._activeDetourRoute,4.0);
  }
  return oldBuildDriveRoute(d);
};

renderOverlay=function(){
  const d=dir(),on=activeValid(d)&&!state.showBoth;
  const wanted=(state.visibility?.driveLine!==false);
  let restoreDriveLine;

  // Gamla renderaren ritade hela driveRoute igen varje bildruta. Dölj just det lagret tillfälligt
  // och rita en lätt, förenklad aktiv körväg en gång i stället.
  if(on&&wanted&&state.visibility){
    restoreDriveLine=state.visibility.driveLine;
    state.visibility.driveLine=false;
  }
  oldRenderOverlay();
  if(restoreDriveLine!==undefined)state.visibility.driveLine=restoreDriveLine;

  if(!on||!wanted)return;
  const svg=$('overlay');if(!svg)return;
  const route=displayRoute(d._activeDetourRoute,state.playing?420:700);
  if(route.length<2)return;
  drawPath(svg,route,'#6d3df5',5.6);
  // Riktningspilar behöver inte byggas om 20 gånger/sekund under körning.
  if(!state.playing&&state.visibility?.directionArrows!==false)drawDirectionArrows(svg,route,'#6d3df5',105);
};
renderDetourWorkflowState=function(){
  oldRenderDetourWorkflowState();
  const d=dir(),el=$('detourWorkflowState');
  if(el&&activeValid(d)){
    const html='<b>✓ AKTIV KÖRVÄG</b><span>Orange omläggning ersätter ordinarie sträcka. Bussen använder den nya rutten i 2D och 3D.</span>';
    if(el.innerHTML!==html)el.innerHTML=html;
  }
  syncActivateButton();
};

function installActivateButton(){
  if(document.getElementById('activateDetourBtn'))return;
  const anchor=document.getElementById('detourWorkflowState')||document.getElementById('autoDetourBox');
  if(!anchor?.parentNode)return;
  const wrap=document.createElement('div');
  wrap.id='activateDetourWrap';
  wrap.style.cssText='display:grid;grid-template-columns:1fr;gap:5px;margin:8px 0;';
  wrap.innerHTML='<button id="activateDetourBtn" class="btn green" style="font-weight:900;min-height:38px">🚌 KÖR PÅ ORANGE OMLÄGGNING</button><div id="activateDetourHint" style="font-size:9px;color:#667085;text-align:center">Välj/rita omläggningen först. Tryck sedan här för att göra den till bussens riktiga körväg.</div>';
  anchor.parentNode.insertBefore(wrap,anchor);
  document.getElementById('activateDetourBtn').onclick=()=>activate('Orange omläggning');
  syncActivateButton();
}
function syncActivateButton(){
  const b=document.getElementById('activateDetourBtn'),h=document.getElementById('activateDetourHint');if(!b)return;
  const d=dir(),has=!!(d?.detour?.length>1),on=activeValid(d);
  const text=on?'✓ ORANGE OMLÄGGNING AKTIV':'🚌 KÖR PÅ ORANGE OMLÄGGNING';
  const hint=on?'Bussen följer nu omläggningen. Tryck Kör/Start för simulering.':has?'Omläggningen är klar – tryck knappen för att koppla den till bussen.':'Välj eller rita en omläggning först.';
  if(b.disabled===has)b.disabled=!has;
  if(b.textContent!==text)b.textContent=text;
  if(h&&h.textContent!==hint)h.textContent=hint;
  const opacity=has?'1':'.55';if(b.style.opacity!==opacity)b.style.opacity=opacity;
}

if(oldSnapDetour){
  snapDetour=async function(raw){
    await oldSnapDetour(raw);
    if(dir()?.detour?.length>1)activate('Ritad omläggning');
  };
}

document.addEventListener('click',e=>{
  if(e.target?.closest?.('#autoDetourApply'))setTimeout(()=>activate('Vald auto-omläggning'),0);
  if(e.target?.closest?.('#autoDetourPreview'))setTimeout(syncActivateButton,0);
  if(e.target?.closest?.('#clearDetourBtn'))setTimeout(()=>{clearActive(dir());renderAll()},0);
  if(e.target?.closest?.('#lineBtn,#setOrdinaryBtn')){
    for(const d of Object.values(state.dirs||{}))clearActive(d);
    state.driveRoute=null;
  }
  setTimeout(syncActivateButton,30);
});

// Ingen ständig timer längre. Knappen installeras vid start och en enda reservkontroll görs senare.
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(installActivateButton,180));
else setTimeout(installActivateButton,180);
setTimeout(installActivateButton,1200);

setTimeout(()=>{
  const d=dir();
  if(activeValid(d)){state.driveRoute=buildDriveRoute(d);requestAnimationFrame(()=>renderAll())}
  else if(d?.detour?.length>1&&(d._affDone||Number.isFinite(d.cutDistance)))activate('Sparad omläggning');
  installActivateButton();syncActivateButton();
},260);

})();
