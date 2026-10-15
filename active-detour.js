(()=>{
'use strict';

/* ACTIVE_DETOUR_RUNTIME_V11 */
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
function composeActive(d){
  if(!d?.ordinary?.length||d.ordinary.length<2||!d?.detour?.length||d.detour.length<2)return null;
  const total=routeLength(d.ordinary);

  // Avbruten ordinarie linje: kör ordinarie fram till brytpunkten och därefter hela nya körvägen.
  if(Number.isFinite(d.cutDistance)){
    const cut=Math.max(0,Math.min(total,d.cutDistance));
    const prefix=routeSliceByDistance(d.ordinary,0,cut,2.5);
    const start=pointAtDistance(d.ordinary,cut);
    const det=d.detour.map(c=>[+c[0],+c[1]]);
    if(start&&det.length&&hav(start,det[0])<90)det[0]=start;
    return join([prefix,det]);
  }

  // Omläggning mellan två markerade punkter: ersätt den ordinarie delen helt.
  if(d.affected&&d._affDone){
    let [ia,ib]=d.affected.map(Number);if(ia>ib)[ia,ib]=[ib,ia];
    const a=distanceAtIndex(d.ordinary,ia),b=distanceAtIndex(d.ordinary,ib);
    if(b>a+5){
      const prefix=routeSliceByDistance(d.ordinary,0,a,2.5);
      const suffix=routeSliceByDistance(d.ordinary,b,total,2.5);
      const det=d.detour.map(c=>[+c[0],+c[1]]);
      const start=pointAtDistance(d.ordinary,a),end=pointAtDistance(d.ordinary,b);
      if(start&&det.length)det[0]=start;
      if(end&&det.length)det[det.length-1]=end;
      return join([prefix,det,suffix]);
    }
  }

  // Reservlogik: hitta var den nya vägen lämnar och återansluter till ordinarie linje.
  const a=nearestPointOnRoute(d.ordinary,d.detour[0]),b=nearestPointOnRoute(d.ordinary,d.detour.at(-1));
  if(!a||!b||b.distance<=a.distance+5)return d.detour.map(c=>[+c[0],+c[1]]);
  const prefix=routeSliceByDistance(d.ordinary,0,a.distance,2.5),suffix=routeSliceByDistance(d.ordinary,b.distance,total,2.5),det=d.detour.map(c=>[+c[0],+c[1]]);
  if(det.length){det[0]=a.coord;det[det.length-1]=b.coord}
  return join([prefix,det,suffix]);
}
function activeValid(d){
  return !!(d?._activeDetourRoute?.length>1&&d?.detour?.length>1&&d._activeDetourSig===routeSig(d.detour)&&d._activeDetourBaseSig===routeSig(d.ordinary));
}
function clearActive(d){
  if(!d)return;
  d._activeDetourRoute=[];d._activeDetourSig='';d._activeDetourBaseSig='';
  if(state.driveRoute===d._activeDetourRoute)state.driveRoute=null;
}
function activate(label='Ny omläggning'){
  const d=dir(),active=composeActive(d);
  if(!active?.length||active.length<2)return false;
  d._activeDetourRoute=active;
  d._activeDetourSig=routeSig(d.detour);
  d._activeDetourBaseSig=routeSig(d.ordinary);
  d.routeSource=(d.routeSource||label).replace(/\s*•\s*AKTIV KÖRVÄG/g,'')+' • AKTIV KÖRVÄG';
  d.freeActive=false;
  if(state.visibility){state.visibility.detour=true;state.visibility.affected=true;state.visibility.driveLine=true;state.visibility.baseRoute=true}
  state.playing=false;state.paused=false;state.busProgress=0;state.simSpeed=0;
  state.driveRoute=buildDriveRoute(d);
  try{resetReplay()}catch{}
  try{enrichDirRoadMeta(d,active).catch(()=>{})}catch{}
  try{fitCoords(active,70)}catch{}
  try{renderAll()}catch{}
  const st=document.getElementById('autoDetourStatus');
  if(st){st.className='autoDetourStatus';st.innerHTML='✓ <b>AKTIV KÖRVÄG</b> – denna omläggning är nu bussens riktiga körväg.'}
  try{toast(label+' är aktiv. Bussen följer nu den nya körvägen.',4500)}catch{}
  return true;
}

buildSimRoute=function(d){
  if(activeValid(d))return d._activeDetourRoute;
  return oldBuildSimRoute(d);
};
buildDriveRoute=function(d){
  if(activeValid(d)){
    const prof=vehicleProfile(),step=Math.max(2,Math.min(2.8,prof.length/7.2));
    return resampleRoute(d._activeDetourRoute,step);
  }
  return oldBuildDriveRoute(d);
};

// Visa den kompletta aktiva körvägen som ett sammanhängande lila navigationsspår även innan Start trycks.
renderOverlay=function(){
  oldRenderOverlay();
  const d=dir();if(!activeValid(d)||state.showBoth)return;
  const svg=$('overlay'),v={...VIS_DEFAULTS,...(state.visibility||{})};if(!svg||v.driveLine===false)return;
  drawPath(svg,d._activeDetourRoute,'#6d3df5',5.6);
  if(v.directionArrows!==false)drawDirectionArrows(svg,d._activeDetourRoute,'#6d3df5',72);
};
renderDetourWorkflowState=function(){
  oldRenderDetourWorkflowState();
  const d=dir(),el=$('detourWorkflowState');
  if(el&&activeValid(d))el.innerHTML='<b>✓ AKTIV KÖRVÄG</b><span>Ordinarie sträcka är ersatt av omläggningen. Kartan, 2D/3D-körningen och bussen använder nu den nya rutten.</span>';
};

if(oldSnapDetour){
  snapDetour=async function(raw){
    await oldSnapDetour(raw);
    if(dir()?.detour?.length>1)activate('Ritad omläggning');
  };
}

// Auto-navigator: "Använd valt" ska inte bara förhandsvisa utan aktivera den nya körvägen i hela systemet.
document.addEventListener('click',e=>{
  if(e.target?.closest?.('#autoDetourApply'))setTimeout(()=>activate('Vald auto-omläggning'),0);
  if(e.target?.closest?.('#clearDetourBtn'))setTimeout(()=>{clearActive(dir());state.driveRoute=null;renderAll()},0);
  if(e.target?.closest?.('#lineBtn,#setOrdinaryBtn')){
    for(const d of Object.values(state.dirs||{}))clearActive(d);
    state.driveRoute=null;
  }
});

// Återställ aktiv rutt från sparat projekt när sidan öppnas.
setTimeout(()=>{
  const d=dir();
  if(activeValid(d)){state.driveRoute=buildDriveRoute(d);renderAll()}
  else if(d?.detour?.length>1&&(d._affDone||Number.isFinite(d.cutDistance)))activate('Sparad omläggning');
},180);

})();
