from pathlib import Path
import re

p = Path('index.html')
s = p.read_text(encoding='utf-8')

new_fn = r'''function infrastructureKindAtDistance(distance,route,d=dir()){
  const arr=d?.roadMeta||[];if(!arr.length)return'ground';
  const base=buildSimRoute(d),bt=routeLength(base),rt=routeLength(route||[]),scale=bt>0?rt/bt:1;
  const exact=[],near=[];
  for(const m of arr){
    const a=Number(m.start||0)*scale,b=Number(m.end||0)*scale;
    const lo=Math.min(a,b),hi=Math.max(a,b);
    if(distance>=lo-5&&distance<=hi+5){
      const t=m.tags||{},bridgeTag=String(t.bridge||'').toLowerCase(),tunnelTag=String(t.tunnel||'').toLowerCase(),layer=Number(t.layer??m.layer??0),txt=[m.name,m.roadName,m.roadClass,m.highway,t.bridge,t.tunnel,t.man_made].filter(Boolean).join(' ').toLowerCase();
      const isTunnel=!!m.tunnel||(tunnelTag&&tunnelTag!=='no')||String(t.covered||'').toLowerCase()==='yes'||/tunnel|underpass|underfart/.test(txt);
      const isBridge=!!m.bridge||(bridgeTag&&bridgeTag!=='no')||String(t.man_made||'').toLowerCase()==='bridge'||/viaduct|viadukt|bridge|bro\b/.test(txt)||(layer>0&&!isTunnel);
      const item={isTunnel,isBridge,inside:distance>=lo&&distance<=hi,gap:distance<lo?lo-distance:distance>hi?distance-hi:0,span:Math.max(1,hi-lo)};
      (item.inside?exact:near).push(item);
    }
  }
  const pick=list=>{
    if(!list.length)return'ground';
    // På en viadukt kan metadata för en korsande väg överlappa. Den faktiska brodelen ska då vinna
    // så bussen inte göms som om den vore i tunnel.
    if(list.some(x=>x.isBridge&&!x.isTunnel))return'bridge';
    if(list.some(x=>x.isTunnel))return'tunnel';
    return'ground';
  };
  const exactKind=pick(exact);if(exactKind!=='ground')return exactKind;
  return pick(near);
}
'''

pat = re.compile(r"function infrastructureKindAtDistance\(distance,route,d=dir\(\)\)\{.*?\n\}\nfunction infrastructureSegments", re.S)
m = pat.search(s)
if not m:
    raise SystemExit('infrastructureKindAtDistance block not found')
s = s[:m.start()] + new_fn + 'function infrastructureSegments' + s[m.end():]

s, n = re.subn(
    r"function googleVehicleAltitude\(sample=null,route=null\)\{[^\n]*\}",
    "function googleVehicleAltitude(sample=null,route=null){const k=infrastructureKindForSample(sample,route);return k==='bridge'?1.45:k==='tunnel'?.18:.12}",
    s,
    count=1,
)
if n != 1:
    raise SystemExit('googleVehicleAltitude not patched')

# Keep the 3D route line slightly above the photogrammetry surface on bridges.
s = s.replace("const alt=seg.kind==='bridge'?1.05:.36", "const alt=seg.kind==='bridge'?1.28:.36")

marker = '3D_BUS_BRIDGE_VISIBILITY_V1'
if marker not in s:
    s = s.replace('</head>', f'<!-- {marker} -->\n</head>', 1)

p.write_text(s, encoding='utf-8')
print('Patched bridge/viaduct bus visibility')
