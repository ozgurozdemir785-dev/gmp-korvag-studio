(()=>{
'use strict';
/* DRAW_DETOUR_ENHANCER_V2
   One-stroke manual detour editor. Uses GMP_APP and keeps the ordinary route as base.
   V2 fixes ambiguous rejoin points at terminals/loops: the drawn stroke direction is used
   to choose the correct branch of the ordinary route, and stale red segments are replaced
   when the new stroke clearly starts/ends somewhere else. */
const $=id=>document.getElementById(id);
const A=()=>window.GMP_APP||null;
let active=false,drawing=false,raw=[],preview=null,panel=null;

function say(msg,ms=4200){try{A()?.toast?.(msg,ms)}catch{} }
function normPoint(p){return[+p[0],+p[1]]}
function ll2world([lng,lat],z){const s=256*Math.pow(2,z),x=(lng+180)/360*s,cl=Math.max(-85.05112878,Math.min(85.05112878,lat)),sn=Math.sin(cl*Math.PI/180),y=(.5-Math.log((1+sn)/(1-sn))/(4*Math.PI))*s;return[x,y]}
function world2ll([x,y],z){const s=256*Math.pow(2,z),lng=x/s*360-180,n=Math.PI-2*Math.PI*y/s,lat=180/Math.PI*Math.atan(.5*(Math.exp(n)-Math.exp(-n)));return[lng,lat]}
function clientToLL(e){const app=A(),vp=$('mapViewport'),r=vp.getBoundingClientRect(),z=app.state.zoom,cw=ll2world(app.state.center,z),x=cw[0]+(e.clientX-r.left)-r.width/2,y=cw[1]+(e.clientY-r.top)-r.height/2;return world2ll([x,y],z)}
function nearestVertex(route,p){const app=A();let bi=0,bd=Infinity;for(let i=0;i<(route||[]).length;i++){const d=app.hav(route[i],p);if(d<bd){bd=d;bi=i}}return{index:bi,gap:bd}}
function affectedBounds(d){if(!(d?.affected&&d._affDone))return null;let[a,b]=d.affected;if(a>b)[a,b]=[b,a];return{a,b,start:d.ordinary[a],end:d.ordinary[b]}}
function ensurePreview(){if(preview?.isConnected)return preview;preview=document.createElementNS('http://www.w3.org/2000/svg','svg');preview.id='gmpDrawDetourPreview';preview.style.cssText='position:absolute;inset:0;z-index:64;pointer-events:none;overflow:visible';$('mapViewport')?.appendChild(preview);return preview}
function previewDraw(){const svg=ensurePreview();svg.innerHTML='';if(raw.length<2)return;const vp=$('mapViewport'),r=vp.getBoundingClientRect(),app=A(),z=app.state.zoom,cw=ll2world(app.state.center,z);const pts=raw.map(c=>{const w=ll2world(c,z);return[w[0]-cw[0]+r.width/2,w[1]-cw[1]+r.height/2]});const d=pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ');for(const [stroke,width] of [['#fff',9],['#f79009',5]]){const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',d);p.setAttribute('fill','none');p.setAttribute('stroke',stroke);p.setAttribute('stroke-width',width);p.setAttribute('stroke-linecap','round');p.setAttribute('stroke-linejoin','round');if(stroke!=='#fff')p.setAttribute('stroke-dasharray','10 6');svg.appendChild(p)}}
function clearPreview(){raw=[];if(preview)preview.innerHTML=''}
function sampleStroke(coords,max=10){if(coords.length<=max)return coords.map(normPoint);const out=[coords[0]];for(let i=1;i<max-1;i++){const idx=Math.round(i*(coords.length-1)/(max-1));out.push(coords[idx])}out.push(coords.at(-1));return out.map(normPoint)}
function forbiddenShare(route,d){const app=A(),b=affectedBounds(d);if(!b||!route?.length)return{ratio:0,hits:0};const forbidden=d.ordinary.slice(b.a,b.b+1);if(forbidden.length<2)return{ratio:0,hits:0};let hits=0,tested=0;for(let i=2;i<route.length-2;i+=Math.max(1,Math.floor(route.length/90))){tested++;const n=app.nearestPointOnRoute(forbidden,route[i]);if(n&&n.offset<24)hits++}return{ratio:hits/Math.max(1,tested),hits}}
async function routeVia(points){const app=A();let last;
  try{return await app.smartBusRoute(points,{allowOfficial:false})}catch(e){last=e}
  try{return await app.valhallaBusRoute(points)}catch(e){last=e}
  const coords=[],events=[],roadMeta=[];
  try{for(let i=0;i<points.length-1;i++){const r=await app.valhallaBusRoute([points[i],points[i+1]]);if(!r?.coords?.length)throw new Error('Delsträcka saknas');if(coords.length&&app.hav(coords.at(-1),r.coords[0])<10)coords.push(...r.coords.slice(1));else coords.push(...r.coords);if(Array.isArray(r.events))events.push(...r.events);if(Array.isArray(r.roadMeta))roadMeta.push(...r.roadMeta)}return{coords,events,roadMeta,source:'Ritad bussomläggning'}}catch(e){throw last||e}}

function bearing(a,b){const r=Math.PI/180,p1=a[1]*r,p2=b[1]*r,dl=(b[0]-a[0])*r,y=Math.sin(dl)*Math.cos(p2),x=Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl);return(Math.atan2(y,x)/r+360)%360}
function angleDiff(a,b){let d=Math.abs((a-b)%360);return d>180?360-d:d}
function routeHeading(route,i){const a=route[Math.max(0,i-3)],b=route[Math.min(route.length-1,i+3)];return a&&b?bearing(a,b):0}
function strokeHeading(coords,atEnd=false){if(coords.length<2)return 0;const span=Math.min(7,coords.length-1);return atEnd?bearing(coords[Math.max(0,coords.length-1-span)],coords.at(-1)):bearing(coords[0],coords[Math.min(coords.length-1,span)])}
function candidateVertices(route,p,maxGap=155,limit=26){const app=A(),arr=[];for(let i=0;i<route.length;i++){const gap=app.hav(route[i],p);if(gap<=maxGap)arr.push({index:i,gap,coord:route[i]})}arr.sort((a,b)=>a.gap-b.gap);return arr.slice(0,limit)}
function routeDistanceBetween(route,a,b){const app=A();let m=0;for(let i=a+1;i<=b;i++)m+=app.hav(route[i-1],route[i]);return m}
function strokeLength(coords){const app=A();let m=0;for(let i=1;i<coords.length;i++)m+=app.hav(coords[i-1],coords[i]);return m}
function nearestStopBonus(d,p,index){const app=A();let bonus=0;for(const st of (d?.stops||[])){if(!st?.coord||st.serve===false||st.closed===true)continue;const g=app.hav(st.coord,p);if(g>75)continue;const rg=app.hav(st.coord,d.ordinary[index]);if(rg<85)bonus=Math.max(bonus,Math.max(0,42-g*.35-rg*.12))}return bonus}
function inferAffectedSmart(d,coords){const app=A(),route=d.ordinary,first=coords[0],last=coords.at(-1),sc=candidateVertices(route,first),ec=candidateVertices(route,last);if(!sc.length||!ec.length)throw new Error('Börja och avsluta ritningen nära den ordinarie linjen.');const sh0=strokeHeading(coords,false),sh1=strokeHeading(coords,true),drawLen=Math.max(50,strokeLength(coords));let best=null;
  for(const a of sc)for(const b of ec){if(b.index<=a.index+1)continue;const routeLen=routeDistanceBetween(route,a.index,b.index);const ratio=Math.max(routeLen,drawLen)/Math.max(40,Math.min(routeLen,drawLen));const headingPenalty=angleDiff(routeHeading(route,a.index),sh0)*.48+angleDiff(routeHeading(route,b.index),sh1)*.68;const lengthPenalty=Math.max(0,ratio-1.35)*22;const terminalBonus=nearestStopBonus(d,last,b.index)+nearestStopBonus(d,first,a.index)*.45;const score=a.gap+b.gap+headingPenalty+lengthPenalty-terminalBonus;if(!best||score<best.score)best={a,b,score}}
  if(!best)throw new Error('Jag hittar inte en tydlig start och återanslutning i rätt färdriktning. Rita från linjen och tillbaka längre fram på samma tur.');
  d.affected=[best.a.index,best.b.index];d._affDone=true;d.cutDistance=null;return{start:route[best.a.index],end:route[best.b.index],a:best.a.index,b:best.b.index};
}
function strokeMatchesExisting(existing,coords){const app=A();if(!existing||coords.length<2)return false;const f=coords[0],l=coords.at(-1);const direct=app.hav(f,existing.start)+app.hav(l,existing.end),cross=app.hav(f,existing.end)+app.hav(l,existing.start);return Math.min(direct,cross)<135}

async function finishStroke(){const app=A(),d=app?.dir?.();if(!app||!d||d.ordinary?.length<2)return say('Hämta busslinjen först.');if(raw.length<3)return say('Rita en tydligare sträcka genom att hålla musknappen nere och dra.');
  let anchors=affectedBounds(d);
  if(!strokeMatchesExisting(anchors,raw)){
    const inferred=inferAffectedSmart(d,raw);anchors={start:inferred.start,end:inferred.end,a:inferred.a,b:inferred.b};
    panelStatus('Start och återanslutning anpassades efter din ritning – terminal/loop kontrollerad.','busy');
  }
  const guide=sampleStroke(raw,10);guide[0]=normPoint(anchors.start);guide[guide.length-1]=normPoint(anchors.end);
  panelStatus('Låser din ritning till körbara bussvägar…','busy');
  try{
    const r=await routeVia(guide);if(!r?.coords?.length||r.coords.length<2)throw new Error('Ingen körbar bussväg hittades.');
    const share=forbiddenShare(r.coords,d);if(share.ratio>.18&&share.hits>=3)throw new Error('Den beräknade vägen går tillbaka in på den röda/indragna sträckan. Rita tydligare via den alternativa gatan.');
    d.detour=r.coords.map(normPoint);d.freeActive=false;d.roadLockedRoute=[];d.navEvents=r.events||[];d.roadMeta=r.roadMeta||[];d.routeSource='Ritad omläggning · väglåst';app.state.driveRoute=app.buildDriveRoute(d);app.state.busProgress=0;app.renderAll();app.renderStopManager?.();app.fitCoords?.(d.detour,90);panelStatus('✓ Omläggningen är aktiv. Bara sträckan mellan ritningens riktiga start och återanslutning är röd.','ok');say('Ritad omläggning klar – återanslutningen är låst till rätt gren av linjen.',5200);stopMode(false);
  }catch(e){console.error(e);panelStatus(e?.message||String(e),'err');say(e?.message||String(e),6500)}finally{clearPreview()}
}
function panelStatus(text,kind=''){const el=$('drawDetourStatus');if(!el)return;el.className='drawDetourStatus '+kind;el.textContent=text}
function startMode(){const app=A(),d=app?.dir?.();if(!app||!d?.ordinary?.length)return say('Hämta en Västtrafiklinje först.');active=true;clearPreview();$('mapViewport')?.classList.add('drawMode');$('drawDetourPanel')?.classList.remove('hidden');const b=affectedBounds(d);panelStatus(b?'Rita den väg bussen verkligen ska köra. Om din ritning börjar/slutar på andra ställen än den röda markeringen flyttas den röda sträckan automatiskt.':'Håll vänster musknapp nere och rita från ordinarie linje, via den nya vägen, tillbaka till ordinarie linje.','');say('RITLÄGE aktivt – håll musknappen nere och dra den nya bussvägen.',5200)}
function stopMode(hide=true){active=false;drawing=false;$('mapViewport')?.classList.remove('drawMode');clearPreview();if(hide)$('drawDetourPanel')?.classList.add('hidden')}
function installPanel(){const btn=$('detourBtn');if(!btn||$('drawDetourPanel'))return false;btn.textContent='✍ RITA OMLÄGGNING PÅ KARTAN';btn.classList.remove('red');btn.classList.add('primary');const p=document.createElement('div');p.id='drawDetourPanel';p.className='drawDetourPanel hidden';p.innerHTML='<b>✍ Rita omläggning</b><span>Rita med musen. Appen rättar linjen till körbar bussväg. Vid terminaler och slingor används ritningens färdriktning så rätt gren väljs.</span><div class="drawDetourActions"><button id="drawDetourAgain" class="btn small primary" type="button">✍ Rita nu</button><button id="drawDetourCancel" class="btn small" type="button">Avbryt</button></div><div id="drawDetourStatus" class="drawDetourStatus"></div>';btn.insertAdjacentElement('afterend',p);const s=document.createElement('style');s.textContent='.drawDetourPanel{grid-column:1/-1;border:1px solid #9bc2f3;background:#f6faff;border-radius:10px;padding:8px;display:grid;gap:5px}.drawDetourPanel.hidden{display:none!important}.drawDetourPanel>b{font-size:11px;color:#0b57b8}.drawDetourPanel>span,.drawDetourStatus{font-size:9px;line-height:1.35;color:#475467}.drawDetourActions{display:flex;gap:5px}.drawDetourStatus.busy{color:#0b57b8;font-weight:800}.drawDetourStatus.ok{color:#067647;font-weight:800}.drawDetourStatus.err{color:#b42318;font-weight:800}';document.head.appendChild(s);
  btn.onclick=e=>{e.preventDefault();e.stopPropagation();p.classList.toggle('hidden');if(!p.classList.contains('hidden'))startMode();else stopMode(false)};$('drawDetourAgain').onclick=startMode;$('drawDetourCancel').onclick=()=>stopMode(true);return true}
function bindMap(){const vp=$('mapViewport');if(!vp||vp.dataset.drawEnhancerBound)return false;vp.dataset.drawEnhancerBound='1';
  vp.addEventListener('pointerdown',e=>{if(!active||e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();drawing=true;raw=[clientToLL(e)];try{vp.setPointerCapture(e.pointerId)}catch{}previewDraw()},true);
  vp.addEventListener('pointermove',e=>{if(!active||!drawing)return;e.preventDefault();e.stopImmediatePropagation();const c=clientToLL(e),last=raw.at(-1);if(!last||A().hav(last,c)>3){raw.push(c);previewDraw()}},true);
  const end=e=>{if(!active||!drawing)return;e.preventDefault();e.stopImmediatePropagation();drawing=false;try{vp.releasePointerCapture(e.pointerId)}catch{}finishStroke()};vp.addEventListener('pointerup',end,true);vp.addEventListener('pointercancel',e=>{if(!active||!drawing)return;e.stopImmediatePropagation();drawing=false;clearPreview()},true);return true}
function install(){return installPanel()&&bindMap()}
let tries=0;const t=setInterval(()=>{if(install()||++tries>160)clearInterval(t)},150);
})();
