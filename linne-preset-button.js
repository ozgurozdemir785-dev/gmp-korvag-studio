(()=>{
'use strict';
const $=id=>document.getElementById(id);
function load(src,id){return new Promise((resolve,reject)=>{if($(id))return resolve();const s=document.createElement('script');s.id=id;s.src=src;s.onload=resolve;s.onerror=()=>reject(new Error('Kunde inte ladda '+src));document.head.appendChild(s)})}
async function ensurePreset(){
  if(typeof window.GMPLinnePreset==='function')return true;
  try{
    await load('/detour-search.js?v=stable-20261015','gmpDetourSearchStable');
    await load('/active-detour.js?v=stable-20261015','gmpActiveDetourStable');
    if(typeof window.GMPLinnePreset!=='function')await load('/smart-auto-detour.js?v=stable-20261015','gmpSmartAutoStable');
  }catch(e){console.warn(e)}
  for(let i=0;i<80;i++){
    if(typeof window.GMPLinnePreset==='function')return true;
    await new Promise(r=>setTimeout(r,100));
  }
  return false;
}
async function run(){
  const b=$('linneNilsPresetBtn');
  if(b){b.disabled=true;b.textContent='⏳ Bygger Linnéplatsen → Nils Ericson…'}
  const ok=await ensurePreset();
  if(!ok){
    if(b){b.disabled=false;b.textContent='🚌 LINNÉPLATSEN → NILS ERICSON via ÖVRE HUSARGATAN'}
    try{toast('Omläggningsmodulen kunde inte laddas. Ladda om sidan och försök igen.',5000)}catch{alert('Omläggningsmodulen kunde inte laddas. Ladda om sidan och försök igen.')}
    return;
  }
  try{await window.GMPLinnePreset()}catch(e){console.error(e)}
  if(b){b.disabled=false;b.textContent='🚌 LINNÉPLATSEN → NILS ERICSON via ÖVRE HUSARGATAN'}
}
function install(){
  const host=$('setOrdinaryBtn')?.parentNode||$('leftSecRoute')?.querySelector('.sectionBody');
  if(!host||$('linneNilsPresetBtn'))return;
  const btn=document.createElement('button');
  btn.id='linneNilsPresetBtn';btn.className='btn green wide';btn.style.cssText='min-height:44px;font-weight:900';
  btn.textContent='🚌 LINNÉPLATSEN → NILS ERICSON via ÖVRE HUSARGATAN';
  btn.addEventListener('click',run);
  const ordinary=$('setOrdinaryBtn');
  if(ordinary?.nextSibling)host.insertBefore(btn,ordinary.nextSibling);else host.appendChild(btn);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{install();setTimeout(install,600)});else{install();setTimeout(install,600)}
setInterval(install,2500);
})();
