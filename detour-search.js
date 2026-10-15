(()=>{
'use strict';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $id=id=>document.getElementById(id);
const km=m=>(m/1000).toFixed(m>=10000?1:2).replace('.',',')+' km';
let suggestions=[];
let selected=0;
let searchBusy=false;

function css(){
  if($id('autoDetourCss'))return;
  const s=document.createElement('style');s.id='autoDetourCss';s.textContent=`
  .autoDetourBox{grid-column:1/-1;border:1px solid #bfd1e8;background:#f7fbff;border-radius:11px;padding:9px;margin:2px 0 5px}
  .autoDetourHead{display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:7px}.autoDetourHead b{font-size:12px}.autoDetourHead span{font-size:9px;font-weight:900;color:#1267d6;background:#e8f2ff;padding:4px 6px;border-radius:999px}
  .autoDetourFields{display:grid;grid-template-columns:1fr;gap:6px}.autoDetourField label{display:block;font-size:10px;font-weight:900;color:#475467;margin-bottom:3px}.autoDetourField input{width:100%;border:1px solid #cfd8e6;border-radius:8px;padding:8px;background:#fff;font-size:11px}
  .autoDetourActions{display:grid;grid-template-columns:1fr auto;gap:6px;margin-top:7px}.autoDetourActions button{min-width:0}
  .autoDetourHint{font-size:9px;line-height:1.35;color:#667085;margin-top:6px}
  .autoDetourResults{display:grid;gap:5px;margin-top:8px}.autoDetourResult{border:1px solid #d7e1ed;background:#fff;border-radius:9px;padding:7px;cursor:pointer}.autoDetourResult:hover{border-color:#8bb6ee}.autoDetourResult.active{border-color:#1267d6;box-shadow:0 0 0 2px #1267d61f;background:#f5f9ff}
  .autoDetourResultTop{display:flex;justify-content:space-between;gap:6px;align-items:center}.autoDetourResultTop b{font-size:11px}.autoDetourResultTop span{font-size:10px;font-weight:900;color:#0b57b8}.autoDetourMeta{font-size:9px;color:#667085;margin-top:3px}.autoDetourBtns{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:7px}.autoDetourStatus{font-size:10px;color:#475467;margin-top:6px}.autoDetourStatus.busy{color:#0b57b8;font-weight:800}.autoDetourStatus.err{color:#b42318;font-weight:800}
  `;document.head.appendChild(s);
}

function install(){
  css();
  const routeSec=$id('leftSecRoute')?.querySelector('.sectionBody');
  const anchor=$id('detourWorkflowState');
  if(!routeSec||!anchor||$id('autoDetourBox'))return;
  const box=document.createElement('div');box.id='autoDetourBox';box.className='autoDetourBox';box.innerHTML=`
    <div class="autoDetourHead"><b>🔎 Hitta omläggning automatiskt</b><span>5 FÖRSLAG</span></div>
    <div class="autoDetourFields">
      <div class="autoDetourField"><label>Omläggning från</label><input id="autoDetourFrom" list="autoDetourStops" autocomplete="off" placeholder="t.ex. Marklandsgatan, hållplats eller gata"></div>
      <div class="autoDetourField"><label>Omläggning till</label><input id="autoDetourTo" list="autoDetourStops" autocomplete="off" placeholder="t.ex. Kungssten, hållplats eller gata"></div>
    </div>
    <datalist id="autoDetourStops"></datalist>
    <div class="autoDetourActions"><button id="autoDetourSearch" class="btn primary small">🚌 Hitta 5 alternativa körvägar</button><button id="autoDetourSwap" class="btn small" title="Byt från/till">⇅</button></div>
    <div class="autoDetourHint">Skriv var omläggningen börjar och slutar. Systemet kopplar punkterna till rätt <b>Tur/Retur</b>, följer färdriktningen och söker busskörbara alternativ.</div>
    <div id="autoDetourStatus" class="autoDetourStatus">Klar att söka.</div>
    <div id="autoDetourResults" class="autoDetourResults"></div>
    <div id="autoDetourBtns" class="autoDetourBtns hidden"><button id="autoDetourPreview" class="btn small">👁 Visa valt</button><button id="autoDetourApply" class="btn green small">✓ Använd valt</button></div>`;
  routeSec.insertBefore(box,anchor);
  $id('autoDetourSearch').onclick=findAlternatives;
  $id('autoDetourSwap').onclick=()=>{const a=$id('autoDetourFrom'),b=$id('autoDetourTo'),v=a.value;a.value=b.value;b.value=v};
  $id('autoDetourPreview').onclick=()=>previewSuggestion(selected,false);
  $id('autoDetourApply').onclick=()=>previewSuggestion(selected,true);
  refreshStopList();
  setInterval(refreshStopList,4000);
}

function refreshStopList(){
  const dl=$id('autoDetourStops');if(!dl||typeof state==='undefined')return;
  const names=[];for(const dn of ['tur','retur'])for(const st of (state.dirs?.[dn]?.stops||[]))if(st?.name&&!names.includes(st.name))names.push(st.name);
  const html=names.slice(0,180).map(n=>`<option value="${esc(n)}"></option>`).join('');if(dl.innerHTML!==html)dl.innerHTML=html;
}

function norm(s){return String(s||'').toLocaleLowerCase('sv-SE').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9åäö ]/gi,' ').replace(/\s+/g,' ').trim()}
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
  const u='/geo/search?format=json&limit=5&countrycodes=se&addressdetails=1&q='+encodeURIComponent(query+', Västra Götaland');
  const r=await fetch(u,{headers:{Accept:'application/json'}});if(!r.ok)throw new Error('Platssökningen svarade '+r.status);const j=await r.json();
  const x=(j||[]).find(v=>Number.isFinite(+v.lon)&&Number.isFinite(+v.lat));if(!x)throw new Error('Hittade inte platsen “'+query+'”');
  return{coord:[+x.lon,+x.lat],name:x.display_name?.split(',').slice(0,2).join(', ')||query,source:'plats'};
}

function idxAt(route,dist){let cum=0;for(let i=1;i<route.length;i++){const seg=hav(route[i-1],route[i]);if(cum+seg>=dist)return(dist-cum)<seg*.5?i-1:i;cum+=seg}return Math.max(0,route.length-1)}
function chooseDirection(from,to){
  let best=null;
  for(const dn of ['tur','retur']){
    const d=state.dirs?.[dn],route=d?.ordinary;if(!route?.length||route.length<2)continue;
    const a=nearestPointOnRoute(route,from),b=nearestPointOnRoute(route,to);if(!a||!b||b.distance<=a.distance+20)continue;
    const score=a.offset+b.offset+(dn===state.direction?-5:0);
    if(!best||score<best.score)best={direction:dn,d,a,b,score};
  }
  return best;
}
function interp(a,b,t){return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]}
function routeSimilarity(route,ordinarySlice){
  if(!route?.length||!ordinarySlice?.length)return 0;const sample=route.length>80?route.filter((_,i)=>i%Math.ceil(route.length/70)===0):route;let near=0;for(const p of sample){const n=nearestPointOnRoute(ordinarySlice,p);if(n&&n.offset<28)near++}return sample.length?near/sample.length:0;
}
function routeSignature(route){if(!route?.length)return'';const ids=[0,.2,.4,.6,.8,1].map(t=>route[Math.min(route.length-1,Math.round((route.length-1)*t))]).map(c=>c.map(x=>x.toFixed(3)).join(',')).join('|');return ids}

async function buildCandidates(anchor){
  const {d,a,b}=anchor,start=a.coord,end=b.coord,base=routeSliceByDistance(d.ordinary,a.distance,b.distance,8),baseLen=routeLength(base),straightBearing=bearing(start,end);
  const mid=interp(start,end,.5),p35=interp(start,end,.35),p65=interp(start,end,.65);
  const guides=[
    [start,end],
    [start,offsetMeters(mid,straightBearing,180),end],
    [start,offsetMeters(mid,straightBearing,-180),end],
    [start,offsetMeters(p35,straightBearing,320),offsetMeters(p65,straightBearing,320),end],
    [start,offsetMeters(p35,straightBearing,-320),offsetMeters(p65,straightBearing,-320),end],
    [start,offsetMeters(mid,straightBearing,450),end],
    [start,offsetMeters(mid,straightBearing,-450),end],
    [start,offsetMeters(p35,straightBearing,550),offsetMeters(p65,straightBearing,-250),end],
    [start,offsetMeters(p35,straightBearing,-550),offsetMeters(p65,straightBearing,250),end]
  ];
  const out=[],seen=new Set();
  for(let i=0;i<guides.length&&out.length<5;i++){
    try{
      const res=await valhallaBusRoute(guides[i]);if(!res?.coords?.length)continue;
      const sig=routeSignature(res.coords);if(seen.has(sig))continue;seen.add(sig);
      const len=routeLength(res.coords),similarity=routeSimilarity(res.coords,base);
      if(out.length&&similarity>.93&&Math.abs(len-baseLen)<120)continue;
      out.push({coords:res.coords,events:res.events||[],roadMeta:res.roadMeta||[],len,baseLen,similarity,source:res.source||'BUSS-routing'});
    }catch(e){console.warn('Alternativ '+(i+1)+' misslyckades',e)}
  }
  if(!out.length){const res=await smartBusRoute([start,end]);out.push({coords:res.coords,events:res.events||[],roadMeta:res.roadMeta||[],len:routeLength(res.coords),baseLen,similarity:routeSimilarity(res.coords,base),source:res.source||'Bussrouting'})}
  while(out.length<5&&out.length){const src=out[out.length%Math.max(1,out.length)];out.push({...src,duplicate:true})}
  return out.slice(0,5);
}

async function findAlternatives(){
  if(searchBusy)return;const fromQ=$id('autoDetourFrom')?.value.trim(),toQ=$id('autoDetourTo')?.value.trim(),status=$id('autoDetourStatus');
  if(!fromQ||!toQ){status.className='autoDetourStatus err';status.textContent='Fyll i både Från och Till.';return}
  if(!state?.dirs?.tur?.ordinary?.length&&!state?.dirs?.retur?.ordinary?.length){status.className='autoDetourStatus err';status.textContent='Hämta först Västtrafiklinjen som ska läggas om.';return}
  searchBusy=true;suggestions=[];$id('autoDetourResults').innerHTML='';$id('autoDetourBtns').classList.add('hidden');status.className='autoDetourStatus busy';status.textContent='Söker platser och analyserar Tur/Retur…';
  try{
    const [from,to]=await Promise.all([geocodeOne(fromQ),geocodeOne(toQ)]);const anchor=chooseDirection(from.coord,to.coord);if(!anchor)throw new Error('Från/Till ligger inte i rätt ordning på den hämtade linjen. Kontrollera platserna eller byt dem med ⇅.');
    if(anchor.a.offset>650||anchor.b.offset>650)throw new Error('En av platserna ligger för långt från den hämtade linjen. Sök en hållplats eller gata närmare linjen.');
    if(state.direction!==anchor.direction)setDirection(anchor.direction);
    status.textContent='Rätt riktning hittad: '+(anchor.direction==='retur'?'Retur':'Tur')+'. Tar fram fem busskörbara alternativ…';
    const routes=await buildCandidates(anchor);suggestions=routes.map((r,i)=>({...r,index:i,anchor,from,to}));selected=0;renderResults();status.className='autoDetourStatus';status.textContent=`${from.name} → ${to.name} · ${anchor.direction==='retur'?'Retur':'Tur'} · välj ett förslag.`;
  }catch(e){status.className='autoDetourStatus err';status.textContent=e.message||String(e)}finally{searchBusy=false}
}
function renderResults(){
  const el=$id('autoDetourResults');if(!el)return;el.innerHTML=suggestions.map((r,i)=>{const extra=r.len-r.baseLen,sim=Math.round(r.similarity*100),label=i===0?'Direkt alternativ':sim<45?'Tydlig omledning':sim<72?'Alternativ sträcka':'Nära ordinarie';return `<div class="autoDetourResult ${i===selected?'active':''}" data-i="${i}"><div class="autoDetourResultTop"><b>Förslag ${i+1} · ${label}</b><span>${km(r.len)}</span></div><div class="autoDetourMeta">${extra>=0?'+':''}${Math.round(extra)} m mot ordinarie sträcka · ${sim}% nära ordinarie linje${r.duplicate?' · reservvariant':''}</div></div>`}).join('');
  el.querySelectorAll('.autoDetourResult').forEach(x=>x.onclick=()=>{selected=+x.dataset.i;renderResults()});$id('autoDetourBtns').classList.toggle('hidden',!suggestions.length);
}
function previewSuggestion(i,apply){
  const s=suggestions[i];if(!s)return;const {anchor}=s;if(state.direction!==anchor.direction)setDirection(anchor.direction);const d=dir();
  d.cutDistance=null;d.affected=[idxAt(d.ordinary,anchor.a.distance),idxAt(d.ordinary,anchor.b.distance)];d._affDone=true;d.detour=s.coords;d.roadLockedRoute=[];d.navEvents=s.events||[];d.roadMeta=s.roadMeta||d.roadMeta||[];d.routeSource=`Auto-omläggning · Förslag ${i+1}`;d.freeActive=false;state.driveRoute=null;
  fitCoords(buildSimRoute(d),70);renderAll();
  if(apply){enrichDirRoadMeta(d,buildSimRoute(d)).catch(()=>{});toast(`Förslag ${i+1} används som omläggning (${anchor.direction==='retur'?'Retur':'Tur'}).`,4200)}else toast(`Förhandsvisar Förslag ${i+1}. Tryck “Använd valt” när du är nöjd.`,3500);
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,0));else setTimeout(install,0);
})();