from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')

old = '''function buildDriveRoute(d){
  let base=buildSimRoute(d);if(!base?.length||base.length<2)return base||[];
  // V7.1: när en ordinarie GTFS/OSM-linje har map-matchats kör bussen på den riktiga väggeometrin.
  // Det gör framför allt rondeller/kurvor/bussgator mjuka utan att ändra den stabila kart- och zoommotorn.
  const plainOrdinary=d.ordinary?.length>1&&!d.freeActive&&!Number.isFinite(d.cutDistance)&&!(d.affected&&d.detour?.length>1);
  if(plainOrdinary&&d.roadLockedRoute?.length>1)base=d.roadLockedRoute;
  const prof=vehicleProfile(),step=Math.max(2.0,Math.min(2.8,prof.length/7.2));
  return resampleRoute(base,step);
}
'''

new = '''function applyServiceWindowToDriveRoute(route,d){
  if(!route?.length||route.length<2||!d)return route||[];
  const startId=String(d.serviceStartStopId||''),endId=String(d.serviceEndStopId||'');
  if(!startId&&!endId)return route;
  const stops=d.stops||[],key=(st,i)=>String(st?.id||st?.code||((st?.name||'Hållplats')+'#'+i));
  let startD=0,endD=routeLength(route),hasStart=false,hasEnd=false;
  for(let i=0;i<stops.length;i++){
    const st=stops[i],k=key(st,i);if(!st?.coord)continue;
    if(startId&&k===startId){const n=nearestPointOnRoute(route,st.coord);if(n&&n.offset<=70){startD=n.distance;hasStart=true}}
    if(endId&&k===endId){const n=nearestPointOnRoute(route,st.coord);if(n&&n.offset<=70){endD=n.distance;hasEnd=true}}
  }
  if(startId&&!hasStart)return route;
  if(endId&&!hasEnd)return route;
  if(endD<=startD+8)return route;
  const sliced=routeSliceByDistance(route,startD,endD,3);
  return sliced?.length>1?sliced:route;
}
function buildDriveRoute(d){
  let base=buildSimRoute(d);if(!base?.length||base.length<2)return base||[];
  // Ordinarie linje visas komplett. Trafikstart/trafikslut påverkar bara den aktiva busskörningen.
  const plainOrdinary=d.ordinary?.length>1&&!d.freeActive&&!Number.isFinite(d.cutDistance)&&!(d.affected&&d.detour?.length>1);
  if(plainOrdinary&&d.roadLockedRoute?.length>1)base=d.roadLockedRoute;
  base=applyServiceWindowToDriveRoute(base,d);
  const prof=vehicleProfile(),step=Math.max(2.0,Math.min(2.8,prof.length/7.2));
  return resampleRoute(base,step);
}
'''

if 'function applyServiceWindowToDriveRoute(' not in s:
    if old not in s:
        raise SystemExit('Could not find original buildDriveRoute block')
    s = s.replace(old, new, 1)

tag = '<script src="/service-window-manager.js?v=20261015-1655"></script>'
if 'service-window-manager.js' not in s:
    if '</body>' not in s:
        raise SystemExit('Could not find </body>')
    s = s.replace('</body>', tag + '\n</body>', 1)

p.write_text(s, encoding='utf-8')

hp = Path('_headers')
h = hp.read_text(encoding='utf-8') if hp.exists() else ''
if '/service-window-manager.js' not in h:
    h += '\n/service-window-manager.js\n  Cache-Control: no-store, no-cache, must-revalidate, max-age=0\n'
    hp.write_text(h, encoding='utf-8')

print('service window patch ready')
