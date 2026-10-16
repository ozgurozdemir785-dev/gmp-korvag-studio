(()=>{
'use strict';
/* GMP_ROUTE_COMMAND_V1
   Textkommando ovanpå Smart omläggning. Rör inte API-nycklar, 3D eller routingmotorn.
   Exempel: "Kör från Linnéplatsen via Övre Husargatan, Parkgatan och Polhemsplatsen till Hjalmar Brantingsplatsen". */

const $=id=>document.getElementById(id);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function tidy(s){
  return String(s||'')
    .replace(/[“”]/g,'"').replace(/[–—]/g,'-')
    .replace(/\s+/g,' ').replace(/^\s+|\s+$/g,'')
    .replace(/[.!?]+$/,'').trim();
}
function stripLead(s){
  return tidy(s)
    .replace(/^(?:jag\s+vill\s+|jag\s+vill\s+att\s+bussen\s+ska\s+|bussen\s+(?:ska|skall)\s+|kan\s+du\s+|vänligen\s+)?(?:köra|kör|trafikera|gå|ta)\s+/i,'')
    .trim();
}
function splitVia(v){
  if(!v)return[];
  return tidy(v)
    .replace(/\s+(?:och\s+sedan|och\s+sen|därefter|sedan|sen|vidare\s+via|vidare)\s+/gi,',')
    .replace(/\s+och\s+/gi,',')
    .replace(/\s*(?:->|→|>)\s*/g,',')
    .split(',').map(x=>tidy(x.replace(/^(?:via|över|genom)\s+/i,''))).filter(Boolean);
}
function parseCommand(raw){
  let s=stripLead(raw);
  if(!s)throw new Error('Skriv hur du vill köra.');

  // Pilformat: Linnéplatsen -> Övre Husargatan -> Parkgatan -> Hjalmar
  if(/(?:->|→)/.test(s) && !/\bfrån\b/i.test(s)){
    const pts=s.split(/\s*(?:->|→)\s*/).map(tidy).filter(Boolean);
    if(pts.length<2)throw new Error('Jag behöver minst start och mål.');
    return {from:pts[0],via:pts.slice(1,-1),to:pts.at(-1)};
  }

  // från A via B,C till D
  let m=s.match(/\bfrån\s+(.+?)\s+(?:via|över|genom)\s+(.+?)\s+\btill\s+(.+)$/i);
  if(m)return {from:tidy(m[1]),via:splitVia(m[2]),to:tidy(m[3])};

  // från A till D via B,C
  m=s.match(/\bfrån\s+(.+?)\s+\btill\s+(.+?)\s+(?:via|över|genom)\s+(.+)$/i);
  if(m)return {from:tidy(m[1]),via:splitVia(m[3]),to:tidy(m[2])};

  // från A till D
  m=s.match(/\bfrån\s+(.+?)\s+\btill\s+(.+)$/i);
  if(m)return {from:tidy(m[1]),via:[],to:tidy(m[2])};

  // A -> B -> C-format med ordet "till" saknas.
  const chain=s.split(/\s*(?:,|;|\|)\s*/).map(tidy).filter(Boolean);
  if(chain.length>=2)return {from:chain[0],via:chain.slice(1,-1),to:chain.at(-1)};

  throw new Error('Skriv exempelvis: Från Linnéplatsen via Övre Husargatan och Parkgatan till Hjalmar Brantingsplatsen.');
}
function preview(p){
  const el=$('routeCommandPreview');if(!el)return;
  el.className='routeCommandPreview ok';
  el.innerHTML=`<b>START:</b> ${esc(p.from)}<br><b>VIA:</b> ${p.via.length?p.via.map(esc).join(' → '):'direkt'}<br><b>MÅL:</b> ${esc(p.to)}`;
}
function error(msg){
  const el=$('routeCommandPreview');if(el){el.className='routeCommandPreview err';el.textContent=msg}
  try{window.GMP_APP?.toast?.(msg,5200)}catch{}
}
function clearExistingVia(){
  const chips=$('smartViaChips');if(!chips)return;
  const buttons=[...chips.querySelectorAll('button[data-x]')].reverse();
  for(const b of buttons)b.click();
}
async function addVia(name){
  const input=$('smartVia'),btn=$('smartViaAdd'),chips=$('smartViaChips');
  if(!input||!btn)throw new Error('Smart omläggning är inte färdigladdad ännu.');
  const before=chips?.querySelectorAll('.spChip').length||0;
  input.value=name;input.dispatchEvent(new Event('input',{bubbles:true}));
  await sleep(80);btn.click();
  for(let i=0;i<80;i++){
    await sleep(75);
    const after=chips?.querySelectorAll('.spChip').length||0;
    if(after>before || input.value==='')return;
    const st=$('smartPlaceStatus');if(st?.classList.contains('err'))throw new Error(st.textContent||('Hittade inte '+name));
  }
  throw new Error('Kunde inte lägga till via: '+name);
}
async function applyCommand(p,build=false){
  const from=$('smartFrom'),to=$('smartTo');
  if(!from||!to)throw new Error('Öppna Smart omläggning först.');
  clearExistingVia();
  from.value=p.from;from.dispatchEvent(new Event('input',{bubbles:true}));
  to.value=p.to;to.dispatchEvent(new Event('input',{bubbles:true}));
  for(const v of p.via)await addVia(v);
  preview(p);
  const st=$('smartPlaceStatus');if(st){st.className='smartPlaceStatus ok';st.textContent='✓ Kommando tolkat. Start, via och mål är ifyllda.'}
  if(build){
    const b=$('smartBuildBtn');if(!b)throw new Error('Bygg-knappen saknas.');
    await sleep(120);b.click();
  }
}
async function run(build){
  const input=$('routeCommandInput'),go=$('routeCommandBuild'),parse=$('routeCommandParse');
  if(!input)return;
  try{
    if(go)go.disabled=true;if(parse)parse.disabled=true;
    const p=parseCommand(input.value);preview(p);await applyCommand(p,build);
  }catch(e){error(e?.message||String(e))}
  finally{if(go)go.disabled=false;if(parse)parse.disabled=false}
}
function installStyle(){
  if($('routeCommandStyle'))return;
  const s=document.createElement('style');s.id='routeCommandStyle';s.textContent=`
  .routeCommandBox{border:1px solid #7fb0ed;background:#eef6ff;border-radius:10px;padding:8px;margin:0 0 9px}.routeCommandBox label{display:block;font-size:10px;font-weight:950;color:#0b57b8;margin-bottom:4px}.routeCommandBox textarea{width:100%;min-height:67px;resize:vertical;border:1px solid #a9c7ef;border-radius:8px;padding:8px;background:#fff;font:inherit;font-size:11px;line-height:1.35}.routeCommandActions{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:6px}.routeCommandPreview{font-size:9px;line-height:1.45;margin-top:6px;padding:6px;border-radius:7px;background:#fff;color:#475467}.routeCommandPreview.ok{border:1px solid #abefc6;color:#067647}.routeCommandPreview.err{border:1px solid #fecdca;background:#fff6f5;color:#b42318;font-weight:800}.routeCommandExample{font-size:8.5px;color:#667085;margin-top:5px;line-height:1.35}`;document.head.appendChild(s);
}
function install(){
  installStyle();const panel=$('smartPlacePanel');if(!panel)return false;if($('routeCommandBox'))return true;
  const title=panel.querySelector('.spTitle');const box=document.createElement('div');box.id='routeCommandBox';box.className='routeCommandBox';box.innerHTML=`
    <label>⌨ KOMMANDO – skriv exakt hur bussen ska köra</label>
    <textarea id="routeCommandInput" placeholder="Kör från Linnéplatsen via Övre Husargatan, Nya Allén, Parkgatan och Polhemsplatsen till Hjalmar Brantingsplatsen"></textarea>
    <div class="routeCommandActions"><button id="routeCommandParse" type="button" class="btn small">👁 Tolka</button><button id="routeCommandBuild" type="button" class="btn primary small">⚡ BYGG DIREKT</button></div>
    <div id="routeCommandPreview" class="routeCommandPreview">Du kan också skriva: Linnéplatsen → Övre Husargatan → Parkgatan → Hjalmar.</div>
    <div class="routeCommandExample">Systemet använder samma hållplats-/gata-/terminal-sökning som Smart omläggning. Röd indragen sträcka är fortfarande förbjuden.</div>`;
  title?.after(box);$('routeCommandParse').onclick=()=>run(false);$('routeCommandBuild').onclick=()=>run(true);$('routeCommandInput').addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key==='Enter'){e.preventDefault();run(true)}});return true;
}
let n=0;const t=setInterval(()=>{if(install()||++n>240)clearInterval(t)},250);install();
})();
