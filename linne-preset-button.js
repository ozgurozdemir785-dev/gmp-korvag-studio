(()=>{
'use strict';
/* LINNE_HJALMAR_PRESET_V3
   Exakt omläggning för X2: Linnéplatsen trafikeras, ordinarie sträcka via
   Olivedalsgatan/Järntorget/Operan dras in, och bussen kör i stället via
   Övre Husargatan -> Nya Allén -> Parkgatan -> Polhemsplatsen -> Hisingsbron
   -> Hjalmar Brantingsplatsen, där ordinarie linje återupptas.
   Denna modul ändrar inte API-inställningar eller _worker.js. */

const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function setStatus(text,kind=''){
  const st=$('autoDetourStatus');
  if(!st)return;
  st.className='autoDetourStatus'+(kind?' '+kind:'');
  st.textContent=text;
}
function say(text,ms=5200){
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
function keepStop(name=''){
  return /linn[eé]platsen|hjalmar\s*brantingsplatsen/i.test(String(name));
}
function withdrawStops(d,aDist,bDist){
  restorePresetStops(d);
  let count=0;
  for(const st of (d.stops||[])){
    if(!st?.coord||keepStop(st.name))continue;
    const n=nearestPointOnRoute(d.ordinary,st.coord);
    if(!n||n.offset>85)continue;
    if(n.distance>aDist+18&&n.distance<bDist-18){
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
  for(const n of names){
    try{return await geocodeOne(n)}catch(e){last=e}
  }
  throw last||new Error('Platsen kunde inte hittas.');
}
async function geocodeNamed(label,names){
  setStatus('Hittar '+label+'…','busy');
  const c=await geocodeAny(names);
  await sleep(80);
  return c;
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
  const step=Math.max(1,Math.ceil(route.length/90));
  let bad=0,total=0;
  for(let i=step*2;i<route.length-step*2;i+=step){
    const p=route[i];
    if(hav(p,start)<120||hav(p,end)<140)continue;
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
  }catch(e){err=e;console.warn('Valhalla X2 preset',e)}
  try{
    if(typeof smartBusRoute==='function')return await smartBusRoute(points,{allowOfficial:false});
  }catch(e){err=e;console.warn('Smart X2 preset',e)}
  try{
    if(typeof osrmRoute==='function')return await osrmRoute(points);
  }catch(e){err=e;console.warn('OSRM X2 preset',e)}
  throw err||new Error('Ingen ruttjänst är tillgänglig.');
}
async function routeSegmented(points,labels){
  const coords=[],events=[],roadMeta=[];
  for(let i=0;i<points.length-1;i++){
    setStatus('Bygger '+labels[i]+' → '+labels[i+1]+'…','busy');
    const part=await routeVia([points[i],points[i+1]]);
    if(!part?.coords?.length||part.coords.length<2)throw new Error('Kunde inte bygga sträckan '+labels[i]+' → '+labels[i+1]+'.');
    if(coords.length&&hav(coords.at(-1),part.coords[0])<8)coords.push(...part.coords.slice(1));
    else coords.push(...part.coords);
    if(Array.isArray(part.events))events.push(...part.events);
    if(Array.isArray(part.roadMeta))roadMeta.push(...part.roadMeta);
  }
  return{coords,events,roadMeta,source:'X2 omläggning via angiven korridor'};
}
function verifyCorridor(route,points,labels){
  const misses=[];
  for(let i=1;i<points.length-1;i++){
    const n=nearestPointOnRoute(route,points[i]);
    if(!n||n.offset>260)misses.push(labels[i]);
  }
  if(misses.length)throw new Error('Körvägen missade '+misses.join(', ')+'. Jag aktiverar inte en felaktig omläggning.');
}

async function runPreset(){
  const b=$('linneNilsPresetBtn');
  if(b?.dataset.busy==='1')return;
  const idleLabel='🚌 X2: LINNÉPLATSEN → HJALMAR via ÖVRE HUSARGATAN';
  if(b){b.dataset.busy='1';b.disabled=true;b.textContent='⏳ Bygger X2-omläggningen…'}
  try{
    if(typeof state==='undefined'||typeof nearestPointOnRoute!=='function'||typeof buildDriveRoute!=='function'){
      throw new Error('Kartmotorn är inte färdig ännu. Vänta en sekund och tryck igen.');
    }
    const hasLine=['tur','retur'].some(n=>state.dirs?.[n]?.ordinary?.length>1);
    if(!hasLine)throw new Error('Hämta X2 först. Sedan kan omläggningen byggas automatiskt.');

    const startPlace=await geocodeNamed('Linnéplatsen',['Linnéplatsen hållplats','Linnéplatsen']);
    const endPlace=await geocodeNamed('Hjalmar Brantingsplatsen',['Hjalmar Brantingsplatsen hållplats','Hjalmar Brantingsplatsen']);
    const best=findDirection(startPlace,endPlace);
    if(!best)throw new Error('Jag hittar inte Linnéplatsen → Hjalmar i rätt färdriktning på den hämtade linjen. Kontrollera att X2 och rätt område är laddat.');
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

    setStatus('Linnéplatsen behålls · ordinarie väg mot Olivedalsgatan/Järntorget/Operan dras in · hittar nya korridoren…','busy');

    const upper=await geocodeNamed('Övre Husargatan',['Övre Husargatan 16','Övre Husargatan','Övre Husargatan 25']);
    const nyaAllen=await geocodeNamed('Nya Allén',['Nya Allén','Nya Allén Haga']);
    const park=await geocodeNamed('Parkgatan',['Parkgatan Heden','Parkgatan']);
    const polhem=await geocodeNamed('Polhemsplatsen',['Polhemsplatsen','Polhemsplatsen hållplats']);
    const bridge=await geocodeNamed('Hisingsbron',['Hisingsbron','Hisingsbron Göteborg']);

    const points=[start,upper,nyaAllen,park,polhem,bridge,end];
    const labels=['Linnéplatsen','Övre Husargatan','Nya Allén','Parkgatan','Polhemsplatsen','Hisingsbron','Hjalmar Brantingsplatsen'];

    let res;
    try{
      setStatus('Bygger bussväg: Linnéplatsen → Övre Husargatan → Nya Allén → Parkgatan → Polhemsplatsen → Hisingsbron → Hjalmar…','busy');
      res=await routeVia(points);
    }catch(firstErr){
      console.warn('Hel korridor misslyckades, provar delsträckor',firstErr);
      res=await routeSegmented(points,labels);
    }
    if(!res?.coords?.length||res.coords.length<2)throw new Error('Ruttjänsten gav ingen körbar väg för X2-omläggningen.');

    verifyCorridor(res.coords,points,labels);
    const share=forbiddenShare(res.coords,d,best.a.distance,best.b.distance,start,end);
    if(share>.30)throw new Error('Förslaget ligger fortfarande för mycket på den indragna sträckan via Olivedalsgatan/Järntorget/Operan. Jag aktiverar därför inte den felaktiga vägen.');

    d.detour=res.coords.map(c=>[+c[0],+c[1]]);
    d.navEvents=res.events||[];
    d.roadMeta=res.roadMeta||[];
    d.routeSource='X2 · Linnéplatsen → Hjalmar via Övre Husargatan, Nya Allén, Parkgatan, Polhemsplatsen och Hisingsbron';
    d.freeActive=false;
    state.driveRoute=buildDriveRoute(d);
    state.busProgress=0;
    try{renderAll();renderStopManager();fitCoords(d.detour,95)}catch{}

    setStatus('✓ X2 OMLÄGGNING AKTIV · Linnéplatsen trafikeras · '+withdrawn+' mellanliggande hållplatser indragna · åter ordinarie vid Hjalmar.');
    say('Klart: X2 kör Linnéplatsen → Övre Husargatan → Nya Allén → Parkgatan → Polhemsplatsen → Hisingsbron → Hjalmar.',6500);
  }catch(e){
    console.error('X2 Linné-Hjalmar preset',e);
    setStatus(e?.message||String(e),'err');
    say(e?.message||String(e),7000);
  }finally{
    if(b){b.disabled=false;b.textContent=idleLabel;delete b.dataset.busy}
  }
}

function install(){
  const host=$('setOrdinaryBtn')?.parentNode||$('leftSecRoute')?.querySelector('.sectionBody');
  if(!host)return;
  const label='🚌 X2: LINNÉPLATSEN → HJALMAR via ÖVRE HUSARGATAN';
  let btn=$('linneNilsPresetBtn');
  if(!btn){
    btn=document.createElement('button');
    btn.id='linneNilsPresetBtn';
    btn.className='btn green wide';
    btn.style.cssText='min-height:44px;font-weight:900';
    const ordinary=$('setOrdinaryBtn');
    if(ordinary?.nextSibling)host.insertBefore(btn,ordinary.nextSibling);else host.appendChild(btn);
  }
  if(btn.dataset.busy!=='1')btn.textContent=label;
  btn.onclick=runPreset;
}

document.addEventListener('click',e=>{
  if(e.target?.closest?.('#clearDetourBtn')){
    for(const d of Object.values(state?.dirs||{}))restorePresetStops(d);
    setTimeout(()=>{try{renderStopManager();renderAll()}catch{}},0);
  }
});

window.GMPLinnePreset=runPreset;
window.GMPX2LinneHjalmarPreset=runPreset;
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{install();setTimeout(install,500)});else{install();setTimeout(install,500)}
setInterval(install,2500);
})();
