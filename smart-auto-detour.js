(()=>{
'use strict';

/* SMART_AUTO_DETOUR_V1 */
const $id=id=>document.getElementById(id);
let smartBusy=false;

function selectedAnchor(){
  const d=dir();
  if(!d?.ordinary?.length||!d?.affected||d.affected.length<2)return null;
  let [ia,ib]=d.affected.map(Number);
  if(!Number.isFinite(ia)||!Number.isFinite(ib))return null;
  ia=Math.max(0,Math.min(d.ordinary.length-1,Math.round(ia)));
  ib=Math.max(0,Math.min(d.ordinary.length-1,Math.round(ib)));
  if(ia===ib)return null;
  if(ia>ib)[ia,ib]=[ib,ia];
  const start=d.ordinary[ia],end=d.ordinary[ib];
  const a=nearestPointOnRoute(d.ordinary,start),b=nearestPointOnRoute(d.ordinary,end);
  if(!a||!b||b.distance<=a.distance+20)return null;
  return{d,ia,ib,start:a.coord,end:b.coord,a,b};
}

async function geocodeVia(q){
  const u='/geo/search?format=json&limit=6&countrycodes=se&addressdetails=1&q='+encodeURIComponent(q+', Göteborg, Västra Götaland');
  const r=await fetch(u,{headers:{Accept:'application/json'}});
  if(!r.ok)throw new Error('Kunde inte hitta via-gatan.');
  const j=await r.json();
  const x=(j||[]).find(v=>Number.isFinite(+v.lon)&&Number.isFinite(+v.lat));
  if(!x)throw new Error('Hittade inte “'+q+'”.');
  return{coord:[+x.lon,+x.lat],name:(x.display_name||q).split(',').slice(0,2).join(', ')};
}

function nearestIdx(route,p){
  let bi=0,bd=Infinity;
  for(let i=0;i<route.length;i++){
    const d=hav(route[i],p);
    if(d<bd){bd=d;bi=i}
  }
  return{index:bi,offset:bd};
}
function sampleSegment(seg,start,end){
  const out=[start];
  for(const t of [.16,.32,.48,.64,.80]){
    const p=seg[Math.min(seg.length-1,Math.round((seg.length-1)*t))];
    if(p&&hav(out.at(-1),p)>40)out.push(p);
  }
  if(hav(out.at(-1),end)>25)out.push(end);else out[out.length-1]=end;
  return out;
}

async function findReferenceLine(anchor,status){
  if(typeof gtfsZipBuffer==='undefined'||!gtfsZipBuffer||typeof zipReader!=='function'||typeof forEachCsv!=='function')return null;
  try{
    status.textContent='AUTO läser Västtrafiks tidtabell och letar en annan busslinje som kan bära omläggningen…';
    const zip=zipReader(gtfsZipBuffer),start=anchor.start,end=anchor.end;
    const stopsText=await zip.text('stops.txt'),startIds=new Set(),endIds=new Set();
    forEachCsv(stopsText,(c,m)=>{
      const lat=+c[m.stop_lat],lon=+c[m.stop_lon],id=c[m.stop_id];
      if(!id||!Number.isFinite(lat)||!Number.isFinite(lon))return;
      const p=[lon,lat];
      if(hav(p,start)<=900)startIds.add(id);
      if(hav(p,end)<=900)endIds.add(id);
    });
    if(!startIds.size||!endIds.size)return null;

    const stopTimes=await zip.text('stop_times.txt'),hits=new Map();
    forEachCsv(stopTimes,(c,m)=>{
      const sid=c[m.stop_id];if(!startIds.has(sid)&&!endIds.has(sid))return;
      const trip=c[m.trip_id],seq=+(c[m.stop_sequence]||0);if(!trip)return;
      let h=hits.get(trip);if(!h){h={s:Infinity,e:-Infinity};hits.set(trip,h)}
      if(startIds.has(sid))h.s=Math.min(h.s,seq);
      if(endIds.has(sid))h.e=Math.max(h.e,seq);
    });
    const tripIds=new Set([...hits].filter(([,h])=>Number.isFinite(h.s)&&Number.isFinite(h.e)&&h.e>h.s).slice(0,180).map(([id])=>id));
    if(!tripIds.size)return null;

    const tripsText=await zip.text('trips.txt'),trips=[];
    forEachCsv(tripsText,(c,m)=>{
      if(!tripIds.has(c[m.trip_id]))return;
      const shape=c[m.shape_id],routeId=c[m.route_id];
      if(shape&&routeId)trips.push({shape,routeId,head:c[m.trip_headsign]||''});
    });
    const routeIds=new Set(trips.map(x=>x.routeId)),routesText=await zip.text('routes.txt'),routeMeta=new Map();
    forEachCsv(routesText,(c,m)=>{
      const rid=c[m.route_id];if(!routeIds.has(rid))return;
      const rt=Number(c[m.route_type]||0),isBus=rt===3||(rt>=700&&rt<800);if(!isBus)return;
      routeMeta.set(rid,{line:(c[m.route_short_name]||'').trim()||'VT'});
    });

    const picked=[],seenShape=new Set(),current=String(anchor.d?.lineInfo?.line||'').trim().toLowerCase();
    for(const t of trips){
      const rm=routeMeta.get(t.routeId);if(!rm||seenShape.has(t.shape))continue;
      seenShape.add(t.shape);picked.push({...t,...rm});if(picked.length>=45)break;
    }
    if(!picked.length)return null;

    const wanted=new Set(picked.map(x=>x.shape)),shapes=new Map(),shapesText=await zip.text('shapes.txt');
    forEachCsv(shapesText,(c,m)=>{
      const id=c[m.shape_id];if(!wanted.has(id))return;
      const lat=+c[m.shape_pt_lat],lon=+c[m.shape_pt_lon],seq=+(c[m.shape_pt_sequence]||0);
      if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
      let a=shapes.get(id);if(!a){a=[];shapes.set(id,a)}a.push({seq,coord:[lon,lat]});
    });

    let best=null;
    for(const p of picked){
      const arr=(shapes.get(p.shape)||[]).sort((a,b)=>a.seq-b.seq).map(x=>x.coord);if(arr.length<3)continue;
      const a=nearestIdx(arr,start),b=nearestIdx(arr,end);if(a.offset>1350||b.offset>1350||b.index<=a.index+2)continue;
      const seg=arr.slice(a.index,b.index+1);if(seg.length<3)continue;
      const same=String(p.line||'').trim().toLowerCase()===current;
      const score=a.offset+b.offset+(same?800:0)+routeLength(seg)*.015;
      if(!best||score<best.score)best={guide:sampleSegment(seg,start,end),line:p.line||'VT',head:p.head||'',score};
    }
    return best;
  }catch(e){console.warn('Smart GTFS guide failed',e);return null}
}

async function runSmartAuto(){
  if(smartBusy)return;
  const status=$id('autoDetourStatus'),anchor=selectedAnchor();
  if(!anchor){
    if(status){status.className='autoDetourStatus err';status.textContent='Välj först “Omläggning mellan 2 punkter” och klicka start + återanslutning på den blå linjen.'}
    return;
  }
  smartBusy=true;
  try{
    if(status){status.className='autoDetourStatus busy';status.textContent='AUTO bygger omläggningen från exakt de två blå anslutningspunkterna…'}
    let guide=[anchor.start,anchor.end],label='bussvägnätet';
    const viaQ=$id('autoDetourVia')?.value.trim();
    if(viaQ){
      const via=await geocodeVia(viaQ);guide=[anchor.start,via.coord,anchor.end];label='via '+via.name;
      if(status)status.textContent='AUTO bygger bussväg '+label+' och kopplar tillbaka till den blå linjen…';
    }else{
      const ref=await findReferenceLine(anchor,status);
      if(ref){guide=ref.guide;label='med VT-linje '+ref.line+' som vägledning';if(status)status.textContent='Hittade linje '+ref.line+'. Bygger körbar bussomläggning och kopplar tillbaka till blå linjen…'}
    }

    let res;
    try{res=await valhallaBusRoute(guide)}catch(e){console.warn(e);res=await smartBusRoute(guide)}
    if(!res?.coords?.length||res.coords.length<2)throw new Error('Ingen körbar omläggning hittades.');

    const d=anchor.d;
    d.cutDistance=null;
    d.affected=[anchor.ia,anchor.ib];
    d._affDone=true;
    d.detour=res.coords;
    d.roadLockedRoute=[];
    d.navEvents=res.events||[];
    d.roadMeta=res.roadMeta||d.roadMeta||[];
    d.routeSource='AUTO omläggning · '+label;
    d.freeActive=false;
    state.driveRoute=null;
    try{fitCoords(buildSimRoute(d),70)}catch{}
    try{renderAll()}catch{}

    const activateBtn=$id('activateDetourBtn');
    if(activateBtn&&!activateBtn.disabled)activateBtn.click();
    else setTimeout(()=>{const b=$id('activateDetourBtn');if(b&&!b.disabled)b.click()},120);

    if(status){status.className='autoDetourStatus';status.innerHTML='✓ <b>AUTO OMLÄGGNING KLAR</b> – '+label+'. Start och slut är kopplade till den blå linjen.'}
    try{toast('AUTO omläggning klar – '+label+'.',4200)}catch{}
  }catch(e){
    if(status){status.className='autoDetourStatus err';status.textContent='AUTO misslyckades: '+(e?.message||e)}
  }finally{smartBusy=false}
}

function installSmartAuto(){
  const box=$id('autoDetourBox');if(!box)return false;
  if(!$id('autoDetourVia')){
    const fields=box.querySelector('.autoDetourFields');
    if(fields){
      const row=document.createElement('div');row.className='autoDetourField';
      row.innerHTML='<label>Via / önskad korridor <span style="font-weight:500;color:#667085">(valfritt)</span></label><input id="autoDetourVia" autocomplete="off" placeholder="t.ex. Övre Husargatan">';
      fields.appendChild(row);
    }
  }
  const auto=$id('autoDetourAuto');
  if(auto){
    auto.textContent='⚡ AUTO – bygg och koppla omläggning';
    auto.onclick=runSmartAuto;
  }
  const hint=box.querySelector('.autoDetourHint');
  if(hint)hint.innerHTML='<b>Enklast:</b> välj “Omläggning mellan 2 punkter” och klicka start + återanslutning på blå linjen. AUTO använder exakt de punkterna, läser GTFS/tidtabell och andra VT-linjer. Vill du tvinga en korridor, skriv t.ex. <b>Övre Husargatan</b> i Via-fältet.';

  try{
    if(typeof setAffectedPoint==='function'&&!setAffectedPoint.__gmpSmartExact){
      const old=setAffectedPoint;
      const wrapped=function(c){
        const cb=$id('autoDetourGtfs'),was=cb?.checked;
        if(cb)cb.checked=false;
        try{old(c)}finally{if(cb)cb.checked=was!==false}
        const d=dir();if(d?._affDone&&d?.affected?.length===2)setTimeout(()=>runSmartAuto(),120);
      };
      wrapped.__gmpSmartExact=true;
      setAffectedPoint=wrapped;
    }
  }catch(e){console.warn(e)}
  return true;
}

let tries=0;
const timer=setInterval(()=>{tries++;if(installSmartAuto()||tries>20)clearInterval(timer)},120);
if(document.readyState!=='loading')setTimeout(installSmartAuto,20);
else document.addEventListener('DOMContentLoaded',()=>setTimeout(installSmartAuto,20));

})();
