(()=>{
'use strict';
/* LINNE_PRESET_BUTTON_V2_SELF_CONTAINED
   Viktigt: denna modul ändrar inte API-inställningar, _worker.js eller övriga paneler.
   Den använder appens befintliga routingfunktioner direkt. */
const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function setStatus(text,kind=''){
  const st=$('autoDetourStatus');
  if(!st)return;
  st.className='autoDetourStatus'+(kind?' '+kind:'');
  st.textContent=text;
}
function say(text,ms=4800){
  try{ if(typeof toast==='function') toast(text,ms); else alert(text); }
  catch{ try{alert(text)}catch{} }
}
function nearestIdx(route,p){
  let bi=0,bd=Infinity;
  for(let i=0;i<(route||[]).length;i++){
    const d=hav(route[i],p);
    if(d<bd){bd=d;bi=i}
  }
  return{index:bi,offset:bd};
}
function restorePresetStops(d){
  if(!d?.stops)return;
  for(const st of d.stops){
    if(!st?._linnePresetChanged)continue;
    st.serve=st._linnePrevServe;
    st.closed=st._linnePrevClosed;
    delete st._linnePresetChanged;
    delete st._linnePrevServe;
    delete st._linnePrevClosed;
  }
}
function withdrawStops(d,aDist,bDist){
  restorePresetStops(d);
  let count=0;
  for(const st of (d.stops||[])){
    if(!st?.coord)continue;
    const n=nearestPointOnRoute(d.ordinary,st.coord);
    if(!n||n.offset>80)continue;
    if(n.distance>aDist+25&&n.distance<bDist-25){
      st._linnePrevServe=st.serve;
      st._linnePrevClosed=st.closed;
      st._linnePresetChanged=true;
      st.serve=false;
      st.closed=true;
      count++;
    }
  }
  return count;
}
async function geocodeOne(q){
  const u='/geo/search?format=json&limit=8&countrycodes=se&addressdetails=1&q='+encodeURIComponent(q+', Göteborg, Västra Götaland');
  const r=await fetch(u,{headers:{Accept:'application/json'},cache:'no-store'});
  if(!r.ok)throw new Error('Kunde inte hitta '+q+'.');
  const j=await r.json();
  const hit=(j||[]).find(x=>Number.isFinite(+x.lon)&&Number.isFinite(+x.lat));
  if(!hit)throw new Error('Kunde inte hitta '+q+'.');
  return[+hit.lon,+hit.lat];
}
async function geocodeAny(names){
  let last;
  for(const n of names){try{return await geocodeOne(n)}catch(e){last=e}}
  throw last||new Error('Platsen kunde inte hittas.');
}
function findDirection(startCoord,endCoord){
  let best=null;
  for(const name of ['tur','retur']){
    const d=state?.dirs?.[name],route=d?.ordinary;
    if(!route?.length||route.length<2)continue;
    const a=nearestPointOnRoute(route,startCoord),b=nearestPointOnRoute(route,endCoord);
    if(!a||!b)continue;
    if(a.offset>1700||b.offset>1700||b.distance<=a.distance+100)continue;
    const score=a.offset+b.offset+(name===state.direction?-30:0);
    if(!best||score<best.score)best={name,d,a,b,score};
  }
  return best;
}
function forbiddenShare(route,d,aDist,bDist,start,end){
  if(!route?.length)return 1;
  const blocked=routeSliceByDistance(d.ordinary,aDist,bDist,10);
  if(!blocked?.length)return 0;
  const step=Math.max(1,Math.ceil(route.length/70));
  let bad=0,total=0;
  for(let i=step*2;i<route.length-step*2;i+=step){
    const p=route[i];
    if(hav(p,start)<120||hav(p,end)<120)continue;
    const n=nearestPointOnRoute(blocked,p);
    total++;
    if(n&&n.offset<34)bad++;
  }
  return total?bad/total:0;
}
async function routeVia(points){
  let err=null;
  try{
    if(typeof valhallaBusRoute==='function')return await valhallaBusRoute(points);
  }catch(e){err=e;console.warn('Valhalla preset',e)}
  try{
    if(typeof smartBusRoute==='function')return await smartBusRoute(points,{allowOfficial:false});
  }catch(e){err=e;console.warn('Smart preset',e)}
  try{
    if(typeof osrmRoute==='function')return await osrmRoute(points);
  }catch(e){err=e;console.warn('OSRM preset',e)}
  throw err||new Error('Ingen ruttjänst är tillgänglig.');
}

async function runPreset(){
  const b=$('linneNilsPresetBtn');
  if(b?.dataset.busy==='1')return;
  if(b){b.dataset.busy='1';b.disabled=true;b.textContent='⏳ Bygger Linnéplatsen → Nils Ericson…'}
  try{
    if(typeof state==='undefined'||typeof nearestPointOnRoute!=='function'||typeof buildDriveRoute!=='function'){
      throw new Error('Kartmotorn är inte färdig ännu. Vänta en sekund och tryck igen.');
    }
    const hasLine=['tur','retur'].some(n=>state.dirs?.[n]?.ordinary?.length>1);
    if(!hasLine)throw new Error('Hämta linjen först. Sedan kan omläggningen byggas automatiskt.');

    setStatus('Hittar Linnéplatsen, Övre Husargatan och Nils Ericsonplatsen…','busy');
    const [startPlace,viaPlace,endPlace]=await Promise.all([
      geocodeAny(['Linnéplatsen hållplats','Linnéplatsen']),
      geocodeAny(['Övre Husargatan 16','Övre Husargatan','Övre Husargatan 25']),
      geocodeAny(['Nils Ericson Terminalen','Nils Ericsonplatsen','Nils Ericson Terminal'])
    ]);

    const best=findDirection(startPlace,endPlace);
    if(!best)throw new Error('Jag hittar inte Linnéplatsen → Nils Ericson i rätt färdriktning på den hämtade linjen.');
    if(state.direction!==best.name&&typeof setDirection==='function')setDirection(best.name);
    const d=state.dirs[best.name];
    const start=best.a.coord,end=best.b.coord;
    const ia=nearestIdx(d.ordinary,start).index,ib=nearestIdx(d.ordinary,end).index;
    const withdrawn=withdrawStops(d,best.a.distance,best.b.distance);

    d.cutDistance=null;
    d.affected=[ia,ib];
    d._affDone=true;
    d.detour=[];
    d.roadLockedRoute=[];
    d.freeActive=false;
    state.driveRoute=null;
    try{renderAll();renderStopManager()}catch{}

    setStatus('Ordinarie sträcka spärrad · '+withdrawn+' hållplatser indragna · bygger bussväg via Övre Husargatan…','busy');
    const res=await routeVia([start,viaPlace,end]);
    if(!res?.coords?.length||res.coords.length<2)throw new Error('Ruttjänsten gav ingen körbar väg via Övre Husargatan.');
    const share=forbiddenShare(res.coords,d,best.a.distance,best.b.distance,start,end);
    if(share>.42)throw new Error('Den föreslagna vägen går för mycket på den indragna sträckan och aktiveras därför inte.');

    d.detour=res.coords.map(c=>[+c[0],+c[1]]);
    d.navEvents=res.events||[];
    d.roadMeta=res.roadMeta||[];
    d.routeSource='Linnéplatsen → Nils Ericson via Övre Husargatan';
    d.freeActive=false;
    state.driveRoute=buildDriveRoute(d);
    state.busProgress=0;
    try{renderAll();renderStopManager();fitCoords(d.detour,95)}catch{}
    setStatus('✓ OMLÄGGNING AKTIV – Linnéplatsen → Nils Ericson via Övre Husargatan · '+withdrawn+' hållplatser indragna.');
    say('Klart: bussen kör nu Linnéplatsen → Nils Ericson via Övre Husargatan.',5200);
  }catch(e){
    console.error('Linné preset',e);
    setStatus(e?.message||String(e),'err');
    say(e?.message||String(e),6000);
  }finally{
    if(b){b.disabled=false;b.textContent='🚌 LINNÉPLATSEN → NILS ERICSON via ÖVRE HUSARGATAN';delete b.dataset.busy}
  }
}

function install(){
  const host=$('setOrdinaryBtn')?.parentNode||$('leftSecRoute')?.querySelector('.sectionBody');
  if(!host)return;
  let btn=$('linneNilsPresetBtn');
  if(!btn){
    btn=document.createElement('button');
    btn.id='linneNilsPresetBtn';
    btn.className='btn green wide';
    btn.style.cssText='min-height:44px;font-weight:900';
    btn.textContent='🚌 LINNÉPLATSEN → NILS ERICSON via ÖVRE HUSARGATAN';
    const ordinary=$('setOrdinaryBtn');
    if(ordinary?.nextSibling)host.insertBefore(btn,ordinary.nextSibling);else host.appendChild(btn);
  }
  btn.onclick=runPreset;
}

document.addEventListener('click',e=>{
  if(e.target?.closest?.('#clearDetourBtn')){
    for(const d of Object.values(state?.dirs||{}))restorePresetStops(d);
    setTimeout(()=>{try{renderStopManager();renderAll()}catch{}},0);
  }
});

window.GMPLinnePreset=runPreset;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{install();setTimeout(install,500)});else{install();setTimeout(install,500)}
setInterval(install,2500);
})();
