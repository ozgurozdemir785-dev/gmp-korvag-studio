(()=>{
'use strict';

/* LINNE_PRESET_BOOTSTRAP_V1 */
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

async function ensurePreset(){
  if(typeof window.GMPLinnePreset==='function')return window.GMPLinnePreset;
  let s=document.getElementById('smartAutoDetourScript');
  if(!s){
    s=document.createElement('script');
    s.id='smartAutoDetourScript';
    s.src='/smart-auto-detour.js?v=linne-click-v4-20261015';
    s.async=false;
    document.head.appendChild(s);
  }
  for(let i=0;i<60;i++){
    if(typeof window.GMPLinnePreset==='function')return window.GMPLinnePreset;
    await sleep(100);
  }
  throw new Error('Omläggningsmodulen kunde inte starta. Ladda om sidan och försök igen.');
}

async function run(btn){
  if(btn.dataset.gmpBusy==='1')return;
  btn.dataset.gmpBusy='1';
  const label=btn.textContent;
  btn.disabled=true;
  btn.textContent='⏳ Bygger Linnéplatsen → Nils Ericson…';
  try{
    const fn=await ensurePreset();
    await fn();
  }catch(e){
    console.error('Linné preset failed',e);
    const st=document.getElementById('autoDetourStatus');
    if(st){st.className='autoDetourStatus err';st.textContent=e?.message||String(e)}
    try{if(typeof toast==='function')toast(e?.message||String(e),5200);else alert(e?.message||String(e))}catch{}
  }finally{
    btn.disabled=false;
    btn.textContent=label;
    delete btn.dataset.gmpBusy;
  }
}

// Delegation gör att knappen fungerar även om vänsterpanelen byggs om efter sidladdning.
document.addEventListener('click',e=>{
  const btn=e.target?.closest?.('#linneNilsPresetBtn');
  if(!btn)return;
  e.preventDefault();
  e.stopPropagation();
  run(btn);
},true);

})();
