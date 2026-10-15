(()=>{
'use strict';
/* SMART_PLACE_DETOUR_V4
   Generisk omläggningsnavigator. Använder appens interna navigator via window.GMP_APP,
   känner igen Västtrafik-hållplatser på den laddade linjen, kompletterar med kartträffar,
   och bygger omläggning mellan vald start/slut med valfria via-punkter.
   Ändrar inte Google 3D, Trafikverket API eller Cloudflare secrets. */

const $=id=>document.getElementById(id);
const picked={smartFrom:null,smartTo:null};
let viaPoints=[];
let searchToken=0;
let busy=false;
const app=()=>window.GMP_APP||null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9åäöéü\s-]/gi,' ').replace(/\s+/g,' ').trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function status(text,kind=''){
  const el=$('smartPlaceStatus');
  if(!el)return;
  el.className='smartPlaceStatus'+(kind?' '+kind:'');
  el.textContent=text;
}
function say(text,ms=4800){
  try{app()?.toast?.(text,ms)}catch{}
  if(!app()?.toast)console.log(text);
}
function allLoadedStops(){
  const A=app(),out=[];
  if(!A?.state?.dirs)return out;
  for(const name of ['tur','retur']){
    const d=A.state.dirs[name],line=d?.lineInfo?.line||$('lineInput')?.value||'';
    for(const st of (d?.stops||[])){
      if(!st?.coord||!st?.name)continue;
      out.push({kind:'stop',name:st.name,detail:`Västtrafik${line?' · linje '+line:''} · ${name==='tur'?'Tur':'Retur'}`,coord:[+st.coord[0],+st.coord[1]],official:true,direction:name});
    }
  }
  return out;
}
function localMatches(q){
  const nq=norm(q);if(!nq)return[];
  const toks=nq.split(' ').filter(Boolean),seen=new Set(),out=[];
  for(const x of allLoadedStops()){
    const n=norm(x.name);if(!toks.every(t=>n.includes(t)))continue;
    const key=n+'_'+x.coord.map(v=>v.toFixed(5)).join('_');if(seen.has(key))continue;seen.add(key);
    const score=n===nq?120:n.startsWith(nq)?95:70;
    out.push({...x,score});
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,8);
}
async function mapMatches(q){
  if(!q?.trim())return[];
  try{
    const u='/geo/search?format=json&addressdetails=1&limit=8&countrycodes=se&q='+encodeURIComponent(q.trim()+', Göteborg');
    const r=await fetch(u,{headers:{Accept:'application/json'},cache:'no-store'});if(!r.ok)return[];
    const j=await r.json();
    return (j||[]).filter(x=>Number.isFinite(+x.lon)&&Number.isFinite(+x.lat)).map(x=>({kind:/bus_stop|platform|public_transport|station/i.test((x.class||'')+' '+(x.type||''))?'stop':'place',name:(x.display_name||q).split(',')[0],detail:x.display_name||q,coord:[+x.lon,+x.lat],official:false,score:30}));
  }catch{return[]}
}
async function suggestions(q){
  const local=localMatches(q),map=await mapMatches(q),seen=new Set(),out=[];
  for(const x of [...local,...map]){
    const k=norm(x.name)+'_'+x.coord.map(v=>v.toFixed(4)).join('_');if(seen.has(k))continue;seen.add(k);out.push(x);if(out.length>=10)break;
  }
  return out;
}
function listId(inputId){return inputId+'Suggestions'}
function hideLists(except=''){for(const id of ['smartFromSuggestions','smartViaSuggestions','smartToSuggestions'])if(id!==except)$(id)?.classList.add('hidden')}
function renderSuggestions(inputId,items){
  const box=$(listId(inputId));if(!box)return;
  if(!items.length){box.innerHTML='<div class="spEmpty">Ingen träff ännu.</div>';box.classList.remove('hidden');return}
  box.innerHTML=items.map((x,i)=>`<button type="button" class="spHit" data-i="${i}"><b>${x.kind==='stop'?'🚏':'📍'} ${esc(x.name)}${x.official?'<span>VÄSTTRAFIK</span>':''}</b><small>${esc(x.detail)}</small></button>`).join('');
  box.classList.remove('hidden');
  box.querySelectorAll('.spHit').forEach(b=>b.onclick=()=>selectSuggestion(inputId,items[+b.dataset.i]));
}
function selectSuggestion(inputId,x){
  if(inputId==='smartVia'){
    viaPoints.push({...x});renderViaChips();$('smartVia').value='';$('smartViaSuggestions')?.classList.add('hidden');return;
  }
  picked[inputId]={...x};$(inputId).value=x.name;$(listId(inputId))?.classList.add('hidden');
  status(`${inputId==='smartFrom'?'Start':'Återanslutning'} vald: ${x.name}`);
}
function bindSuggest(inputId){
  const el=$(inputId);if(!el||el.dataset.smartBound)return;el.dataset.smartBound='1';let timer=0;
  el.addEventListener('input',()=>{
    if(inputId!=='smartVia')picked[inputId]=null;
    clearTimeout(timer);const q=el.value.trim();if(q.length<2){$(listId(inputId))?.classList.add('hidden');return}
    const token=++searchToken;timer=setTimeout(async()=>{const items=await suggestions(q);if(token!==searchToken)return;hideLists(listId(inputId));renderSuggestions(inputId,items)},180);
  });
  el.addEventListener('focus',()=>{if(el.value.trim().length>=2)el.dispatchEvent(new Event('input'))});
  el.addEventListener('keydown',e=>{if(inputId==='smartVia'&&e.key==='Enter'){e.preventDefault();resolveViaText(el.value.trim()).catch(err=>status(err.message,'err'))}});
}
function renderViaChips(){
  const box=$('smartViaChips');if(!box)return;
  box.innerHTML=viaPoints.length?viaPoints.map((x,i)=>`<span class="spChip">${esc(x.name)} <button type="button" data-x="${i}">×</button></span>`).join(''):'<span class="spMuted">Ingen via-punkt – appen söker direkt mellan start och återanslutning.</span>';
  box.querySelectorAll('[data-x]').forEach(b=>b.onclick=()=>{viaPoints.splice(+b.dataset.x,1);renderViaChips()});
}
async function resolveText(q){
  const items=await suggestions(q);if(!items.length)throw new Error('Hittade inte “'+q+'”.');return items[0];
}
async function resolveViaText(q){if(!q)return;const x=await resolveText(q);viaPoints.push(x);$('smartVia').value='';$('smartViaSuggestions')?.classList.add('hidden');renderViaChips();status('Via tillagd: '+x.name)}
async function fieldPlace(id){const p=picked[id];if(p)return p;const q=$(id)?.value.trim();if(!q)throw new Error(id==='smartFrom'?'Skriv var omläggningen börjar.':'Skriv var bussen ska tillbaka till ordinarie linje.');const x=await resolveText(q);picked[id]=x;$(id).value=x.name;return x}
function nearestIdx(route,p,A){let bi=0,bd=Infinity;for(let i=0;i<(route||[]).length;i++){const d=A.hav(route[i],p);if(d<bd){bd=d;bi=i}}return bi}
function bestDirection(startCoord,endCoord){
  const A=app();let best=null;if(!A?.state?.dirs)return null;
  for(const name of ['tur','retur']){
    const d=A.state.dirs[name],route=d?.ordinary;if(!route?.length||route.length<2)continue;
    const a=A.nearestPointOnRoute(route,startCoord),b=A.nearestPointOnRoute(route,endCoord);if(!a||!b||b.distance<=a.distance+25)continue;
    const score=a.offset+b.offset+(name===A.state.direction?-25:0);
    if(!best||score<best.score)best={name,d,a,b,score};
  }
  return best;
}
function restoreStops(d){
  for(const st of (d?.stops||[]))if(st?._smartPlaceChanged){st.serve=st._smartPlacePrevServe;st.closed=st._smartPlacePrevClosed;delete st._smartPlaceChanged;delete st._smartPlacePrevServe;delete st._smartPlacePrevClosed}
}
function withdrawStops(d,aDist,bDist,start,end,A){
  restoreStops(d);let n=0;
  for(const st of (d?.stops||[])){
    if(!st?.coord)continue;const p=A.nearestPointOnRoute(d.ordinary,st.coord);if(!p||p.offset>90)continue;
    if(A.hav(st.coord,start)<85||A.hav(st.coord,end)<85)continue;
    if(p.distance>aDist+15&&p.distance<bDist-15){st._smartPlacePrevServe=st.serve;st._smartPlacePrevClosed=st.closed;st._smartPlaceChanged=true;st.serve=false;st.closed=true;n++}
  }
  return n;
}
async function routeVia(points,A){
  let err=null;
  try{return await A.valhallaBusRoute(points)}catch(e){err=e;console.warn('Valhalla smart place',e)}
  try{return await A.smartBusRoute(points,{allowOfficial:false})}catch(e){err=e;console.warn('Smart route smart place',e)}
  try{return await A.osrmRoute(points)}catch(e){err=e;console.warn('OSRM smart place',e)}
  throw err||new Error('Ingen ruttjänst kunde bygga körvägen.');
}
async function routeSegmented(points,A){
  const coords=[],events=[],roadMeta=[];
  for(let i=0;i<points.length-1;i++){
    status(`Bygger del ${i+1} av ${points.length-1}…`,'busy');const p=await routeVia([points[i],points[i+1]],A);
    if(!p?.coords?.length)throw new Error('En del av körvägen kunde inte byggas.');
    if(coords.length&&A.hav(coords.at(-1),p.coords[0])<8)coords.push(...p.coords.slice(1));else coords.push(...p.coords);
    if(Array.isArray(p.events))events.push(...p.events);if(Array.isArray(p.roadMeta))roadMeta.push(...p.roadMeta);
  }
  return{coords,events,roadMeta,source:'Smart omläggning'};
}
async function buildDetour(){
  if(busy)return;busy=true;const A=app(),go=$('smartBuildBtn');if(go){go.disabled=true;go.textContent='⏳ Söker körväg…'}
  try{
    if(!A?.state||!A.nearestPointOnRoute)throw new Error('Omläggningsmotorn är inte ansluten ännu. Ladda om sidan en gång.');
    if(!['tur','retur'].some(k=>A.state.dirs?.[k]?.ordinary?.length>1))throw new Error('Hämta busslinjen först.');
    status('Känner av start och återanslutning på den laddade linjen…','busy');
    const [from,to]=await Promise.all([fieldPlace('smartFrom'),fieldPlace('smartTo')]);
    const best=bestDirection(from.coord,to.coord);if(!best)throw new Error('Jag hittar inte dessa två platser i rätt ordning på den laddade linjen. Välj en Västtrafik-träff i listan.');
    if(A.state.direction!==best.name)A.setDirection(best.name);
    const d=A.state.dirs[best.name],start=best.a.coord,end=best.b.coord;
    const ia=nearestIdx(d.ordinary,start,A),ib=nearestIdx(d.ordinary,end,A);
    const points=[start,...viaPoints.map(x=>x.coord),end];
    status('Bygger busskörväg'+(viaPoints.length?' via '+viaPoints.map(x=>x.name).join(' → '):'')+'…','busy');
    let res;try{res=await routeVia(points,A)}catch(e){if(points.length>2)res=await routeSegmented(points,A);else throw e}
    if(!res?.coords?.length||res.coords.length<2)throw new Error('Ingen körbar bussväg hittades.');
    const withdrawn=withdrawStops(d,best.a.distance,best.b.distance,start,end,A);
    d.cutDistance=null;d.affected=[ia,ib];d._affDone=true;d.detour=res.coords.map(c=>[+c[0],+c[1]]);d.roadLockedRoute=[];d.freeActive=false;d.navEvents=res.events||[];d.roadMeta=res.roadMeta||[];d.routeSource=`Smart omläggning · ${from.name} → ${to.name}`;
    A.state.driveRoute=A.buildDriveRoute(d);A.state.busProgress=0;
    A.renderAll();A.renderStopManager?.();A.fitCoords?.(d.detour,90);
    status(`✓ OMLÄGGNING AKTIV · ${from.name} → ${to.name} · ${withdrawn} hållplats${withdrawn===1?'':'er'} indragen${withdrawn===1?'':'a'}.`,'ok');
    say('Omläggningen är aktiv. Bussen använder den nya körvägen.',5200);
  }catch(e){console.error(e);status(e?.message||String(e),'err');say(e?.message||String(e),6200)}finally{busy=false;if(go){go.disabled=false;go.textContent='⚡ BYGG OMLÄGGNING'}}
}
async function fillX2(){
  status('Förbereder X2-exemplet…','busy');picked.smartFrom=null;picked.smartTo=null;viaPoints=[];
  $('smartFrom').value='Linnéplatsen';$('smartTo').value='Hjalmar Brantingsplatsen';
  for(const q of ['Övre Husargatan','Nya Allén','Parkgatan','Polhemsplatsen','Hisingsbron']){try{viaPoints.push(await resolveText(q))}catch(e){console.warn(q,e)}}
  renderViaChips();status('X2-via är ifyllt. Kontrollera träffarna och tryck BYGG OMLÄGGNING.');
}
function togglePanel(force){const p=$('smartPlacePanel');if(!p)return;const show=force??p.classList.contains('hidden');p.classList.toggle('hidden',!show);if(show)setTimeout(()=>$('smartFrom')?.focus(),40)}
function installStyle(){if($('smartPlaceStyle'))return;const s=document.createElement('style');s.id='smartPlaceStyle';s.textContent=`
#smartPlacePanel{grid-column:1/-1;border:1px solid #a9c7ef;background:#f8fbff;border-radius:12px;padding:9px;margin:7px 0;position:relative}.spTitle{font-weight:900;font-size:12px;color:#0b57b8;margin-bottom:7px}.spField{position:relative;margin-bottom:7px}.spField label{display:block;font-size:10px;font-weight:900;color:#475467;margin-bottom:3px}.spField input{width:100%;border:1px solid #cfd8e6;border-radius:8px;padding:8px;background:#fff}.spSuggest{position:absolute;left:0;right:0;top:52px;z-index:999;background:#fff;border:1px solid #cbd5e1;border-radius:9px;box-shadow:0 12px 26px #0002;max-height:230px;overflow:auto}.spSuggest.hidden,#smartPlacePanel.hidden{display:none!important}.spHit{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #eef2f6;background:#fff;padding:7px;cursor:pointer}.spHit:hover{background:#f1f7ff}.spHit b{display:block;font-size:11px}.spHit b span{font-size:8px;margin-left:5px;background:#eaf2ff;color:#0b57b8;border-radius:9px;padding:2px 4px}.spHit small{display:block;color:#667085;font-size:9px;margin-top:2px}.spEmpty,.spMuted{font-size:9px;color:#667085;padding:7px}.spViaRow{display:grid;grid-template-columns:1fr auto;gap:5px}.spChips{display:flex;gap:4px;flex-wrap:wrap;margin:4px 0 8px}.spChip{background:#fff4e5;border:1px solid #f5c77a;border-radius:999px;padding:4px 7px;font-size:9px;font-weight:800}.spChip button{border:0;background:transparent;font-weight:900;cursor:pointer}.spActions{display:grid;grid-template-columns:1fr 1fr;gap:5px}.smartPlaceStatus{font-size:9px;line-height:1.35;margin-top:7px;color:#475467}.smartPlaceStatus.busy{color:#0b57b8}.smartPlaceStatus.err{color:#b42318;font-weight:800}.smartPlaceStatus.ok{color:#067647;font-weight:800}`;document.head.appendChild(s)}
function install(){
  installStyle();const host=$('setOrdinaryBtn')?.parentNode||$('leftSecRoute')?.querySelector('.sectionBody');if(!host)return false;
  let btn=$('linneNilsPresetBtn');if(!btn){btn=document.createElement('button');btn.id='linneNilsPresetBtn';btn.className='btn green wide';btn.style.cssText='min-height:44px;font-weight:900';const o=$('setOrdinaryBtn');o?.nextSibling?host.insertBefore(btn,o.nextSibling):host.appendChild(btn)}
  btn.textContent='🧭 SMART OMLÄGGNING – sök hållplats/gata';btn.type='button';
  if(!$('smartPlacePanel')){
    const p=document.createElement('div');p.id='smartPlacePanel';p.className='hidden';p.innerHTML=`<div class="spTitle">🧭 Smart omläggningsnavigator</div>
      <div class="spField"><label>Från – börja skriva, t.ex. Linnéplatsen</label><input id="smartFrom" autocomplete="off" placeholder="Linnéplatsen"><div id="smartFromSuggestions" class="spSuggest hidden"></div></div>
      <div class="spField"><label>Via – sök gata/hållplats och välj träff</label><div class="spViaRow"><input id="smartVia" autocomplete="off" placeholder="Övre Husargatan"><button id="smartViaAdd" type="button" class="btn small">+ Lägg till</button></div><div id="smartViaSuggestions" class="spSuggest hidden"></div></div>
      <div id="smartViaChips" class="spChips"></div>
      <div class="spField"><label>Till – där bussen återgår till ordinarie linje</label><input id="smartTo" autocomplete="off" placeholder="Hjalmar Brantingsplatsen"><div id="smartToSuggestions" class="spSuggest hidden"></div></div>
      <div class="spActions"><button id="smartX2Example" type="button" class="btn">X2 snabbval</button><button id="smartBuildBtn" type="button" class="btn primary">⚡ BYGG OMLÄGGNING</button></div>
      <div id="smartPlaceStatus" class="smartPlaceStatus">Skriv en plats. Träffar från den laddade Västtrafiklinjen visas först, sedan kartträffar.</div>`;
    host.insertBefore(p,btn.nextSibling);bindSuggest('smartFrom');bindSuggest('smartVia');bindSuggest('smartTo');
    $('smartViaAdd').onclick=()=>resolveViaText($('smartVia').value.trim()).catch(e=>status(e.message,'err'));
    $('smartBuildBtn').onclick=buildDetour;$('smartX2Example').onclick=fillX2;renderViaChips();
  }
  return true;
}

// Capture gör att den gröna knappen alltid öppnar navigatorn även om en äldre modul hunnit sätta onclick.
document.addEventListener('click',e=>{const b=e.target?.closest?.('#linneNilsPresetBtn');if(!b)return;e.preventDefault();e.stopImmediatePropagation();install();togglePanel();},true);
document.addEventListener('click',e=>{if(!e.target?.closest?.('#smartPlacePanel,#linneNilsPresetBtn'))hideLists()},false);

let tries=0;const t=setInterval(()=>{tries++;if(install()||tries>200)clearInterval(t)},120);
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,50));else setTimeout(install,50);
})();
