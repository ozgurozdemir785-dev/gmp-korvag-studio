(()=>{
'use strict';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $id=id=>document.getElementById(id);
const km=m=>(m/1000).toFixed(m>=10000?1:2).replace('.',',')+' km';
let suggestions=[];
let selected=0;
let searchBusy=false;
const gtfsCorridorCache=new Map();

function autoEnabled(){return $id('autoDetourGtfs')?.checked!==false}
function norm(s){return String(s||'').toLocaleLowerCase('sv-SE').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9åäö ]/gi,' ').replace(/\s+/g,' ').trim()}
function idxAt(route,dist){let cum=0;for(let i=1;i<route.length;i++){const seg=hav(route[i-1],route[i]);if(cum+seg>=dist)return(dist-cum)<seg*.5?i-1:i;cum+=seg}return Math.max(0,route.length-1)}
function interp(a,b,t){return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]}
function routeSignature(route){if(!route?.length)return'';return[0,.17,.34,.51,.68,.85,1].map(t=>route[Math.min(route.length-1,Math.round((route.length-1)*t))]).map(c=>c.map(x=>(+x).toFixed(3)).join(',')).join('|')}
function routeSimilarity(route,base){if(!route?.length||!base?.length)return 0;const step=Math.max(1,Math.ceil(route.length/80));let near=0,total=0;for(let i=0;i<route.length;i+=step){const n=nearestPointOnRoute(base,route[i]);if(n&&n.offset<30)near++;total++}return total?near/total:0}
function lateralPoint(p,sideBearing,meters){return offsetMeters(p,(sideBearing+(meters<0?180:0))%360,Math.abs(meters))}
function bboxFor(points,pad=.006){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);return[Math.min(...ys)-pad,Math.min(...xs)-pad,Math.max(...ys)+pad,Math.max(...xs)+pad]}
function explicitBusAccess(tags={}){const vals=[tags.bus,tags.psv,tags.motor_vehicle,tags.access].map(x=>String(x||'').toLowerCase());return vals.some(x=>['yes','designated','permissive','destination'].includes(x))||['busway','bus_guideway'].includes(String(tags.highway||''))||!!tags['bus:lanes']||!!tags['psv:lanes']||!!tags.busway}

function css(){
  if($id('autoDetourCss'))return;
  const s=document.createElement('style');s.id='autoDetourCss';s.textContent=`
  .autoDetourBox{grid-column:1/-1;border:1px solid #bfd1e8;background:#f7fbff;border-radius:11px;padding:9px;margin:2px 0 5px}
  .autoDetourHead{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:7px}.autoDetourHead b{font-size:12px}.autoDetourHead span{font-size:9px;font-weight:900;color:#1267d6;background:#e8f2ff;padding:4px 6px;border-radius:999px}
  .autoDetourFields{display:grid;grid-template-columns:1fr;gap:6px}.autoDetourField label{display:block;font-size:10px;font-weight:900;color:#475467;margin-bottom:3px}.autoDetourField input{width:100%;border:1px solid #cfd8e6;border-radius:8px;padding:8px;background:#fff;font-size:11px}
  .autoDetourActions{display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:7px}.autoDetourActions button{min-width:0}.autoDetourAutoBtn{grid-column:1/-1;background:#ecfdf3!important;border-color:#84d5a9!important;color:#067647!important}
  .autoDetourHint{font-size:9px;line-height:1.4;color:#667085;margin-top:6px}.autoDetourHint b{color:#344054}
  .autoDetourMode{display:flex;gap:5px;flex-wrap:wrap;margin-top:6px}.autoDetourMode span,.autoDetourMode label{font-size:9px;font-weight:900;border:1px solid #c9d8eb;background:#fff;border-radius:999px;padding:4px 6px;color:#344054}.autoDetourMode .ok{color:#067647;background:#ecfdf3;border-color:#a6e1c2}.autoDetourMode input{vertical-align:-2px}
  .autoDetourResults{display:grid;gap:5px;margin-top:8px}.autoDetourResult{border:1px solid #d7e1ed;background:#fff;border-radius:9px;padding:7px;cursor:pointer}.autoDetourResult:hover{border-color:#8bb6ee}.autoDetourResult.active{border-color:#1267d6;box-shadow:0 0 0 2px #1267d61f;background:#f5f9ff}
  .autoDetourResultTop{display:flex;justify-content:space-between;gap:6px;align-items:center}.autoDetourResultTop b{font-size:11px}.autoDetourResultTop span{font-size:10px;font-weight:900;color:#0b57b8}.autoDetourMeta{font-size:9px;color:#667085;margin-top:3px}.autoDetourTag{display:inline-block;margin-top:4px;margin-right:4px;border-radius:999px;padding:3px 5px;font-size:8px;font-weight:900;background:#eef4ff;color:#0b57b8}.autoDetourTag.gtfs{background:#fff4e5;color:#b54708}.autoDetourTag.tram{background:#f4f0ff;color:#6b46c1}.autoDetourTag.bus{background:#ecfdf3;color:#067647}
  .autoDetourBtns{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:7px}.autoDetourStatus{font-size:10px;color:#475467;margin-top:6px}.autoDetourStatus.busy{color:#0b57b8;font-weight:800}.autoDetourStatus.err{color:#b42318;font-weight:800}
  `;document.head.appendChild(s);
}

function install(){
  css();
  const routeSec=$id('leftSecRoute')?.querySelector('.sectionBody'),anchor=$id('detourWorkflowState');
  if(!routeSec||!anchor||$id('autoDetourBox'))return;
  const box=document.createElement('div');box.id='autoDetourBox';box.className='autoDetourBox';box.innerHTML=`
    <div class="autoDetourHead"><b>🧭 Automatisk omläggningsnavigator</b><span>GTFS AUTO</span></div>
    <div class="autoDetourFields">
      <div class="autoDetourField"><label>Omläggning från</label><input id="autoDetourFrom" list="autoDetourStops" autocomplete="off" placeholder="Hållplats eller gata"></div>
      <div class="autoDetourField"><label>Omläggning till</label><input id="autoDetourTo" list="autoDetourStops" autocomplete="off" placeholder="Hållplats eller gata"></div>
    </div>
    <datalist id="autoDetourStops"></datalist>
    <div class="autoDetourActions">
      <button id="autoDetourAuto" class="btn small autoDetourAutoBtn">⚡ AUTO enligt linjens tidtabell</button>
      <button id="autoDetourSearch" class="btn primary small">🚌 Hitta alternativa körvägar</button><button id="autoDetourSwap" class="btn small" title="Byt från/till">⇅</button>
    </div>
    <div class="autoDetourMode"><label class="ok"><input id="autoDetourGtfs" type="checkbox" checked> GTFS/tidtabell</label><span>✓ Tur/Retur</span><span>✓ Andra VT-linjer</span><span>✓ Bussvägnät</span></div>
    <div class="autoDetourHint"><b>Enklaste sättet:</b> klicka “Omläggning mellan 2 punkter” och markera ungefär början och slutet på den blå linjen. Med AUTO på läser systemet hållplatsordning/tidtabell, väljer rätt riktning och letar även efter andra Västtrafiklinjer som redan kör användbara stråk.</div>
    <div id="autoDetourStatus" class="autoDetourStatus">AUTO redo – välj två punkter på linjen eller skriv Från/Till.</div>
    <div id="autoDetourResults" class="autoDetourResults"></div>
    <div id="autoDetourBtns" class="autoDetourBtns hidden"><button id="autoDetourPreview" class="btn small">👁 Visa valt</button><button id="autoDetourApply" class="btn green small">✓ Använd valt</button></div>`;
  routeSec.insertBefore(box,anchor);
  $id('autoDetourSearch').onclick=()=>findAlternatives();
  $id('autoDetourAuto').onclick=()=>autoFromSelected(true);
  $id('autoDetourSwap').onclick=()=>{const a=$id('autoDetourFrom'),b=$id('autoDetourTo'),v=a.value;a.value=b.value;b.value=v};
  $id('autoDetourPreview').onclick=()=>previewSuggestion(selected,false);
  $id('autoDetourApply').onclick=()=>previewSuggestion(selected,true);
  refreshStopList();
}

function refreshStopList(){
  const dl=$id('autoDetourStops');if(!dl||typeof state==='undefined')return;
  const names=[];for(const dn of ['tur','retur'])for(const st of (state.dirs?.[dn]?.stops||[]))if(st?.name&&!names.includes(st.name))names.push(st.name);
  const html=names.slice(0,220).map(n=>`<option value="${esc(n)}"></option>`).join('');if(dl.innerHTML!==html)dl.innerHTML=html;
}

function stopMatch(query){
  const q=norm(query);if(!q)return null;let best=null;
  for(const dn of ['tur','retur'])for(const st of (state.dirs?.[dn]?.stops||[])){
    if(!st?.coord)continue;const n=norm(st.name),exact=n===q,contains=n.includes(q)||q.includes(n);let score=exact?0:contains?10+Math.abs(n.length-q.length):100;
    if(score>=100){const words=q.split(' '),hit=words.filter(w=>w.length>2&&n.includes(w)).length;score=80-hit*12+Math.abs(n.length-q.length)*.15}
    if(!best||score<best.score)best={coord:st.coord,name:st.name,score,source:'hållplats'};
  }
  return best&&best.score<55?best:null;
}
async function geocodeOne(query){
  const st=stopMatch(query);if(st)return st;
  const u='/geo/search?format=json&limit=5&countrycodes=se&addressdetails=1&q='+encodeURIComponent(query+', Göteborg, Västra Götaland');
  const r=await fetch(u,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error('Platssökningen svarade '+r.status);const j=await r.json();
  const x=(j||[]).find(v=>Number.isFinite(+v.lon)&&Number.isFinite(+v.lat));if(!x)throw new Error('Hittade inte platsen “'+query+'”');
  return{coord:[+x.lon,+x.lat],name:x.display_name?.split(',').slice(0,2).join(', ')||query,source:'plats'};
}

function chooseDirection(from,to){
  let best=null;
  for(const dn of ['tur','retur']){
    const d=state.dirs?.[dn],route=d?.ordinary;if(!route?.length||route.length<2)continue;
    const a=nearestPointOnRoute(route,from),b=nearestPointOnRoute(route,to);if(!a||!b||b.distance<=a.distance+18)continue;
    let stopBonus=0;
    const ss=(d.stops||[]).map(st=>({st,n:nearestPointOnRoute(route,st.coord)})).filter(x=>x.n).sort((x,y)=>x.n.distance-y.n.distance);
    const ia=ss.findIndex(x=>hav(x.st.coord,from)<160),ib=ss.findIndex(x=>hav(x.st.coord,to)<160);if(ia>=0&&ib>ia)stopBonus=-40;
    const score=a.offset+b.offset+stopBonus+(dn===state.direction?-5:0);
    if(!best||score<best.score)best={direction:dn,d,a,b,score};
  }
  return best;
}

function orderedStops(d){
  if(!d?.ordinary?.length)return[];
  return(d.stops||[]).map(st=>({st,n:nearestPointOnRoute(d.ordinary,st.coord)})).filter(x=>x.n&&x.n.offset<80).sort((a,b)=>a.n.distance-b.n.distance);
}
function autoStopsForAffected(d){
  if(!d?.affected||d.affected.length<2||!d.ordinary?.length)return null;
  let [ia,ib]=d.affected.map(Number);if(ia>ib)[ia,ib]=[ib,ia];
  const a=nearestPointOnRoute(d.ordinary,d.ordinary[Math.max(0,Math.min(d.ordinary.length-1,ia))]),b=nearestPointOnRoute(d.ordinary,d.ordinary[Math.max(0,Math.min(d.ordinary.length-1,ib))]);
  if(!a||!b)return null;const ss=orderedStops(d);if(!ss.length)return{from:{coord:a.coord,name:'Vald startpunkt'},to:{coord:b.coord,name:'Vald återanslutning'}};
  let from=ss[0],to=ss.at(-1);for(const x of ss){if(x.n.distance<=a.distance+120)from=x;if(x.n.distance>=b.distance-120){to=x;break}}
  if(to.n.distance<=from.n.distance){const pos=ss.indexOf(from);to=ss[Math.min(ss.length-1,pos+1)]||to}
  return{from:{coord:from.n.coord,name:from.st.name||'Start'},to:{coord:to.n.coord,name:to.st.name||'Till'},anchor:{direction:state.direction,d,a:nearestPointOnRoute(d.ordinary,from.n.coord),b:nearestPointOnRoute(d.ordinary,to.n.coord)}};
}
async function autoFromSelected(run=true){
  const status=$id('autoDetourStatus'),d=dir(),x=autoStopsForAffected(d);
  if(!x){if(status){status.className='autoDetourStatus err';status.textContent='Välj först “Omläggning mellan 2 punkter” och klicka ungefär början + slutet på den blå linjen.'}return}
  $id('autoDetourFrom').value=x.from.name;$id('autoDetourTo').value=x.to.name;
  if(status){status.className='autoDetourStatus';status.textContent=`AUTO: ${x.from.name} → ${x.to.name}. Riktning och tidtabellsstråk väljs automatiskt.`}
  if(run)await findAlternatives({from:x.from,to:x.to,anchor:x.anchor,auto:true});
}

async function fetchTransitCorridors(start,end,base){
  const pts=[start,end,...(base?.length?base.filter((_,i)=>i%Math.max(1,Math.ceil(base.length/25))===0):[])],bbox=bboxFor(pts,.012);if(bbox[2]-bbox[0]>.12||bbox[3]-bbox[1]>.18)return[];
  try{const r=await fetch('/osm-busways',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({bbox})});if(!r.ok)return[];const j=await r.json(),out=[];for(const e of(j.elements||[])){const tags=e.tags||{},geom=(e.geometry||[]).map(p=>[+p.lon,+p.lat]).filter(p=>p.every(Number.isFinite));if(geom.length<2||!explicitBusAccess(tags))continue;out.push({coords:geom,isTram:String(tags.railway||'').toLowerCase()==='tram',isBusway:['busway','bus_guideway'].includes(String(tags.highway||''))||!!tags.busway||!!tags['bus:lanes']||!!tags['psv:lanes']})}return out}catch{return[]}
}
function corridorRouteShare(route,corridors){if(!route?.length||!corridors?.length)return{tram:0,bus:0};const step=Math.max(1,Math.ceil(route.length/90));let tram=0,bus=0,total=0;for(let i=0;i<route.length;i+=step){total++;let hit=null,best=Infinity;for(const c of corridors){const n=nearestPointOnRoute(c.coords,route[i]);if(n&&n.offset<best){best=n.offset;hit=c}}if(best<18&&hit){bus++;if(hit.isTram)tram++}}return{tram:total?tram/total:0,bus:total?bus/total:0}}
function corridorGuides(start,end,corridors){const arr=[];for(const c of corridors){const m=c.coords?.[Math.floor(c.coords.length/2)];if(!m)continue;const n=nearestPointOnRoute([start,end],m);if(!n||n.offset>1500||hav(start,m)<40||hav(end,m)<40)continue;arr.push({guide:[start,m,end],kind:'osm',score:n.offset-(c.isBusway?80:0)-(c.isTram?50:0)})}return arr.sort((a,b)=>a.score-b.score).slice(0,5)}

function nearestIdx(route,p){let bi=0,bd=Infinity;for(let i=0;i<route.length;i++){const d=hav(route[i],p);if(d<bd){bd=d;bi=i}}return{index:bi,offset:bd}}
function sampleGuide(seg,start,end){if(!seg?.length)return[start,end];const out=[start];for(const t of [.22,.42,.62,.82])out.push(seg[Math.min(seg.length-1,Math.round((seg.length-1)*t))]);out.push(end);return out.filter((p,i,a)=>!i||hav(p,a[i-1])>35)}
function gtfsCacheKey(anchor){const f=anchor.a.coord,t=anchor.b.coord,line=anchor.d?.lineInfo?.line||'';return`${line}|${f[0].toFixed(3)},${f[1].toFixed(3)}|${t[0].toFixed(3)},${t[1].toFixed(3)}`}

async function timetableGuides(anchor,status){
  if(!autoEnabled())return[];
  const key=gtfsCacheKey(anchor);if(gtfsCorridorCache.has(key))return gtfsCorridorCache.get(key);
  if(typeof gtfsZipBuffer==='undefined'||!gtfsZipBuffer)return[];
  try{
    if(status)status.textContent='Läser Västtrafiks tidtabell och letar andra linjer som redan kör mellan områdena…';
    const zip=zipReader(gtfsZipBuffer),start=anchor.a.coord,end=anchor.b.coord;
    const stopsText=await zip.text('stops.txt'),startIds=new Set(),endIds=new Set();
    forEachCsv(stopsText,(c,m)=>{const lat=+c[m.stop_lat],lon=+c[m.stop_lon],id=c[m.stop_id];if(!id||!Number.isFinite(lat)||!Number.isFinite(lon))return;const p=[lon,lat];if(hav(p,start)<=520)startIds.add(id);if(hav(p,end)<=520)endIds.add(id)});
    if(!startIds.size||!endIds.size)return[];
    const stopTimes=await zip.text('stop_times.txt'),hits=new Map();
    forEachCsv(stopTimes,(c,m)=>{const sid=c[m.stop_id];if(!startIds.has(sid)&&!endIds.has(sid))return;const trip=c[m.trip_id],seq=+(c[m.stop_sequence]||0);if(!trip)return;let h=hits.get(trip);if(!h){h={s:Infinity,e:-Infinity};hits.set(trip,h)}if(startIds.has(sid))h.s=Math.min(h.s,seq);if(endIds.has(sid))h.e=Math.max(h.e,seq)});
    const tripIds=new Set([...hits].filter(([,h])=>Number.isFinite(h.s)&&Number.isFinite(h.e)&&h.e>h.s).sort((a,b)=>(a[1].e-a[1].s)-(b[1].e-b[1].s)).slice(0,120).map(([id])=>id));
    if(!tripIds.size)return[];
    const tripsText=await zip.text('trips.txt'),trips=[];forEachCsv(tripsText,(c,m)=>{const tid=c[m.trip_id];if(!tripIds.has(tid))return;const sh=c[m.shape_id],rid=c[m.route_id];if(sh&&rid)trips.push({trip:tid,shape:sh,routeId:rid,head:c[m.trip_headsign]||''})});
    const routeIds=new Set(trips.map(x=>x.routeId)),routeMeta=new Map(),routesText=await zip.text('routes.txt');
    forEachCsv(routesText,(c,m)=>{const rid=c[m.route_id];if(!routeIds.has(rid))return;const rt=Number(c[m.route_type]||0),isBus=rt===3||(rt>=700&&rt<800);if(isBus)routeMeta.set(rid,{line:(c[m.route_short_name]||'').trim(),long:(c[m.route_long_name]||'').trim()})});
    const current=norm(anchor.d?.lineInfo?.line||''),picked=[],seenShape=new Set();
    for(const t of trips){const rm=routeMeta.get(t.routeId);if(!rm||seenShape.has(t.shape))continue;seenShape.add(t.shape);picked.push({...t,...rm});if(picked.length>=28)break}
    const wanted=new Set(picked.map(x=>x.shape)),shapes=new Map(),shapesText=await zip.text('shapes.txt');
    forEachCsv(shapesText,(c,m)=>{const id=c[m.shape_id];if(!wanted.has(id))return;const lat=+c[m.shape_pt_lat],lon=+c[m.shape_pt_lon],seq=+(c[m.shape_pt_sequence]||0);if(!Number.isFinite(lat)||!Number.isFinite(lon))return;let a=shapes.get(id);if(!a){a=[];shapes.set(id,a)}a.push({seq,coord:[lon,lat]})});
    const refs=[];
    for(const p of picked){const arr=(shapes.get(p.shape)||[]).sort((a,b)=>a.seq-b.seq).map(x=>x.coord);if(arr.length<2)continue;const a=nearestIdx(arr,start),b=nearestIdx(arr,end);if(a.offset>850||b.offset>850||b.index<=a.index+2)continue;const seg=arr.slice(a.index,b.index+1),sim=routeSimilarity(seg,routeSliceByDistance(anchor.d.ordinary,anchor.a.distance,anchor.b.distance,20));if(norm(p.line)===current&&sim>.82)continue;refs.push({guide:sampleGuide(seg,start,end),kind:'gtfs',refLine:p.line||'VT',refHead:p.head||'',score:a.offset+b.offset+sim*500,raw:seg})}
    refs.sort((a,b)=>a.score-b.score);const out=refs.slice(0,7);gtfsCorridorCache.set(key,out);return out;
  }catch(e){console.warn('GTFS-korridorer kunde inte läsas',e);return[]}
}

async function buildCandidates(anchor,status){
  const {d,a,b}=anchor,start=a.coord,end=b.coord,base=routeSliceByDistance(d.ordinary,a.distance,b.distance,12),baseLen=routeLength(base),brg=bearing(start,end),side=(brg+90)%360,mid=interp(start,end,.5),p35=interp(start,end,.35),p65=interp(start,end,.65);
  const [corridors,refs]=await Promise.all([fetchTransitCorridors(start,end,base),timetableGuides(anchor,status)]);
  const guideObjs=[...refs,...corridorGuides(start,end,corridors),{guide:[start,end],kind:'direct'}];
  for(const m of [260,-260,480,-480,760,-760,1050,-1050,1300,-1300])guideObjs.push({guide:[start,lateralPoint(mid,side,m),end],kind:'wide'});
  for(const m of [420,-420,820,-820])guideObjs.push({guide:[start,lateralPoint(p35,side,m),lateralPoint(p65,side,m),end],kind:'wide'});
  const uniqGuide=[],gseen=new Set();for(const g of guideObjs){const k=g.guide.map(p=>p.map(x=>(+x).toFixed(4)).join(',')).join('|');if(gseen.has(k))continue;gseen.add(k);uniqGuide.push(g)}
  const out=[],seen=new Set();
  for(let i=0;i<uniqGuide.length&&out.length<5;i+=4){
    const batch=uniqGuide.slice(i,i+4);const settled=await Promise.allSettled(batch.map(async g=>({g,res:await valhallaBusRoute(g.guide)})));
    for(const x of settled){if(x.status!=='fulfilled')continue;const {g,res}=x.value;if(!res?.coords?.length)continue;const sig=routeSignature(res.coords);if(seen.has(sig))continue;seen.add(sig);const len=routeLength(res.coords),similarity=routeSimilarity(res.coords,base),share=corridorRouteShare(res.coords,corridors);if(!g.refLine&&out.length&&similarity>.95&&Math.abs(len-baseLen)<150)continue;out.push({coords:res.coords,events:res.events||[],roadMeta:res.roadMeta||[],len,baseLen,similarity,corridorShare:share.bus,tramShare:share.tram,refLine:g.refLine||'',refHead:g.refHead||'',source:g.refLine?`Västtrafik linje ${g.refLine} som guide`:(res.source||'BUSS-routing')});if(out.length>=5)break}
  }
  if(!out.length){const res=await smartBusRoute([start,end]);out.push({coords:res.coords,events:res.events||[],roadMeta:res.roadMeta||[],len:routeLength(res.coords),baseLen,similarity:routeSimilarity(res.coords,base),corridorShare:0,tramShare:0,refLine:'',source:res.source||'Bussrouting'})}
  out.sort((x,y)=>{const sx=x.len+(x.similarity>.9?500:0)-(x.refLine?900:0)-(x.corridorShare||0)*260,sy=y.len+(y.similarity>.9?500:0)-(y.refLine?900:0)-(y.corridorShare||0)*260;return sx-sy});
  return out.slice(0,5);
}

async function findAlternatives(override=null){
  if(searchBusy)return;const status=$id('autoDetourStatus');let from,to,anchor;
  try{
    if(override?.from&&override?.to){from=override.from;to=override.to;anchor=override.anchor||chooseDirection(from.coord,to.coord)}
    else{
      let fromQ=$id('autoDetourFrom')?.value.trim(),toQ=$id('autoDetourTo')?.value.trim();
      if((!fromQ||!toQ)&&autoEnabled()){const x=autoStopsForAffected(dir());if(x){from=x.from;to=x.to;anchor=x.anchor;$id('autoDetourFrom').value=from.name;$id('autoDetourTo').value=to.name}}
      if((!from&&!fromQ)||(!to&&!toQ)){status.className='autoDetourStatus err';status.textContent='Skriv Från/Till eller välj två punkter på den blå linjen.';return}
      if(!from||!to)[from,to]=await Promise.all([geocodeOne(fromQ),geocodeOne(toQ)]);
      anchor=anchor||chooseDirection(from.coord,to.coord);
    }
    if(!state?.dirs?.tur?.ordinary?.length&&!state?.dirs?.retur?.ordinary?.length)throw new Error('Hämta först Västtrafiklinjen som ska läggas om.');
    if(!anchor)throw new Error('Systemet kunde inte hitta rätt turordning. Byt Från/Till eller markera två punkter på den blå linjen.');
    if(anchor.a.offset>750||anchor.b.offset>750)throw new Error('Från eller Till ligger för långt från den hämtade linjen.');
    searchBusy=true;suggestions=[];$id('autoDetourResults').innerHTML='';$id('autoDetourBtns').classList.add('hidden');status.className='autoDetourStatus busy';
    if(state.direction!==anchor.direction)setDirection(anchor.direction);
    status.textContent=`AUTO ${anchor.direction==='retur'?'Retur':'Tur'}: läser hållplatsordning, tidtabell och andra Västtrafiklinjer…`;
    const routes=await buildCandidates(anchor,status);suggestions=routes.map((r,i)=>({...r,index:i,anchor,from,to}));selected=0;renderResults();status.className='autoDetourStatus';
    const refs=[...new Set(suggestions.map(x=>x.refLine).filter(Boolean))];status.textContent=`${from.name} → ${to.name} · ${anchor.direction==='retur'?'Retur':'Tur'} · ${suggestions.length} förslag${refs.length?' · inspirerade av linje '+refs.join(', '):''}.`;
  }catch(e){status.className='autoDetourStatus err';status.textContent=e.message||String(e)}finally{searchBusy=false}
}

function renderResults(){
  const el=$id('autoDetourResults');if(!el)return;el.innerHTML=suggestions.map((r,i)=>{const extra=r.len-r.baseLen,sim=Math.round(r.similarity*100),busPct=Math.round((r.corridorShare||0)*100),tramPct=Math.round((r.tramShare||0)*100),label=r.refLine?`Som linje ${esc(r.refLine)}`:i===0?'Rekommenderad':sim<45?'Tydlig omledning':sim<72?'Alternativ sträcka':'Nära ordinarie',tags=[r.refLine?`<span class="autoDetourTag gtfs">GTFS linje ${esc(r.refLine)}</span>`:'',busPct>=4?`<span class="autoDetourTag bus">${busPct}% buss-/PSV-stråk</span>`:'',tramPct>=3?`<span class="autoDetourTag tram">${tramPct}% tillåtet spårområde</span>`:''].join('');return`<div class="autoDetourResult ${i===selected?'active':''}" data-i="${i}"><div class="autoDetourResultTop"><b>Förslag ${i+1} · ${label}</b><span>${km(r.len)}</span></div><div class="autoDetourMeta">${extra>=0?'+':''}${Math.round(extra)} m mot ordinarie · ${sim}% nära ordinarie${r.refHead?' · mot '+esc(r.refHead):''}</div>${tags}</div>`}).join('');
  el.querySelectorAll('.autoDetourResult').forEach(x=>x.onclick=()=>{selected=+x.dataset.i;renderResults()});$id('autoDetourBtns').classList.toggle('hidden',!suggestions.length);
}
function previewSuggestion(i,apply){
  const s=suggestions[i];if(!s)return;const {anchor}=s;if(state.direction!==anchor.direction)setDirection(anchor.direction);const d=dir();
  d.cutDistance=null;d.affected=[idxAt(d.ordinary,anchor.a.distance),idxAt(d.ordinary,anchor.b.distance)];d._affDone=true;d.detour=s.coords;d.roadLockedRoute=[];d.navEvents=s.events||[];d.roadMeta=s.roadMeta||d.roadMeta||[];d.routeSource=`Auto-omläggning · Förslag ${i+1}${s.refLine?' · via VT '+s.refLine:''}`;d.freeActive=false;state.driveRoute=null;
  fitCoords(buildSimRoute(d),70);renderAll();
  if(apply){setTimeout(()=>{try{enrichDirRoadMeta(d,buildSimRoute(d)).catch(()=>{})}catch{}},900);toast(`Förslag ${i+1} används som omläggning${s.refLine?' med linje '+s.refLine+' som vägledning':''}.`,4200)}else toast(`Förhandsvisar Förslag ${i+1}. Tryck “Använd valt” när du är nöjd.`,2800);
}

function installAutoHooks(){
  try{
    if(typeof setAffectedPoint==='function'&&!setAffectedPoint.__gmpAuto){const old=setAffectedPoint;const wrapped=function(c){old(c);const d=dir();if(autoEnabled()&&d?._affDone&&d?.affected?.length===2)setTimeout(()=>autoFromSelected(true),80)};wrapped.__gmpAuto=true;setAffectedPoint=wrapped}
  }catch(e){console.warn(e)}
  try{
    if(typeof applyGtfsResult==='function'&&!applyGtfsResult.__gmpAuto){const old=applyGtfsResult;const wrapped=function(res){old(res);setTimeout(()=>{refreshStopList();gtfsCorridorCache.clear()},60)};wrapped.__gmpAuto=true;applyGtfsResult=wrapped}
  }catch(e){console.warn(e)}
}

function startDetourInstaller(){
  let n=0;
  const run=()=>{n++;try{install();installAutoHooks()}catch(e){console.warn(e)}if($id('autoDetourBox')||n>500)clearInterval(t)};
  const t=setInterval(run,120);run();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',startDetourInstaller);else startDetourInstaller();
})();
