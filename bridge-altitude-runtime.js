(()=>{
'use strict';
/* GMP_BRIDGE_ALTITUDE_RUNTIME_V1
   Keeps the 3D bus on the bridge/viaduct deck instead of the lower road/ground mesh.
   Uses nearby routed road metadata so bridge detection survives short metadata gaps. */

const oldInfrastructureKindForSample=window.infrastructureKindForSample;
const oldGoogleAltitudeMode=window.googleAltitudeMode;
const oldGoogleVehicleAltitude=window.googleVehicleAltitude;

function txt(v){return String(v??'').toLowerCase()}
function isYes(v){const s=txt(v);return !!v && !['no','false','0','none'].includes(s)}
function metaIsBridge(m){
  if(!m)return false;
  const t=m.tags||{};
  const layer=Number(t.layer??m.layer??0);
  const words=[m.name,m.roadName,m.roadClass,m.highway,m.use,t.bridge,t.man_made,t.highway].filter(Boolean).join(' ').toLowerCase();
  return !!m.bridge || isYes(t.bridge) || layer>0 || /\bbridge\b|\bviaduct\b|\bbro\b|\bbroar\b/.test(words);
}
function metaIsTunnel(m){
  if(!m)return false;
  const t=m.tags||{};
  const layer=Number(t.layer??m.layer??0);
  const words=[m.name,m.roadName,m.roadClass,m.highway,m.use,t.tunnel,t.covered].filter(Boolean).join(' ').toLowerCase();
  return !!m.tunnel || isYes(t.tunnel) || layer<0 || /\btunnel\b/.test(words);
}
function nearbyMeta(sample,route){
  try{
    if(typeof window.roadMetaForDistance!=='function')return[];
    const d=typeof window.dir==='function'?window.dir():null;
    const total=typeof window.routeLength==='function'?window.routeLength(route||[]):Infinity;
    const base=Number(sample?.distance)||0;
    const offsets=[0,-6,6,-14,14,-24,24];
    const out=[];
    for(const off of offsets){
      const dist=Math.max(0,Math.min(Number.isFinite(total)?total:base+Math.abs(off),base+off));
      const m=window.roadMetaForDistance(dist,route,d);
      if(m&&!out.includes(m))out.push(m);
    }
    return out;
  }catch{return[]}
}
function bridgeMeta(sample,route){
  const list=nearbyMeta(sample,route);
  return list.find(metaIsBridge)||null;
}
function tunnelMeta(sample,route){
  const list=nearbyMeta(sample,route);
  if(list.some(metaIsBridge))return null; // elevated road wins where levels cross
  return list.find(metaIsTunnel)||null;
}

window.infrastructureKindForSample=function(sample=null,route=null){
  if(bridgeMeta(sample,route))return'bridge';
  if(tunnelMeta(sample,route))return'tunnel';
  try{return oldInfrastructureKindForSample?.(sample,route)||'ground'}catch{return'ground'}
};

window.googleAltitudeMode=function(sample=null,route=null){
  if(bridgeMeta(sample,route))return'RELATIVE_TO_MESH';
  if(tunnelMeta(sample,route))return'RELATIVE_TO_MESH';
  try{return oldGoogleAltitudeMode?.(sample,route)||'RELATIVE_TO_GROUND'}catch{return'RELATIVE_TO_GROUND'}
};

window.googleVehicleAltitude=function(sample=null,route=null){
  const m=bridgeMeta(sample,route);
  if(m){
    // On photorealistic 3D the deck is part of the mesh. A slightly larger clearance
    // keeps the bus body above the road surface and prevents depth-clipping into the viaduct.
    return 2.15;
  }
  if(tunnelMeta(sample,route))return .18;
  try{return Number(oldGoogleVehicleAltitude?.(sample,route))||.12}catch{return .12}
};

// If a bridge is approached, keep the classification stable for a short distance so the
// bus cannot jump down to the lower road at bridge joints/intersections.
let lastBridgeAt=-Infinity;
const oldKind=window.infrastructureKindForSample;
window.infrastructureKindForSample=function(sample=null,route=null){
  const d=Number(sample?.distance)||0;
  const bm=bridgeMeta(sample,route);
  if(bm){lastBridgeAt=d;return'bridge'}
  if(Math.abs(d-lastBridgeAt)<34)return'bridge';
  if(tunnelMeta(sample,route))return'tunnel';
  try{return oldInfrastructureKindForSample?.(sample,route)||'ground'}catch{return'ground'}
};

console.info('GMP bridge altitude runtime active');
})();
