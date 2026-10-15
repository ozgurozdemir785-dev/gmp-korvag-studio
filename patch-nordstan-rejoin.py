from pathlib import Path
import re

# --- Smart detour navigator ---
p=Path('linne-preset-button.js')
s=p.read_text(encoding='utf-8')

needle="const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9åäöéü\\s-]/gi,' ').replace(/\\s+/g,' ').trim();\n"
addon="""const norm=s=>String(s||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9åäöéü\\s-]/gi,' ').replace(/\\s+/g,' ').trim();
function isCentralAlias(v){const n=norm(v);return n.includes('nordstan')||n.includes('nils ericson')||n.includes('nils erikson')}
function isCentralStopName(v){const n=norm(v);return n.includes('nordstan')||n.includes('nils ericson')||n.includes('nils erikson')}
function mapAliasQuery(q){return isCentralAlias(q)?'Nils Ericson Terminalen':q}
"""
if 'function isCentralAlias' not in s:
    if needle not in s: raise SystemExit('norm anchor missing')
    s=s.replace(needle,addon,1)

old="""    for(const st of (d?.stops||[])){
      if(!st?.coord||!st?.name)continue;
      out.push({kind:'stop',name:st.name,detail:`Västtrafik${line?' · linje '+line:''} · ${name==='tur'?'Tur':'Retur'}`,coord:[+st.coord[0],+st.coord[1]],official:true,direction:name});
    }
"""
new="""    const stops=d?.stops||[];
    for(let stopIndex=0;stopIndex<stops.length;stopIndex++){
      const st=stops[stopIndex];
      if(!st?.coord||!st?.name)continue;
      out.push({kind:'stop',name:st.name,detail:`Västtrafik${line?' · linje '+line:''} · ${name==='tur'?'Tur':'Retur'}${isCentralStopName(st.name)?' · Nordstan / Nils Ericsonplatsen':''}`,coord:[+st.coord[0],+st.coord[1]],official:true,direction:name,stopId:String(st.id||st.code||''),stopIndex});
    }
"""
if old in s:
    s=s.replace(old,new,1)

s,n=re.subn(r"function localMatches\(q\)\{.*?\n\}\nasync function mapMatches",'''function localMatches(q){
  const nq=norm(q);if(!nq)return[];
  const toks=nq.split(' ').filter(Boolean),central=isCentralAlias(nq),seen=new Set(),out=[];
  for(const x of allLoadedStops()){
    const n=norm(x.name),ok=central?isCentralStopName(n):toks.every(t=>n.includes(t));if(!ok)continue;
    const key=n+'_'+x.direction+'_'+String(x.stopIndex)+'_'+x.coord.map(v=>v.toFixed(5)).join('_');if(seen.has(key))continue;seen.add(key);
    const score=(central?160:n===nq?120:n.startsWith(nq)?95:70)+(x.official?10:0);
    out.push({...x,score});
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,10);
}
async function mapMatches''',s,flags=re.S)
if n!=1 and 'central=isCentralAlias' not in s:
    raise SystemExit(f'localMatches patch count={n}')

s=s.replace("const u='/geo/search?format=json&addressdetails=1&limit=8&countrycodes=se&q='+encodeURIComponent(q.trim()+', Göteborg');","const mapQ=mapAliasQuery(q);const u='/geo/search?format=json&addressdetails=1&limit=8&countrycodes=se&q='+encodeURIComponent(mapQ.trim()+', Göteborg');",1)

if 'function stopAnchorMap' not in s:
    anchor='function bestDirection(startCoord,endCoord){'
    pos=s.find(anchor)
    if pos<0: raise SystemExit('bestDirection anchor missing')
    end=s.find('\n}\nfunction restoreStops',pos)
    if end<0: raise SystemExit('bestDirection end missing')
    end+=3
    replacement=r'''function stopIndexForPlace(place,d,A){
  if(!place?.official||!d?.stops?.length)return-1;
  const pid=String(place.stopId||'');
  if(pid){const exact=d.stops.findIndex(st=>String(st?.id||st?.code||'')===pid);if(exact>=0)return exact}
  const pn=norm(place.name),central=isCentralStopName(pn);let best=-1,bestGap=Infinity;
  for(let i=0;i<d.stops.length;i++){
    const st=d.stops[i];if(!st?.coord)continue;const sn=norm(st.name),same=central?isCentralStopName(sn):sn===pn;if(!same)continue;
    const gap=A.hav(st.coord,place.coord);if(gap<bestGap){bestGap=gap;best=i}
  }
  return best;
}
function stopAnchorMap(d,A){
  const route=d?.ordinary||[],stops=d?.stops||[];if(route.length<2||!stops.length)return[];
  const sig=route.length+'|'+stops.length+'|'+route[0]?.join(',')+'|'+route.at(-1)?.join(',');
  if(d._smartPlaceStopAnchorCache?.sig===sig)return d._smartPlaceStopAnchorCache.anchors;
  const cum=new Float64Array(route.length);for(let i=1;i<route.length;i++)cum[i]=cum[i-1]+A.hav(route[i-1],route[i]);
  const K=18,cands=stops.map(st=>{
    if(!st?.coord)return[{i:0,gap:99999}];const a=[];
    for(let i=0;i<route.length;i++){
      const gap=A.hav(route[i],st.coord);
      if(a.length<K){a.push({i,gap});a.sort((x,y)=>x.gap-y.gap||x.i-y.i)}
      else if(gap<a[a.length-1].gap){a[a.length-1]={i,gap};a.sort((x,y)=>x.gap-y.gap||x.i-y.i)}
    }
    return a.sort((x,y)=>x.i-y.i);
  });
  const dp=[];dp[0]=cands[0].map(c=>({cost:c.gap+c.i*1e-7,prev:-1}));
  for(let si=1;si<cands.length;si++){
    dp[si]=cands[si].map(c=>{let best=null;
      for(let pi=0;pi<cands[si-1].length;pi++){const pc=cands[si-1][pi],pd=dp[si-1][pi];if(!pd||pc.i>c.i)continue;const cost=pd.cost+c.gap+(pc.i===c.i?12:0);if(!best||cost<best.cost)best={cost,prev:pi}}
      if(best)return best;
      let pi=0;for(let j=1;j<dp[si-1].length;j++)if(dp[si-1][j].cost<dp[si-1][pi].cost)pi=j;
      return{cost:dp[si-1][pi].cost+c.gap+500,prev:pi};
    });
  }
  let ci=0,last=dp.length-1;for(let j=1;j<dp[last].length;j++)if(dp[last][j].cost<dp[last][ci].cost)ci=j;
  const chosen=new Array(stops.length);for(let si=last;si>=0;si--){chosen[si]=cands[si][ci];ci=dp[si][ci]?.prev??0;if(ci<0)ci=0}
  const anchors=chosen.map((c,si)=>{const lo=Math.max(0,c.i-4),hi=Math.min(route.length-1,c.i+4),local=route.slice(lo,hi+1),n=A.nearestPointOnRoute(local,stops[si]?.coord);if(!n)return{coord:route[c.i],distance:cum[c.i],offset:c.gap,index:c.i};return{coord:n.coord,distance:cum[lo]+n.distance,offset:n.offset,index:lo+(n.index||0)}});
  d._smartPlaceStopAnchorCache={sig,anchors};return anchors;
}
function anchorForPlace(place,d,A){
  const si=stopIndexForPlace(place,d,A);if(si>=0){const a=stopAnchorMap(d,A)[si];if(a&&a.offset<300)return{...a,official:true,stopIndex:si}}
  const n=A.nearestPointOnRoute(d.ordinary,place.coord);return n?{...n,official:false}:null;
}
function bestDirection(startPlace,endPlace){
  const A=app();let best=null;if(!A?.state?.dirs)return null;
  for(const name of ['tur','retur']){
    const d=A.state.dirs[name],route=d?.ordinary;if(!route?.length||route.length<2)continue;
    const a=anchorForPlace(startPlace,d,A),b=anchorForPlace(endPlace,d,A);if(!a||!b||b.distance<=a.distance+25)continue;
    const score=a.offset+b.offset+(name===A.state.direction?-25:0)+(a.official?-55:0)+(b.official?-55:0);
    if(!best||score<best.score)best={name,d,a,b,score};
  }
  return best;
}
'''
    s=s[:pos]+replacement+s[end:]

if 'function lockRejoinBeforeLoop' not in s:
    marker='async function buildDetour(){'
    pos=s.find(marker)
    if pos<0: raise SystemExit('buildDetour anchor missing')
    helper=r'''function lockRejoinBeforeLoop(coords,end,A){
  const arr=(coords||[]).map(c=>[+c[0],+c[1]]);if(arr.length<3||!end)return{coords:arr,trimmed:false};
  const start=Math.max(1,Math.floor(arr.length*.25));let firstNear=-1,movedAway=false,tail=0;
  for(let i=start;i<arr.length;i++){
    const gap=A.hav(arr[i],end);if(firstNear<0&&gap<=60)firstNear=i;else if(firstNear>=0&&gap>=125)movedAway=true;
  }
  if(firstNear>=0)for(let i=firstNear+1;i<arr.length;i++)tail+=A.hav(arr[i-1],arr[i]);
  const trimmed=firstNear>=0&&(movedAway||tail>220);const out=trimmed?arr.slice(0,firstNear+1):arr;
  if(!out.length)return{coords:arr,trimmed:false};
  if(A.hav(out.at(-1),end)>2)out.push([+end[0],+end[1]]);else out[out.length-1]=[+end[0],+end[1]];
  return{coords:out,trimmed};
}
'''
    s=s[:pos]+helper+s[pos:]

s=s.replace('const best=bestDirection(from.coord,to.coord);','const best=bestDirection(from,to);',1)
old_assign="d.cutDistance=null;d.affected=[ia,ib];d._affDone=true;d.detour=res.coords.map(c=>[+c[0],+c[1]]);d.roadLockedRoute=[];d.freeActive=false;d.navEvents=res.events||[];d.roadMeta=res.roadMeta||[];d.routeSource=`Smart omläggning · ${from.name} → ${to.name}`;"
new_assign="const rejoin=lockRejoinBeforeLoop(res.coords,end,A);d.cutDistance=null;d.affected=[ia,ib];d._affDone=true;d.detour=rejoin.coords;d.roadLockedRoute=[];d.freeActive=false;d.navEvents=rejoin.trimmed?[]:(res.events||[]);d.roadMeta=rejoin.trimmed?[]:(res.roadMeta||[]);d.routeSource=`Smart omläggning · ${from.name} → ${to.name}`;"
if old_assign in s:
    s=s.replace(old_assign,new_assign,1)
elif 'lockRejoinBeforeLoop(res.coords,end,A)' not in s:
    raise SystemExit('detour assignment anchor missing')

p.write_text(s,encoding='utf-8')

# --- Main top search: Nordstan <-> Nils Ericsonplatsen alias ---
p=Path('index.html')
s=p.read_text(encoding='utf-8')
old="function stopSearchScore(st,q,type){const n=(st.name||'').toLowerCase(),tokens=q.toLowerCase().split(/\\s+/).filter(Boolean);if(!tokens.every(t=>n.includes(t)))return-1;let score=n===q.toLowerCase()?100:n.startsWith(q.toLowerCase())?70:40;if(type==='terminal'){if(st.locationType===1||/terminal|resecentrum|busstation/i.test(st.name))score+=80;else return-1}else if(type==='stop')score+=st.locationType===0?20:5;return score}"
new="function normStopSearch(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').replace(/[^a-z0-9\\s-]/g,' ').replace(/\\s+/g,' ').trim()}\nfunction isCentralStopAliasText(v){const n=normStopSearch(v);return n.includes('nordstan')||n.includes('nils ericson')||n.includes('nils erikson')}\nfunction mapSearchAlias(q){return isCentralStopAliasText(q)?'Nils Ericson Terminalen':q}\nfunction stopSearchScore(st,q,type){const n=normStopSearch(st.name),qq=normStopSearch(q),central=isCentralStopAliasText(qq),tokens=qq.split(/\\s+/).filter(Boolean);if(!(central?isCentralStopAliasText(n):tokens.every(t=>n.includes(t))))return-1;let score=central?140:n===qq?100:n.startsWith(qq)?70:40;if(type==='terminal'){if(st.locationType===1||/terminal|resecentrum|busstation/i.test(st.name)||isCentralStopAliasText(st.name))score+=80;else return-1}else if(type==='stop')score+=st.locationType===0?20:5;return score}"
if old in s:
    s=s.replace(old,new,1)
elif 'function isCentralStopAliasText' not in s:
    raise SystemExit('stopSearchScore anchor missing')
s=s.replace('let nq=q;','let nq=mapSearchAlias(q);',1)
old_detail="detail:'Västtrafik'+(st.code?' · '+st.code:'')"
new_detail="detail:'Västtrafik'+(st.code?' · '+st.code:'')+(isCentralStopAliasText(st.name)?' · Nordstan / Nils Ericsonplatsen':'')"
s=s.replace(old_detail,new_detail,1)
p.write_text(s,encoding='utf-8')
