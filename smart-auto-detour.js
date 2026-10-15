(()=>{
'use strict';

/* SMART_AUTO_DETOUR_V3_LINNE_NILS_PRESET */
const $id=id=>document.getElementById(id);
let smartBusy=false;
let advancedOpen=false;

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

function restoreAutoWithdrawn(d){
  if(!d?.stops)return;
  for(const st of d.stops){
    if(!st?._gmpAutoWithdrawn)continue;
    st.serve=st._gmpPrevServe;
    st.closed=st._gmpPrevClosed;
    delete st._gmpAutoWithdrawn;
    delete st._gmpPrevServe;
    delete st._gmpPrevClosed;
  }
  d._autoWithdrawnCount=0;
}
function markBlockedAndWithdraw(anchor){
  const d=anchor.d;
  restoreAutoWithdrawn(d);
  d._hardBlocked=true;
  d._blockedStart=anchor.a.distance;
  d._blockedEnd=anchor.b.distance;
  let count=0;
  for(const st of (d.stops||[])){
    if(!st?.coord)continue;
    const n=nearestPointOnRoute(d.ordinary,st.coord);
    if(!n||n.offset>75)continue;
    if(n.distance>anchor.a.distance+30&&n.distance<anchor.b.distance-30){
      st._gmpPrevServe=st.serve;
      st._gmpPrevClosed=st.closed;
      st._gmpAutoWithdrawn=true;
      st.serve=false;
      st.closed=true;
      count++;
    }
  }
  d._autoWithdrawnCount=count;
  state.driveRoute=null;
  try{renderAll();renderStopManager()}catch{}
  return count;
}
function clearBlocked(d){
  restoreAutoWithdrawn(d);
  if(!d)return;
  d._hardBlocked=false;
  delete d._blockedStart;
  delete d._blockedEnd;
}

function blockedSlice(anchor){
  return routeSliceByDistance(anchor.d.ordinary,anchor.a.distance,anchor.b.distance,10);
}
function forbiddenShare(route,anchor){
  if(!route?.length)return 1;
  const blocked=blockedSlice(anchor);
  if(!blocked?.length)return 0;
  const step=Math.max(1,Math.ceil(route.length/70));
  let bad=0,total=0;
  for(let i=step*2;i<route.length-step*2;i+=step){
    const p=route[i];
    if(hav(p,anchor.start)<110||hav(p,anchor.end)<110)continue;
    const n=nearestPointOnRoute(blocked,p);
    total++;
    if(n&&n.offset<32)bad++;
  }
  return total?bad/total:0;
}
function safePrefix(d){
  if(!d?._hardBlocked||!d?.ordinary?.length)return null;
  const dist=Number.isFinite(d._blockedStart)?d._blockedStart:0;
  return routeSliceByDistance(d.ordinary,0,Math.max(0,dist),6);
}

const beforeSmartBuildSim=buildSimRoute;
const beforeSmartBuildDrive=buildDriveRoute;
buildSimRoute=function(d){
  if(d?._hardBlocked&&(!d.detour||d.detour.length<2))return safePrefix(d)||beforeSmartBuildSim(d);
  return beforeSmartBuildSim(d);
};
buildDriveRoute=function(d){
  if(d?._hardBlocked&&(!d.detour||d.detour.length<2)){
    const r=safePrefix(d);
    return r?.length>1?resampleRoute(r,4):beforeSmartBuildDrive(d);
  }
  return beforeSmartBuildDrive(d);
};

async function geocodeVia(q){
  const u='/geo/search?format=json&limit=6&countrycodes=se&addressdetails=1&q='+encodeURIComponent(q+', Göteborg, Västra Götaland');
  const r=await fetch(u,{headers:{Accept:'application/json'}});
  if(!r.ok)throw new Error('Kunde inte hitta via-gatan.');
  const j=await r.json();
  const x=(j||[]).find(v=>Number.isFinite(+v.lon)&&Number.isFinite(+v.lat));
  if(!x)throw new Error('Hittade inte “'+q+'”.');
  return{coord:[+x.lon,+x.lat],name:(x.display_name||q).split(',').slice(0,2).join(', ')};
}
async function geocodeAny(names){
  let last=null;
  for(const q of names){
    try{return await geocodeVia(q)}catch(e){last=e}
  }
  throw last||new Error('Platsen kunde inte hittas.');
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
    if(status)status.textContent='Läser Västtrafiks tidtabell och andra busslinjer…';
    const zip=zipReader(gtfsZipBuffer),start=anchor.start,end=anchor.end;
    const stopsText=await zip.text('stops.txt'),startIds=new Set(),endIds=new Set();
    forEachCsv(stopsText,(c,m)=>{
      const lat=+c[m.stop_lat],lon=+c[m.stop_lon],id=c[m.stop_id];
      if(!id||!Number.isFinite(lat)||!Number.isFinite(lon))return;
      const p=[lon,lat];
      if(hav(p,start)<=1000)startIds.add(id);
      if(hav(p,end)<=1000)endIds.add(id);
    });
    if(!startIds.size||!endIds.size)return null;
    const stopTimes=await zip.text('stop_times.txt'),hits=new Map();
    forEachCsv(stopTimes,(c,m)=>{
      const sid=c[m.stop_id];
      if(!startIds.has(sid)&&!endIds.has(sid))return;
      const trip=c[m.trip_id],seq=+(c[m.stop_sequence]||0);
      if(!trip)return;
      let h=hits.get(trip);
      if(!h){h={s:Infinity,e:-Infinity};hits.set(trip,h)}
      if(startIds.has(sid))h.s=Math.min(h.s,seq);
      if(endIds.has(sid))h.e=Math.max(h.e,seq);
    });
    const tripIds=new Set([...hits].filter(([,h])=>Number.isFinite(h.s)&&Number.isFinite(h.e)&&h.e>h.s).slice(0,220).map(([id])=>id));
    if(!tripIds.size)return null;
    const tripsText=await zip.text('trips.txt'),trips=[];
    forEachCsv(tripsText,(c,m)=>{
      if(!tripIds.has(c[m.trip_id]))return;
      const shape=c[m.shape_id],routeId=c[m.route_id];
      if(shape&&routeId)trips.push({shape,routeId,head:c[m.trip_headsign]||''});
    });
    const routeIds=new Set(trips.map(x=>x.routeId)),routesText=await zip.text('routes.txt'),routeMeta=new Map();
    forEachCsv(routesText,(c,m)=>{
      const rid=c[m.route_id];
      if(!routeIds.has(rid))return;
      const rt=Number(c[m.route_type]||0),isBus=rt===3||(rt>=700&&rt<800);
      if(isBus)routeMeta.set(rid,{line:(c[m.route_short_name]||'').trim()||'VT'});
    });
    const current=String(anchor.d?.lineInfo?.line||'').trim().toLowerCase(),picked=[],seen=new Set();
    for(const t of trips){
      const rm=routeMeta.get(t.routeId);
      if(!rm||seen.has(t.shape))continue;
      seen.add(t.shape);
      picked.push({...t,...rm});
      if(picked.length>=55)break;
    }
    if(!picked.length)return null;
    const wanted=new Set(picked.map(x=>x.shape)),shapes=new Map(),shapesText=await zip.text('shapes.txt');
    forEachCsv(shapesText,(c,m)=>{
      const id=c[m.shape_id];
      if(!wanted.has(id))return;
      const lat=+c[m.shape_pt_lat],lon=+c[m.shape_pt_lon],seq=+(c[m.shape_pt_sequence]||0);
      if(!Number.isFinite(lat)||!Number.isFinite(lon))return;
      let a=shapes.get(id);
      if(!a){a=[];shapes.set(id,a)}
      a.push({seq,coord:[lon,lat]});
    });
    let best=null;
    for(const p of picked){
      const arr=(shapes.get(p.shape)||[]).sort((a,b)=>a.seq-b.seq).map(x=>x.coord);
      if(arr.length<3)continue;
      const a=nearestIdx(arr,start),b=nearestIdx(arr,end);
      if(a.offset>1500||b.offset>1500||b.index<=a.index+2)continue;
      const seg=arr.slice(a.index,b.index+1);
      if(seg.length<3)continue;
      const same=String(p.line||'').trim().toLowerCase()===current,share=forbiddenShare(seg,anchor);
      if(share>.55)continue;
      const x3=/^x\s*3$/i.test(String(p.line||'').trim());
      const score=a.offset+b.offset+(same?900:0)+(x3?-700:0)+share*1800+routeLength(seg)*.012;
      if(!best||score<best.score)best={guide:sampleSegment(seg,start,end),line:p.line||'VT',head:p.head||'',score};
    }
    return best;
  }catch(e){
    console.warn('GTFS guide failed',e);
    return null;
  }
}

function sideGuides(anchor){
  const brg=bearing(anchor.start,anchor.end),side=(brg+90)%360,mid=[(anchor.start[0]+anchor.end[0])/2,(anchor.start[1]+anchor.end[1])/2],out=[];
  for(const m of [280,-280,520,-520,780,-780,1050,-1050,1350,-1350]){
    out.push({guide:[anchor.start,offsetMeters(mid,(side+(m<0?180:0))%360,Math.abs(m)),anchor.end],label:'alternativ bussväg'});
  }
  return out;
}
async function routeCandidate(guide){
  try{return await valhallaBusRoute(guide)}catch(e){console.warn(e);return smartBusRoute(guide)}
}

function anchorForNamedPlaces(startCoord,endCoord){
  let best=null;
  for(const name of ['tur','retur']){
    const d=state.dirs?.[name],route=d?.ordinary;
    if(!route?.length||route.length<2)continue;
    const a=nearestPointOnRoute(route,startCoord),b=nearestPointOnRoute(route,endCoord);
    if(!a||!b||a.offset>1500||b.offset>1500||b.distance<=a.distance+120)continue;
    const score=a.offset+b.offset+(name===state.direction?-30:0);
    if(!best||score<best.score)best={name,d,a,b,score};
  }
  if(!best)return null;
  if(state.direction!==best.name)setDirection(best.name);
  const d=state.dirs[best.name];
  const ia=nearestIdx(d.ordinary,best.a.coord).index,ib=nearestIdx(d.ordinary,best.b.coord).index;
  d.cutDistance=null;
  d.affected=[ia,ib];
  d._affDone=true;
  d.detour=[];
  d.roadLockedRoute=[];
  state.driveRoute=null;
  return selectedAnchor();
}

async function runLinneNilsPreset(){
  if(smartBusy)return;
  const status=$id('autoDetourStatus');
  smartBusy=true;
  try{
    if(status){status.className='autoDetourStatus busy';status.textContent='Hittar Linnéplatsen, Övre Husargatan och Nils Ericsonplatsen…'}
    const [start,via,end]=await Promise.all([
      geocodeAny(['Linnéplatsen','Linnéplatsen hållplats']),
      geocodeAny(['Övre Husargatan','Övre Husargatan 15','Övre Husargatan 20']),
      geocodeAny(['Nils Ericson Terminalen','Nils Ericsonplatsen','Nils Ericson Terminal'])
    ]);
    const anchor=anchorForNamedPlaces(start.coord,end.coord);
    if(!anchor)throw new Error('Jag hittar inte Linnéplatsen → Nils Ericson i rätt riktning på den hämtade linjen. Hämta linjen först och försök igen.');
    const withdrawn=markBlockedAndWithdraw(anchor);
    if(status)status.textContent=`Ordinarie sträcka spärrad · ${withdrawn} hållplats${withdrawn===1?'':'er'} indragen${withdrawn===1?'':'a'} · bygger väg via Övre Husargatan…`;

    let res=await routeCandidate([anchor.start,via.coord,anchor.end]);
    if(!res?.coords?.length||res.coords.length<2)throw new Error('Kunde inte bygga körvägen via Övre Husargatan.');
    const share=forbiddenShare(res.coords,anchor);
    if(share>.38)throw new Error('Förslaget går fortfarande in på den röda indragna sträckan. Jag aktiverar därför inte en felaktig väg.');

    const d=anchor.d;
    d.cutDistance=null;
    d.affected=[anchor.ia,anchor.ib];
    d._affDone=true;
    d.detour=res.coords;
    d.roadLockedRoute=[];
    d.navEvents=res.events||[];
    d.roadMeta=res.roadMeta||d.roadMeta||[];
    d.routeSource='Linnéplatsen → Nils Ericson via Övre Husargatan';
    d.freeActive=false;
    state.driveRoute=null;
    try{renderAll();fitCoords([anchor.start,...res.coords,anchor.end],80)}catch{}

    const activateBtn=$id('activateDetourBtn');
    if(activateBtn&&!activateBtn.disabled)activateBtn.click();
    else setTimeout(()=>{const b=$id('activateDetourBtn');if(b&&!b.disabled)b.click()},120);
    const viaInput=$id('autoDetourVia');
    if(viaInput)viaInput.value='Övre Husargatan';
    if(status){status.className='autoDetourStatus';status.innerHTML=`✓ <b>LINNÉPLATSEN → NILS ERICSON AKTIV</b><br>Via Övre Husargatan · ${withdrawn} hållplats${withdrawn===1?'':'er'} indragen${withdrawn===1?'':'a'} · bussen använder den nya körvägen.`}
    try{toast('Klart: Linnéplatsen → Nils Ericson via Övre Husargatan är aktiv körväg.',5200)}catch{}
  }catch(e){
    if(status){status.className='autoDetourStatus err';status.textContent=e?.message||String(e)}
    try{renderAll();renderStopManager()}catch{}
  }finally{
    smartBusy=false;
  }
}

async function runSmartAuto(){
  if(smartBusy)return;
  const status=$id('autoDetourStatus'),anchor=selectedAnchor();
  if(!anchor){
    if(status){status.className='autoDetourStatus err';status.textContent='Klicka “Markera INDRAGEN STRÄCKA” och markera start + slut på blå linjen.'}
    return;
  }
  smartBusy=true;
  try{
    const withdrawn=markBlockedAndWithdraw(anchor);
    if(status){status.className='autoDetourStatus busy';status.textContent=`Röd sträcka spärrad · ${withdrawn} hållplats${withdrawn===1?'':'er'} indragen${withdrawn===1?'':'a'} · söker ny bussväg…`}
    const candidates=[];
    const viaQ=$id('autoDetourVia')?.value.trim();
    if(viaQ){
      const via=await geocodeVia(viaQ);
      candidates.push({guide:[anchor.start,via.coord,anchor.end],label:'via '+via.name});
    }
    const ref=await findReferenceLine(anchor,status);
    if(ref)candidates.push({guide:ref.guide,label:'med VT-linje '+ref.line+' som vägledning'});
    candidates.push(...sideGuides(anchor));
    candidates.push({guide:[anchor.start,anchor.end],label:'bussvägnätet'});

    let chosen=null;
    for(const c of candidates){
      let res;
      try{res=await routeCandidate(c.guide)}catch{continue}
      if(!res?.coords?.length||res.coords.length<2)continue;
      const share=forbiddenShare(res.coords,anchor);
      if(share>.38)continue;
      chosen={res,label:c.label,share};
      break;
    }
    if(!chosen)throw new Error('Ingen säker körväg hittades som undviker den röda sträckan. Bussen stannar före avstängningen tills du väljer en annan korridor.');

    const {res,label}=chosen,d=anchor.d;
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
    try{renderAll();fitCoords([anchor.start,...res.coords,anchor.end],80)}catch{}
    const activateBtn=$id('activateDetourBtn');
    if(activateBtn&&!activateBtn.disabled)activateBtn.click();
    else setTimeout(()=>{const b=$id('activateDetourBtn');if(b&&!b.disabled)b.click()},120);
    if(status){status.className='autoDetourStatus';status.innerHTML=`✓ <b>OMLÄGGNING AKTIV</b> · röd sträcka förbjuden · ${withdrawn} hållplats${withdrawn===1?'':'er'} indragen${withdrawn===1?'':'a'} · ny väg ${label}.`}
    try{toast(`Klart: röd sträcka spärrad, ${withdrawn} hållplatser indragna och ny bussväg aktiv.`,4800)}catch{}
  }catch(e){
    if(status){status.className='autoDetourStatus err';status.textContent=e?.message||String(e)}
    try{renderAll();renderStopManager()}catch{}
  }finally{
    smartBusy=false;
  }
}

function setAdvanced(open){
  advancedOpen=!!open;
  const box=$id('autoDetourBox');
  if(!box)return;
  for(const el of box.querySelectorAll('.autoDetourFields,.autoDetourMode,.autoDetourHint,#autoDetourSearch,#autoDetourSwap'))el.style.display=advancedOpen?'':'none';
  const b=$id('simpleAdvancedBtn');
  if(b)b.textContent=advancedOpen?'▲ Dölj avancerat':'⚙ Visa avancerat / via gata';
}
function installSimpleCard(){
  const affect=$id('affectBtn');
  if(!affect)return;
  affect.textContent='🚫 MARKERA INDRAGEN STRÄCKA (2 klick)';
  affect.className='btn red wide';
  const draw=$id('detourBtn');
  if(draw){draw.textContent='✍ Manuell körväg (valfritt)';draw.className='btn wide'}
  if(!$id('simpleDetourCard')){
    const card=document.createElement('div');
    card.id='simpleDetourCard';
    card.style.cssText='grid-column:1/-1;background:#fff1f2;border:1px solid #fda4af;border-radius:10px;padding:9px;margin:0 0 7px;font-size:10px;line-height:1.4;color:#881337';
    card.innerHTML='<b style="font-size:11px">ENKEL OMLÄGGNING</b><br>1. Tryck röda knappen. 2. Klicka början och slutet på blå linjen. <b>Klart.</b> Sträckan blir förbjuden, hållplatserna där blir indragna och appen söker ny bussväg automatiskt.';
    affect.parentNode.insertBefore(card,affect);
  }
}
function installLinnePreset(){
  if($id('linneNilsPresetBtn'))return;
  const affect=$id('affectBtn');
  if(!affect?.parentNode)return;
  const b=document.createElement('button');
  b.id='linneNilsPresetBtn';
  b.className='btn green wide';
  b.style.cssText='width:100%;grid-column:1/-1;margin:0 0 7px;min-height:42px;font-weight:900';
  b.textContent='🚌 LINNÉPLATSEN → NILS ERICSON via ÖVRE HUSARGATAN';
  b.onclick=runLinneNilsPreset;
  const card=$id('simpleDetourCard');
  if(card?.nextSibling)card.parentNode.insertBefore(b,card.nextSibling);
  else affect.parentNode.insertBefore(b,affect);
}
function installSmartAuto(){
  installSimpleCard();
  installLinnePreset();
  const box=$id('autoDetourBox');
  if(!box)return !!$id('linneNilsPresetBtn');
  if(!$id('autoDetourVia')){
    const fields=box.querySelector('.autoDetourFields');
    if(fields){
      const row=document.createElement('div');
      row.className='autoDetourField';
      row.innerHTML='<label>Via / önskad korridor <span style="font-weight:500;color:#667085">(valfritt)</span></label><input id="autoDetourVia" autocomplete="off" placeholder="t.ex. Övre Husargatan">';
      fields.appendChild(row);
    }
  }
  if(!$id('simpleAdvancedBtn')){
    const b=document.createElement('button');
    b.id='simpleAdvancedBtn';
    b.className='btn small';
    b.style.cssText='width:100%;margin:5px 0';
    b.onclick=()=>setAdvanced(!advancedOpen);
    const status=$id('autoDetourStatus');
    status?.parentNode?.insertBefore(b,status);
  }
  const auto=$id('autoDetourAuto');
  if(auto){auto.textContent='🔄 Sök ny körväg igen';auto.onclick=runSmartAuto}
  const hint=box.querySelector('.autoDetourHint');
  if(hint)hint.innerHTML='<b>Avancerat:</b> skriv en gata i Via-fältet om du vill styra omläggningen, exempelvis <b>Övre Husargatan</b>.';
  setAdvanced(false);

  try{
    if(typeof setAffectedPoint==='function'&&!setAffectedPoint.__gmpBlockedAuto){
      const old=setAffectedPoint;
      const wrapped=function(c){
        const cb=$id('autoDetourGtfs'),was=cb?.checked;
        if(cb)cb.checked=false;
        try{old(c)}finally{if(cb)cb.checked=was!==false}
        const d=dir();
        if(d?._affDone&&d?.affected?.length===2){
          const a=selectedAnchor();
          if(a){
            const count=markBlockedAndWithdraw(a);
            try{toast(`Sträckan är nu INDRAGEN. ${count} hållplats${count===1?'':'er'} tas bort. Söker ny väg…`,3800)}catch{}
          }
          setTimeout(()=>runSmartAuto(),140);
        }
      };
      wrapped.__gmpBlockedAuto=true;
      setAffectedPoint=wrapped;
    }
  }catch(e){console.warn(e)}
  try{
    if(typeof beginAffectedDetour==='function'&&!beginAffectedDetour.__gmpBlockedAuto){
      const old=beginAffectedDetour;
      beginAffectedDetour=function(){clearBlocked(dir());old();try{renderAll();renderStopManager()}catch{}};
      beginAffectedDetour.__gmpBlockedAuto=true;
    }
    if(typeof clearDetourOnly==='function'&&!clearDetourOnly.__gmpBlockedAuto){
      const old=clearDetourOnly;
      clearDetourOnly=function(){clearBlocked(dir());old();try{renderAll();renderStopManager()}catch{}};
      clearDetourOnly.__gmpBlockedAuto=true;
    }
  }catch(e){console.warn(e)}
  return true;
}

document.addEventListener('click',e=>{
  if(e.target?.closest?.('#lineBtn,#setOrdinaryBtn'))setTimeout(()=>{for(const d of Object.values(state.dirs||{}))clearBlocked(d)},0);
});

let tries=0;
const timer=setInterval(()=>{tries++;if(installSmartAuto()||tries>500)clearInterval(timer)},120);
if(document.readyState!=='loading')setTimeout(installSmartAuto,20);
else document.addEventListener('DOMContentLoaded',()=>setTimeout(installSmartAuto,20));

})();
