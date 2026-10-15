(()=>{
'use strict';
/* GMP_STOP_DETOUR_MANAGER_V1
   - Ordinarie hållplatslägen är grundläge.
   - Hållplatser inne i röd/indragen sträcka dras in, förutom gränshållplatser.
   - Söker officiella GTFS-hållplatslägen nära den valda omläggningen.
   - När ett alternativt hållplatsläge väljs räknas själva bussrutten om via läget.
   - Röd/indragen ordinarie sträcka behandlas som förbjuden vid omräkning.
*/
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selectedStops=new Map();
let currentAffected=[];
let busy=false;
let lastSignature='';

function A(){return window.GMP_APP||null}
function keyForStop(st,i){return String(st?.id||st?.code||((st?.name||'stopp')+'#'+i))}
function dist(a,b){return A()?.hav?.(a,b)??Infinity}
function nearRoute(route,p){return A()?.nearestPointOnRoute?.(route,p)||null}
function ordinaryAffectedInfo(d){
  if(!d?.ordinary?.length||!d?.affected||d.affected.length<2)return null;
  let [ia,ib]=d.affected.map(Number);if(ia>ib)[ia,ib]=[ib,ia];
  ia=Math.max(0,Math.min(d.ordinary.length-1,ia));ib=Math.max(0,Math.min(d.ordinary.length-1,ib));
  const start=d.ordinary[ia],end=d.ordinary[ib],blocked=d.ordinary.slice(ia,ib+1);
  const a=A().nearestPointOnRoute(d.ordinary,start),b=A().nearestPointOnRoute(d.ordinary,end);
  return{ia,ib,start,end,blocked,aDist:a?.distance||0,bDist:b?.distance||A().routeLength(d.ordinary)};
}
function saveAndWithdraw(st){
  if(!st._gmpStopSaved){st._gmpStopSaved=true;st._gmpPrevServe=st.serve;st._gmpPrevClosed=st.closed}
  st.serve=false;st.closed=true;st._gmpWithdrawnByDetour=true;
}
function restoreStop(st){
  if(!st?._gmpStopSaved)return;
  st.serve=st._gmpPrevServe;st.closed=st._gmpPrevClosed;
  delete st._gmpStopSaved;delete st._gmpPrevServe;delete st._gmpPrevClosed;delete st._gmpWithdrawnByDetour;
}
function clearAlternativeStops(d){d.stops=(d.stops||[]).filter(st=>!st?._gmpAlternativeStop)}
function restoreAll(){
  const app=A();if(!app)return;const d=app.dir();
  for(const st of d.stops||[])restoreStop(st);
  clearAlternativeStops(d);selectedStops.clear();currentAffected=[];lastSignature='';app.state.driveRoute=null;app.renderStopManager?.();app.renderAll?.();renderEmpty('Ordinarie hållplatslägen återställda.');
}
function blockedOverlap(route,blocked,start,end){
  if(!route?.length||!blocked?.length)return 0;let hit=0,total=0;const step=Math.max(1,Math.ceil(route.length/120));
  for(let i=0;i<route.length;i+=step){const p=route[i];if(dist(p,start)<95||dist(p,end)<95)continue;total++;const n=nearRoute(blocked,p);if(n&&n.offset<30)hit++}
  return total?hit/total:0;
}
function riskyRoadShare(meta=[]){
  if(!meta.length)return 0;let bad=0,total=0;
  for(const m of meta){const h=String(m?.highway||m?.roadClass||m?.tags?.highway||'').toLowerCase();if(!h)continue;total++;const tags=m?.tags||{};const bus=String(tags.bus||m.bus||'').toLowerCase(),psv=String(tags.psv||m.psv||'').toLowerCase(),prio=!!m.busPriority||/yes|designated|permissive/.test(bus+' '+psv);if(/service|living_street|track|path|footway|pedestrian|cycleway/.test(h)&&!prio)bad++}
  return total?bad/total:0;
}
async function officialStopIndex(){
  const app=A();if(!app?.buildGtfsStopIndex)return[];
  try{return await app.buildGtfsStopIndex()}catch{return[]}
}
function affectedOrdinaryStops(d,info){
  const arr=[];for(let i=0;i<(d.stops||[]).length;i++){
    const st=d.stops[i];if(!st?.coord||st._gmpAlternativeStop)continue;
    const n=nearRoute(d.ordinary,st.coord);if(!n||n.offset>90)continue;
    if(n.distance<info.aDist-25||n.distance>info.bDist+25)continue;
    const boundary=dist(st.coord,info.start)<85||dist(st.coord,info.end)<85;
    if(boundary)continue;
    arr.push({key:keyForStop(st,i),st,ordinaryDistance:n.distance});
  }
  return arr;
}
function bestAlternatives(original,idx,detour){
  const sameName=String(original.name||'').toLocaleLowerCase('sv-SE');
  const out=[];
  for(const st of idx){
    if(!st?.coord)continue;const on=nearRoute(detour,st.coord);if(!on||on.offset>55)continue;
    const direct=dist(original.coord,st.coord);if(direct>900)continue;
    const same=(String(st.name||'').toLocaleLowerCase('sv-SE')===sameName)?-450:0;
    const nameNear=(sameName&&String(st.name||'').toLocaleLowerCase('sv-SE').includes(sameName.split(' ')[0]))?-90:0;
    const score=direct+on.offset*5+same+nameNear;
    out.push({st,on,direct,score});
  }
  const seen=new Set(),uniq=[];for(const x of out.sort((a,b)=>a.score-b.score)){
    const k=String(x.st.id||x.st.code||x.st.name)+'@'+x.st.coord.map(v=>(+v).toFixed(5)).join(',');if(seen.has(k))continue;seen.add(k);uniq.push(x);if(uniq.length>=6)break;
  }
  return uniq;
}
function ensureUI(){
  const host=$('autoDetourBox');if(!host||$('altStopBox'))return;
  const box=document.createElement('div');box.id='altStopBox';box.style.cssText='margin-top:9px;border-top:1px solid #cfd8e6;padding-top:8px';box.innerHTML=`
    <div style="display:flex;gap:6px;align-items:center;justify-content:space-between"><b style="font-size:11px">🚏 Hållplatser på omläggningen</b><button id="altStopScan" class="btn small">Sök hållplatslägen</button></div>
    <div id="altStopStatus" style="font-size:9px;color:#667085;margin-top:5px">När en omläggning används kontrolleras ordinarie hållplatser automatiskt.</div>
    <div id="altStopList" style="display:grid;gap:6px;margin-top:7px"></div>
    <button id="altStopRestore" class="btn small wide" style="margin-top:7px">↶ Återställ ordinarie hållplatslägen</button>`;
  host.appendChild(box);$('altStopScan').onclick=()=>scanStops(true);$('altStopRestore').onclick=restoreAll;
}
function renderEmpty(msg){ensureUI();if($('altStopStatus'))$('altStopStatus').textContent=msg;if($('altStopList'))$('altStopList').innerHTML=''}
function renderRows(rows){
  ensureUI();const list=$('altStopList');if(!list)return;
  if(!rows.length){list.innerHTML='<div style="font-size:9px;color:#067647;background:#ecfdf3;padding:7px;border-radius:8px">✓ Inga mellanliggande ordinarie hållplatser behöver flyttas.</div>';return}
  list.innerHTML=rows.map(r=>{
    const chosen=selectedStops.get(r.key);const opts=r.options.length?r.options.map((x,j)=>`<button class="btn small altStopChoice" data-key="${esc(r.key)}" data-j="${j}" style="text-align:left;white-space:normal;${chosen&&String(chosen.st.id||chosen.st.code||chosen.st.name)===String(x.st.id||x.st.code||x.st.name)?'border-color:#16a34a;background:#ecfdf3':''}">🚏 ${esc(x.st.name||'Hållplats')}${x.st.code?' · '+esc(x.st.code):''}<br><small>${Math.round(x.on.offset)} m från ny körväg · ${Math.round(x.direct)} m från ordinarie läge</small></button>`).join(''):'<div style="font-size:9px;color:#b42318">Inget officiellt alternativ nära den nya körvägen.</div>';
    return`<div style="border:1px solid #d7e1ed;background:#fff;border-radius:9px;padding:7px"><b style="font-size:10px;color:#b42318">⛔ ${esc(r.st.name||'Ordinarie hållplats')} dras in</b><div style="font-size:9px;color:#667085;margin:3px 0 6px">Välj ett nytt hållplatsläge. När du väljer ett läge räknas bussrutten om via hållplatsen.</div><div style="display:grid;gap:4px">${opts}</div></div>`;
  }).join('');
  list.querySelectorAll('.altStopChoice').forEach(btn=>btn.onclick=async()=>{const row=rows.find(r=>r.key===btn.dataset.key),opt=row?.options?.[+btn.dataset.j];if(!row||!opt)return;selectedStops.set(row.key,opt);await rerouteThroughSelected(rows)});
}
async function rerouteThroughSelected(rows=currentAffected){
  if(busy)return;const app=A(),d=app?.dir(),info=ordinaryAffectedInfo(d);if(!app||!d||!info||!d.detour?.length)return;
  const status=$('altStopStatus');busy=true;try{
    status.textContent='Räknar om bussrutten via valda hållplatslägen…';
    const ordered=[];for(const r of rows){const x=selectedStops.get(r.key);if(!x)continue;const n=nearRoute(d.detour,x.st.coord);ordered.push({r,x,order:n?.distance??r.ordinaryDistance})}ordered.sort((a,b)=>a.order-b.order);
    const pts=[info.start,...ordered.map(o=>o.x.st.coord),info.end];
    const res=await app.valhallaBusRoute(pts);if(!res?.coords?.length)throw new Error('Ingen körbar bussrutt hittades via hållplatsläget.');
    for(const o of ordered){const n=nearRoute(res.coords,o.x.st.coord);if(!n||n.offset>45)throw new Error('Rutten når inte '+(o.x.st.name||'valt hållplatsläge')+' på ett säkert sätt.');}
    const overlap=blockedOverlap(res.coords,info.blocked,info.start,info.end);if(overlap>.10)throw new Error('Den nya rutten försöker gå tillbaka genom röd/indragen sträcka. Välj ett annat hållplatsläge eller en annan omläggning.');
    const risk=riskyRoadShare(res.roadMeta||[]);if(risk>.16)throw new Error('Rutten använder för stor andel smågata/serviceväg utan tydlig bussbehörighet. Välj ett annat alternativ.');
    d.detour=res.coords.map(c=>[+c[0],+c[1]]);d.navEvents=res.events||[];d.roadMeta=res.roadMeta||[];d.routeSource='Omläggning + valda alternativa hållplatslägen';d.freeActive=false;app.state.driveRoute=null;
    clearAlternativeStops(d);
    for(const o of ordered){const s=o.x.st;d.stops.push({id:'ALT-'+String(s.id||s.code||Date.now()),name:s.name||'Alternativ hållplats',coord:[+s.coord[0],+s.coord[1]],serve:true,closed:false,dwell:3,code:s.code||'',_gmpAlternativeStop:true,_replaces:o.r.st.name||''})}
    app.renderStopManager?.();app.renderAll?.();app.fitCoords?.(d.detour,70);status.textContent='✓ Körvägen är omräknad genom '+ordered.length+' valt/valda hållplatsläge(n). Röd sträcka undviks.';
    try{app.toast?.('Körvägen ändrades så att bussen faktiskt stannar vid valt hållplatsläge.',4200)}catch{}
    await scanStops(false);
  }catch(e){status.textContent='⚠ '+(e?.message||String(e));try{app.toast?.(e?.message||String(e),6500)}catch{}}finally{busy=false}
}
async function scanStops(showToast=false){
  const app=A();ensureUI();if(!app){renderEmpty('Kartmotorn är inte klar ännu.');return}
  const d=app.dir(),info=ordinaryAffectedInfo(d);if(!info||!d.detour?.length||d.detour.length<2){renderEmpty('Välj och använd först en omläggning.');return}
  const sig=[d.detour.length,info.ia,info.ib,d.detour[0]?.join(','),d.detour.at(-1)?.join(',')].join('|');
  const affected=affectedOrdinaryStops(d,info);for(const x of affected)saveAndWithdraw(x.st);
  const idx=await officialStopIndex();
  currentAffected=affected.map(x=>({...x,options:bestAlternatives(x.st,idx,d.detour)}));lastSignature=sig;
  app.state.driveRoute=null;app.renderStopManager?.();app.renderAll?.();
  const nAlt=currentAffected.reduce((s,r)=>s+r.options.length,0);$('altStopStatus').textContent=affected.length?`${affected.length} ordinarie hållplats(er) ligger i indragen sträcka · ${nAlt} alternativa officiella lägen hittade nära nya körvägen.`:'Alla ordinarie hållplatser som ska trafikeras ligger utanför den indragna sträckan.';renderRows(currentAffected);
  if(showToast)try{app.toast?.('Hållplatslägen kontrollerade mot den nya körvägen.',3200)}catch{}
}
function hookApplyButton(){
  const b=$('autoDetourApply');if(!b||b.dataset.stopHook==='1')return;b.dataset.stopHook='1';b.addEventListener('click',()=>setTimeout(()=>scanStops(false),350));
}
function watch(){
  ensureUI();hookApplyButton();const app=A(),d=app?.dir?.();if(!d?.detour?.length)return;const info=ordinaryAffectedInfo(d);if(!info)return;const sig=[d.detour.length,info.ia,info.ib,d.detour[0]?.join(','),d.detour.at(-1)?.join(',')].join('|');if(sig!==lastSignature)setTimeout(()=>scanStops(false),120);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{setInterval(watch,900);setTimeout(watch,250)});else{setInterval(watch,900);setTimeout(watch,250)}
})();
