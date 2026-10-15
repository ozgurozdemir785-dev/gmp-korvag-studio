from pathlib import Path
import re

p=Path('index.html')
s=p.read_text(encoding='utf-8')

# 1) During recording move every interactive map/3D control outside #mapArea.
# The track is cropped to #mapArea, so controls remain clickable for the operator
# but are not present in the recorded video.
old=re.compile(r"let recordRailPlaceholder=null;\nfunction floatCameraRailForRecording\(\)\{.*?\}\nfunction restoreCameraRailAfterRecording\(\)\{.*?\}\n", re.S)
new=r'''let recordFloatingControls=[];
function recordingControlNodes(){
  const root=$('mapArea');if(!root)return[];
  const selectors=['#cameraSideRail','#googleCamDock','.googleViewBar','.googleCamBar','.bottomControls','#timeline','.zoomCtl','.mapHudTop','#trafficStudioDock'];
  const nodes=[];
  for(const sel of selectors)for(const el of root.querySelectorAll(sel)){if(!nodes.includes(el))nodes.push(el)}
  // Do not separately move a child when one of its selected parents is already moved.
  return nodes.filter(el=>!nodes.some(other=>other!==el&&other.contains(el)));
}
function floatCameraRailForRecording(){
  if(recordFloatingControls.length)return;
  for(const el of recordingControlNodes()){
    const r=el.getBoundingClientRect();if(r.width<2||r.height<2)continue;
    const ph=document.createComment('record-control-home');el.parentNode?.insertBefore(ph,el);
    const style=el.getAttribute('style');
    recordFloatingControls.push({el,ph,style});
    document.body.appendChild(el);
    el.classList.add('recordFloating');
    el.style.setProperty('position','fixed','important');
    el.style.setProperty('left',r.left+'px','important');
    el.style.setProperty('top',r.top+'px','important');
    el.style.setProperty('right','auto','important');
    el.style.setProperty('bottom','auto','important');
    el.style.setProperty('width',r.width+'px','important');
    el.style.setProperty('max-width',r.width+'px','important');
    el.style.setProperty('transform','none','important');
    el.style.setProperty('z-index','2147483000','important');
    el.style.setProperty('pointer-events','auto','important');
  }
  document.body.classList.add('gmpRecordingControls');
}
function restoreCameraRailAfterRecording(){
  for(const x of recordFloatingControls.splice(0)){
    try{x.ph.parentNode?.insertBefore(x.el,x.ph);x.ph.remove();x.el.classList.remove('recordFloating');if(x.style==null)x.el.removeAttribute('style');else x.el.setAttribute('style',x.style)}catch{}
  }
  document.body.classList.remove('gmpRecordingControls');
}
'''
s,n=old.subn(new,s,count=1)
if n!=1:
    raise SystemExit(f'record controls patch failed: {n}')

# 2) Recognize viaduct/bridge/tunnel from both normalized road metadata and raw OSM tags.
old=re.compile(r"function infrastructureKindAtDistance\(distance,route,d=dir\(\)\)\{.*?\n\}\nfunction infrastructureSegments", re.S)
new=r'''function infrastructureKindAtDistance(distance,route,d=dir()){
  const arr=d?.roadMeta||[];if(!arr.length)return'ground';const base=buildSimRoute(d),bt=routeLength(base),rt=routeLength(route||[]),scale=bt>0?rt/bt:1;let bridge=false,tunnel=false;
  for(const m of arr){
    const a=m.start*scale-18,b=m.end*scale+18;if(distance<a||distance>b)continue;
    const t=m.tags||{},bridgeTag=String(t.bridge||'').toLowerCase(),tunnelTag=String(t.tunnel||'').toLowerCase(),layer=Number(t.layer||m.layer||0),txt=[m.name,m.roadName,m.roadClass,m.highway,t.bridge,t.tunnel,t.man_made].filter(Boolean).join(' ').toLowerCase();
    const isTunnel=!!m.tunnel||(tunnelTag&&tunnelTag!=='no')||String(t.covered||'').toLowerCase()==='yes'||layer<0||/tunnel|underpass|underfart/.test(txt);
    const isBridge=!!m.bridge||(bridgeTag&&bridgeTag!=='no')||String(t.man_made||'').toLowerCase()==='bridge'||layer>0||/viaduct|viadukt|bridge|bro\b/.test(txt);
    if(isTunnel)tunnel=true;else if(isBridge)bridge=true;
  }
  return tunnel?'tunnel':bridge?'bridge':'ground';
}
function infrastructureSegments'''
s,n=old.subn(new,s,count=1)
if n!=1:
    raise SystemExit(f'infrastructure classification patch failed: {n}')

# 3) In aerial 3D, never draw an underground tunnel segment on top of the 3D surface.
# The route still exists and the simulation/camera follows it; bridge/viaduct remains visible.
s=s.replace("for(const seg of segs){const alt=seg.kind==='bridge'?1.05:seg.kind==='tunnel'?.55:.36,path=seg.coords.map(c=>({lat:c[1],lng:c[0],altitude:alt})),line=new lib.Polyline3DElement({path,strokeColor:'#5b34f2',strokeWidth:7,outerColor:'#ffffff',outerWidth:.42,altitudeMode:seg.mode,drawsOccludedSegments:false,zIndex:50});google3dMap.append(line);google3dRouteLines.push(line)}",
"for(const seg of segs){if(seg.kind==='tunnel')continue;const alt=seg.kind==='bridge'?1.05:.36,path=seg.coords.map(c=>({lat:c[1],lng:c[0],altitude:alt})),line=new lib.Polyline3DElement({path,strokeColor:'#5b34f2',strokeWidth:7,outerColor:'#ffffff',outerWidth:.42,altitudeMode:seg.mode,drawsOccludedSegments:false,zIndex:50});google3dMap.append(line);google3dRouteLines.push(line)}",1)

# 4) Hide the external bus model/indicators while it is physically in a tunnel.
# It reappears automatically at the tunnel exit. Driver view is already bus-model free.
needle="const pose=vehiclePose(route,sample)||{center:sample.coord,heading:sample.bearing},c=sample.coord,modelC=pose.center,hdg=pose.heading||sample.bearing||0,now=_paintNow,dt="
if needle not in s:
    raise SystemExit('updateGoogleView anchor missing')
s=s.replace(needle,"const pose=vehiclePose(route,sample)||{center:sample.coord,heading:sample.bearing},c=sample.coord,modelC=pose.center,hdg=pose.heading||sample.bearing||0,infraKind=infrastructureKindForSample(sample,route),now=_paintNow,dt=",1)
s=s.replace("google3dBusModel.style.display=(googleCameraMode==='driver'||!vis().bus3d)?'none':''","google3dBusModel.style.display=(googleCameraMode==='driver'||!vis().bus3d||infraKind==='tunnel')?'none':''",1)
s=s.replace("google3dFallbackMarker.style.display=(googleCameraMode==='driver'||!vis().bus3d)?'none':''","google3dFallbackMarker.style.display=(googleCameraMode==='driver'||!vis().bus3d||infraKind==='tunnel')?'none':''",1)
s=s.replace("google3dSignalLeft.style.display=googleCameraMode==='driver'||!vis().signals3d||!onL?'none':''","google3dSignalLeft.style.display=googleCameraMode==='driver'||infraKind==='tunnel'||!vis().signals3d||!onL?'none':''",1)
s=s.replace("google3dSignalRight.style.display=googleCameraMode==='driver'||!vis().signals3d||!onR?'none':''","google3dSignalRight.style.display=googleCameraMode==='driver'||infraKind==='tunnel'||!vis().signals3d||!onR?'none':''",1)

# 5) Recording wording makes the behavior explicit.
s=s.replace("toast('REC: bara kartan och bussen spelas in. Kameror och panel kan användas fritt.',5200)","toast('REC: videon innehåller bara kartan/3D, rutten och bussen. Knapparna ligger utanför inspelningen men kan användas hela tiden.',5600)",1)

p.write_text(s,encoding='utf-8')
print('patched clean recording controls + bridge/viaduct/tunnel handling')
