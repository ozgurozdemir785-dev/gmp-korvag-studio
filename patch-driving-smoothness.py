from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')

# 1) Cache safety events projected onto the active route.
old = """function safetyEventsOnRoute(route,d=dir()){
  const out=[];for(const ev of (d?.safetyEvents||[])){const n=nearestPointOnRoute(route,ev.coord);if(!n||n.offset>16)continue;out.push({...ev,distance:n.distance,offset:n.offset})}return out.sort((a,b)=>a.distance-b.distance)
}
"""
new = """const safetyEventsRouteCache=new WeakMap();
function safetyEventsOnRoute(route,d=dir()){
  const src=d?.safetyEvents||[];if(!route||typeof route!=='object')return[];
  const f=src[0],l=src[src.length-1],sig=src.length+'|'+String(f?.id||f?.kind||'')+'|'+String(l?.id||l?.kind||'')+'|'+String(f?.coord||'')+'|'+String(l?.coord||'');
  const hit=safetyEventsRouteCache.get(route);if(hit&&hit.d===d&&hit.sig===sig)return hit.events;
  const out=[];for(const ev of src){const n=nearestPointOnRoute(route,ev.coord);if(!n||n.offset>16)continue;out.push({...ev,distance:n.distance,offset:n.offset})}out.sort((a,b)=>a.distance-b.distance);
  safetyEventsRouteCache.set(route,{d,sig,events:out});return out
}
"""
if old in s:
    s = s.replace(old, new, 1)
elif 'const safetyEventsRouteCache=new WeakMap();' not in s:
    raise SystemExit('safetyEventsOnRoute anchor missing')

# 2) Cache mapped roundabout intervals instead of rebuilding route metadata every animation frame.
old = """function mappedRoundaboutState(sample,route,d=dir()){
  if(!sample||!route?.length||!state.rules.roundabout)return{inside:false,ahead:Infinity,exitAhead:Infinity};const arr=d?.roadMeta||[];if(!arr.length)return{inside:false,ahead:Infinity,exitAhead:Infinity};
  const base=buildSimRoute(d),bt=routeLength(base),rt=routeLength(route);const scale=bt>0?rt/bt:1;let inside=false,ahead=Infinity,exitAhead=Infinity;
  for(const m of arr){if(!m.roundabout)continue;const a=m.start*scale,b=m.end*scale;if(sample.distance>=a-2&&sample.distance<=b+2){inside=true;exitAhead=Math.max(0,b-sample.distance);break}if(a>sample.distance&&a-sample.distance<ahead){ahead=a-sample.distance;exitAhead=Math.max(0,b-sample.distance)}}
  return{inside,ahead,exitAhead};
}
"""
new = """const mappedRoundaboutCache=new WeakMap();
function mappedRoundaboutState(sample,route,d=dir()){
  if(!sample||!route?.length||!state.rules.roundabout)return{inside:false,ahead:Infinity,exitAhead:Infinity};const arr=d?.roadMeta||[];if(!arr.length)return{inside:false,ahead:Infinity,exitAhead:Infinity};
  const f=arr[0],l=arr[arr.length-1],sig=arr.length+'|'+String(f?.start||'')+'|'+String(l?.end||'')+'|'+String(f?.roundabout||'')+'|'+String(l?.roundabout||'');
  let cache=mappedRoundaboutCache.get(route);
  if(!cache||cache.d!==d||cache.sig!==sig){const base=buildSimRoute(d),bt=routeLength(base),rt=routeLength(route),scale=bt>0?rt/bt:1,intervals=[];for(const m of arr)if(m.roundabout)intervals.push({a:m.start*scale,b:m.end*scale});cache={d,sig,intervals};mappedRoundaboutCache.set(route,cache)}
  let inside=false,ahead=Infinity,exitAhead=Infinity;for(const x of cache.intervals){const a=x.a,b=x.b;if(sample.distance>=a-2&&sample.distance<=b+2){inside=true;exitAhead=Math.max(0,b-sample.distance);break}if(a>sample.distance&&a-sample.distance<ahead){ahead=a-sample.distance;exitAhead=Math.max(0,b-sample.distance)}}
  return{inside,ahead,exitAhead};
}
"""
if old in s:
    s = s.replace(old, new, 1)
elif 'const mappedRoundaboutCache=new WeakMap();' not in s:
    raise SystemExit('mappedRoundaboutState anchor missing')

# 3) Cap Google 3D camera/model updates to a stable frame rate. 2D bus movement still updates every animation frame.
old = "function updateGoogleView(sample,route,force=false){if(!googleViewMode||!sample?.coord||!google3dMap)return;const pose=vehiclePose(route,sample)||{center:sample.coord,heading:sample.bearing},c=sample.coord,modelC=pose.center,hdg=pose.heading||sample.bearing||0,now=performance.now(),dt=Math.min(.08,Math.max(.005,(now-(googleCamLast||now))/1000));"
new = "function updateGoogleView(sample,route,force=false){if(!googleViewMode||!sample?.coord||!google3dMap)return;const _paintNow=performance.now(),_paintGap=googleCameraMode==='driver'?28:34;if(!force&&_paintNow-(updateGoogleView._lastPaint||0)<_paintGap)return;updateGoogleView._lastPaint=_paintNow;const pose=vehiclePose(route,sample)||{center:sample.coord,heading:sample.bearing},c=sample.coord,modelC=pose.center,hdg=pose.heading||sample.bearing||0,now=_paintNow,dt=Math.min(.08,Math.max(.005,(now-(googleCamLast||now))/1000));"
if old in s:
    s = s.replace(old, new, 1)
elif '_paintGap=googleCameraMode' not in s:
    raise SystemExit('updateGoogleView anchor missing')

# 4) Rebuild static stop/object markers less often while following the moving bus.
old = "if(now-lastMarkerPaint>=100){renderMarkers();lastMarkerPaint=now}else renderBus();"
new = "if(now-lastMarkerPaint>=220){renderMarkers();lastMarkerPaint=now}else renderBus();"
if old in s:
    s = s.replace(old, new, 1)
elif 'lastMarkerPaint>=220' not in s:
    raise SystemExit('marker paint anchor missing')

# 5) Reduce expensive automatic signal geometry checks to ~25 fps while keeping bus position at display frame rate.
old = "state.busProgress=Math.min(1,state.busProgress+(Math.max(.2,state.simSpeed)*dt)/Math.max(totalRoute,1));const p=motionSample(r,state.busProgress);state.signal=automaticSignal(p,r,stopEvents,servedStops,navEvents);captureReplay();renderDriveAssist();"
new = "state.busProgress=Math.min(1,state.busProgress+(Math.max(.2,state.simSpeed)*dt)/Math.max(totalRoute,1));const p=motionSample(r,state.busProgress);if(!Number.isFinite(play._lastSignalAt)||now-play._lastSignalAt>=40){state.signal=automaticSignal(p,r,stopEvents,servedStops,navEvents);play._lastSignalAt=now}captureReplay();renderDriveAssist();"
if old in s:
    s = s.replace(old, new, 1)
elif 'play._lastSignalAt' not in s:
    raise SystemExit('automaticSignal frame anchor missing')

p.write_text(s, encoding='utf-8')
print('Driving smoothness patch applied')
