function xmlEscape(v) {
  return String(v ?? '').replace(/[&<>'\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&apos;','\"':'&quot;'}[c]));
}

function trafikResult(json, type) {
  const r = json?.RESPONSE?.RESULT;
  if (Array.isArray(r)) return r.flatMap(x => Array.isArray(x?.[type]) ? x[type] : []);
  return Array.isArray(r?.[type]) ? r[type] : [];
}

function wktCoords(wkt) {
  if (typeof wkt !== 'string') return [];
  const nums = (wkt.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const out = [];
  for (let i=0;i+1<nums.length;i+=2) {
    const lon=nums[i], lat=nums[i+1];
    if (Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lat)<=90 && Math.abs(lon)<=180) out.push([lon,lat]);
  }
  return out;
}

function geometryCoord(g) {
  if (!g) return null;
  const wkt = g.WGS84 || g.Point || g.Line || g.Geometry?.WGS84 || '';
  const cs = wktCoords(wkt);
  if (!cs.length) return null;
  return cs[Math.floor((cs.length-1)/2)];
}

function insideBbox(coord, bbox, pad=0) {
  if (!coord || !bbox) return false;
  const [south,west,north,east]=bbox;
  const [lon,lat]=coord;
  return lat>=south-pad && lat<=north+pad && lon>=west-pad && lon<=east+pad;
}

function classifySituation(d={}) {
  const text=[d.MessageType,d.MessageTypeValue,d.MessageCode,d.MessageCodeValue,d.Header,d.Message,d.TrafficRestrictionType,d.TemporaryLimit,d.IconId].filter(Boolean).join(' ').toLowerCase();
  if (/vägarbete|maintenance|road\s?work|roadwork|resurfacing|belägg|asfalt|construction|arbete på väg|maintenanceworks/.test(text)) return 'works';
  if (/olycka|accident|roadclosed|road closed|vägen avstängd|avstäng|hinder|obstruction|fordonshaveri|brokendown|blockerad|blocked|ras|brand|fire|viltolycka/.test(text)) return 'incident';
  if (/kö|queue|congestion|framkomlighet|slow traffic|stillastående trafik|traffic jam|kövarning|begränsad framkomlighet/.test(text)) return 'congestion';
  if (/färja|ferry|kollektivtrafik|public transport|ersättningsbuss|buss/.test(text)) return 'transit';
  if ((+d.SeverityCode||0)>=4 || /restriktion|restriction|körfält|lane/.test(text)) return 'incident';
  return 'transit';
}

async function trafikverketQuery(key, queryXml) {
  const body=`<REQUEST><LOGIN authenticationkey="${xmlEscape(key)}" />${queryXml}</REQUEST>`;
  const r=await fetch('https://api.trafikinfo.trafikverket.se/v2/data.json',{
    method:'POST',
    headers:{'Content-Type':'text/xml; charset=utf-8','Accept':'application/json','User-Agent':'GMP-Korvag-Studio/8.4'},
    body
  });
  const text=await r.text();
  if(!r.ok) throw new Error(`Trafikverket ${r.status}: ${text.slice(0,180)}`);
  let json; try{json=JSON.parse(text)}catch{throw new Error('Trafikverket svarade inte med giltig JSON')}
  if(json?.RESPONSE?.ERROR) throw new Error(typeof json.RESPONSE.ERROR==='string'?json.RESPONSE.ERROR:JSON.stringify(json.RESPONSE.ERROR).slice(0,220));
  return json;
}

async function digestKey(value) {
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const proxy = async (target, extraHeaders = {}) => {
      const headers = new Headers(request.headers);
      headers.delete('host');
      headers.delete('cf-connecting-ip');
      headers.delete('cf-ipcountry');
      headers.delete('cf-ray');
      headers.delete('cf-visitor');
      for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v);
      const init = { method: request.method, headers, redirect: 'follow' };
      if (!['GET', 'HEAD'].includes(request.method)) init.body = request.body;
      const response = await fetch(target, init);
      return new Response(response.body, {status:response.status,statusText:response.statusText,headers:response.headers});
    };

    const cachedGet = async (target, extraHeaders={}, ttl=3600) => {
      const key=new Request(target.toString(),{method:'GET'}), cache=caches.default;
      const hit=await cache.match(key); if(hit) return hit;
      const headers=new Headers(extraHeaders); const upstream=await fetch(target,{headers,redirect:'follow'});
      const outHeaders=new Headers(upstream.headers); outHeaders.set('Cache-Control',`public, max-age=${ttl}, stale-while-revalidate=86400`);
      const out=new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:outHeaders});
      if(upstream.ok) ctx.waitUntil(cache.put(key,out.clone()));
      return out;
    };

    const cachedPost = async (target, body, extraHeaders={}, ttl=3600) => {
      const hash=await digestKey(target+'|'+body), cacheUrl=new URL(request.url);
      cacheUrl.pathname='/__gmp_cache/'+hash; cacheUrl.search='';
      const key=new Request(cacheUrl.toString(),{method:'GET'}), cache=caches.default;
      const hit=await cache.match(key); if(hit) return hit;
      const headers=new Headers(extraHeaders); const upstream=await fetch(target,{method:'POST',headers,body,redirect:'follow'});
      const outHeaders=new Headers(upstream.headers); outHeaders.set('Cache-Control',`public, max-age=${ttl}, stale-while-revalidate=86400`);
      const out=new Response(upstream.body,{status:upstream.status,statusText:upstream.statusText,headers:outHeaders});
      if(upstream.ok) ctx.waitUntil(cache.put(key,out.clone()));
      return out;
    };

    if (path.startsWith('/tiles/street/')) {
      const rest = path.slice('/tiles/street/'.length);
      return cachedGet(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${rest}`,{},86400);
    }

    if (path.startsWith('/tiles/sat/')) {
      const rest = path.slice('/tiles/sat/'.length);
      return cachedGet(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${rest}`,{},86400);
    }

    if (path === '/geo/search') {
      const target = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.forEach((v, k) => target.searchParams.append(k, v));
      return cachedGet(target.toString(), {'Accept':'application/json','User-Agent':'GMP-Korvag-Studio/8.8'}, 900);
    }

    if (path === '/routing-bus') {
      const target = new URL('https://valhalla1.openstreetmap.de/route');
      url.searchParams.forEach((v, k) => target.searchParams.append(k, v));
      return cachedGet(target.toString(), {'Accept':'application/json','X-Client-Id':'gmp-korvag-studio.pages.dev'}, 3600);
    }

    if (path === '/trace-attrs') {
      const target = 'https://valhalla1.openstreetmap.de/trace_attributes';
      const body=await request.clone().text();
      return cachedPost(target,body,{'Accept':'application/json','Content-Type':'application/json','X-Client-Id':'gmp-korvag-studio.pages.dev'},3600);
    }

    if (path === '/osm-busways' && request.method === 'POST') {
      let bbox = null;
      try { const body = await request.json(); if (Array.isArray(body?.bbox) && body.bbox.length === 4) { const a = body.bbox.map(Number); if (a.every(Number.isFinite)) bbox = a; } } catch {}
      if (!bbox) return new Response(JSON.stringify({elements: []}), {headers: {'content-type':'application/json'}});
      const [south, west, north, east] = bbox;
      if (north <= south || east <= west || north - south > .12 || east - west > .18) return new Response(JSON.stringify({elements: []}), {status:400, headers:{'content-type':'application/json'}});
      const b = `${south},${west},${north},${east}`;
      const q = `[out:json][timeout:18];(way[highway=busway](${b});way[highway=bus_guideway](${b});way[bus=designated](${b});way[psv=designated](${b});way["bus:lanes"](${b});way["psv:lanes"](${b});way[busway](${b}););out tags geom;`;
      const endpoints = ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
      for (const endpoint of endpoints) {
        try { const r = await cachedPost(endpoint,'data='+encodeURIComponent(q),{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','Accept':'application/json','User-Agent':'GMP-Korvag-Studio/8.8'},21600); if (r.ok) return r; } catch {}
      }
      return new Response(JSON.stringify({elements: []}), {status:200, headers:{'content-type':'application/json'}});
    }

    if (path === '/osm-road-safety' && request.method === 'POST') {
      let bbox = null;
      try { const body = await request.json(); if (Array.isArray(body?.bbox) && body.bbox.length === 4) { const a = body.bbox.map(Number); if (a.every(Number.isFinite)) bbox = a; } } catch {}
      if (!bbox) return new Response(JSON.stringify({elements: []}), {headers: {'content-type':'application/json'}});
      const [south, west, north, east] = bbox;
      if (north <= south || east <= west || north - south > .12 || east - west > .18) return new Response(JSON.stringify({elements: []}), {status:400, headers:{'content-type':'application/json'}});
      const b = `${south},${west},${north},${east}`;
      const q = `[out:json][timeout:18];(node[highway=crossing](${b});node[highway=traffic_signals](${b});node[highway=stop](${b});node[highway=give_way](${b});node[traffic_calming](${b}););out tags;`;
      const endpoints = ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
      for (const endpoint of endpoints) {
        try { const r = await cachedPost(endpoint,'data='+encodeURIComponent(q),{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','Accept':'application/json','User-Agent':'GMP-Korvag-Studio/8.8'},21600); if (r.ok) return r; } catch {}
      }
      return new Response(JSON.stringify({elements: []}), {status:200, headers:{'content-type':'application/json'}});
    }

    if (path === '/osm-way-tags' && request.method === 'POST') {
      let ids = [];
      try { const body = await request.json(); ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Number.isFinite).slice(0, 120) : []; } catch {}
      if (!ids.length) return new Response(JSON.stringify({elements: []}), {headers: {'content-type':'application/json'}});
      const q = `[out:json][timeout:15];way(id:${ids.join(',')});out tags;`;
      const endpoints = ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
      for (const endpoint of endpoints) {
        try { const r = await cachedPost(endpoint,'data='+encodeURIComponent(q),{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','Accept':'application/json','User-Agent':'GMP-Korvag-Studio/8.8'},86400); if (r.ok) return r; } catch {}
      }
      return new Response(JSON.stringify({elements: []}), {status:200, headers:{'content-type':'application/json'}});
    }

    if (path === '/api/traffic-events' && request.method === 'GET') {
      const bboxRaw = url.searchParams.get('bbox') || '';
      const bbox = bboxRaw.split(',').map(Number);
      const validBbox = bbox.length === 4 && bbox.every(Number.isFinite) && bbox[2]>bbox[0] && bbox[3]>bbox[1];
      const key = env.TRAFIKVERKET_API_KEY;
      if (!key) return new Response(JSON.stringify({ok:true,configured:false,live:false,bbox:validBbox?bbox:null,events:[],source:'trafikverket',error:'TRAFIKVERKET_API_KEY saknas'}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
      if (!validBbox) return new Response(JSON.stringify({ok:false,configured:true,live:false,events:[],source:'trafikverket',error:'Ogiltig bbox'}),{status:400,headers:{'content-type':'application/json','cache-control':'no-store'}});
      const [south,west,north,east]=bbox;
      const situationQuery=`<QUERY objecttype="Situation" schemaversion="1.5" orderby="ModifiedTime desc" limit="250"><FILTER><ELEMENTMATCH><AND><EQ name="Deviation.CountyNo" value="14" /><OR><EXISTS name="Deviation.EndTime" value="false" /><GT name="Deviation.EndTime" value="$now" /></OR></AND></ELEMENTMATCH></FILTER><INCLUDE>Id</INCLUDE><INCLUDE>ModifiedTime</INCLUDE><INCLUDE>PublicationTime</INCLUDE><INCLUDE>Deviation.Id</INCLUDE><INCLUDE>Deviation.Header</INCLUDE><INCLUDE>Deviation.Message</INCLUDE><INCLUDE>Deviation.MessageType</INCLUDE><INCLUDE>Deviation.MessageTypeValue</INCLUDE><INCLUDE>Deviation.MessageCode</INCLUDE><INCLUDE>Deviation.MessageCodeValue</INCLUDE><INCLUDE>Deviation.SeverityCode</INCLUDE><INCLUDE>Deviation.SeverityText</INCLUDE><INCLUDE>Deviation.RoadNumber</INCLUDE><INCLUDE>Deviation.LocationDescriptor</INCLUDE><INCLUDE>Deviation.StartTime</INCLUDE><INCLUDE>Deviation.EndTime</INCLUDE><INCLUDE>Deviation.IconId</INCLUDE><INCLUDE>Deviation.TrafficRestrictionType</INCLUDE><INCLUDE>Deviation.TemporaryLimit</INCLUDE><INCLUDE>Deviation.Geometry.WGS84</INCLUDE></QUERY>`;
      const flowQuery=`<QUERY objecttype="TrafficFlow" schemaversion="1.4" orderby="MeasurementTime desc" limit="500"><FILTER><EQ name="CountyNo" value="14" /></FILTER><INCLUDE>SiteId</INCLUDE><INCLUDE>MeasurementTime</INCLUDE><INCLUDE>VehicleType</INCLUDE><INCLUDE>VehicleFlowRate</INCLUDE><INCLUDE>AverageVehicleSpeed</INCLUDE><INCLUDE>SpecificLane</INCLUDE><INCLUDE>MeasurementSide</INCLUDE><INCLUDE>Geometry.WGS84</INCLUDE></QUERY>`;
      const events=[]; const errors=[]; const seen=new Set(); let situationCount=0, flowCount=0;
      try {
        const j=await trafikverketQuery(key,situationQuery), situations=trafikResult(j,'Situation'); situationCount=situations.length;
        for(const s of situations) for(const d of (Array.isArray(s?.Deviation)?s.Deviation:[])) {
          const coord=geometryCoord(d.Geometry); if(!coord || !insideBbox(coord,bbox,.004)) continue;
          const id=String(d.Id||s.Id||`${coord[0]},${coord[1]}`); if(seen.has(id))continue; seen.add(id);
          const type=classifySituation(d), road=d.RoadNumber?`Väg ${d.RoadNumber}`:'', loc=d.LocationDescriptor||'';
          const title=d.Header||d.MessageCode||d.MessageType||'Trafikhändelse';
          const detail=[road,loc,d.Message,d.TrafficRestrictionType,d.TemporaryLimit,d.SeverityText].filter(Boolean).join(' · ');
          events.push({id:`sit:${id}`,type,coord,title,text:detail,severity:+d.SeverityCode||0,start:d.StartTime||null,end:d.EndTime||null,source:'Trafikverket Situation'});
        }
      } catch(e){ errors.push(String(e?.message||e)); }
      try {
        const j=await trafikverketQuery(key,flowQuery), flows=trafikResult(j,'TrafficFlow'); flowCount=flows.length; const bySite=new Map();
        for(const f of flows){ const coord=geometryCoord(f.Geometry); if(!coord || !insideBbox(coord,bbox,.002))continue; const speed=+f.AverageVehicleSpeed, rate=+f.VehicleFlowRate; if(!Number.isFinite(speed) || speed>28 || (Number.isFinite(rate)&&rate<80))continue; const site=String(f.SiteId||`${coord[0]},${coord[1]}`), prev=bySite.get(site); if(prev && String(prev.MeasurementTime||'')>=String(f.MeasurementTime||''))continue; bySite.set(site,{...f,coord}); }
        for(const [site,f] of bySite){ const speed=Math.max(0,+f.AverageVehicleSpeed||0),rate=+f.VehicleFlowRate||0; events.push({id:`flow:${site}`,type:'congestion',coord:f.coord,title:speed<12?'Mycket långsam trafik':'Långsam trafik',text:`${Math.round(speed)} km/h${rate?` · ca ${Math.round(rate)} fordon/h`:''}`,severity:speed<12?4:2,start:f.MeasurementTime||null,end:null,source:'Trafikverket TrafficFlow'}); }
      } catch(e){ errors.push(String(e?.message||e)); }
      events.sort((a,b)=>(b.severity||0)-(a.severity||0)); const live=errors.length<2;
      return new Response(JSON.stringify({ok:live||events.length>0,configured:true,live,bbox:[south,west,north,east],events,source:'trafikverket',stats:{situations:situationCount,trafficFlow:flowCount,returned:events.length},errors}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
    }

    if (path.startsWith('/routing/')) {
      const rest = path.slice('/routing/'.length), target = new URL(`https://router.project-osrm.org/${rest}`);
      url.searchParams.forEach((v, k) => target.searchParams.append(k, v));
      return cachedGet(target.toString(), {'Accept':'application/json'}, 3600);
    }

    if (path === '/gtfs/vt.zip') {
      const target = new URL('https://opendata.samtrafiken.se/gtfs/vt/vt.zip');
      url.searchParams.forEach((v, k) => target.searchParams.append(k, v));
      return proxy(target.toString(), {'Accept':'application/zip','Accept-Encoding':'gzip, deflate'});
    }

    const asset=await env.ASSETS.fetch(request);
    if(request.method==='GET' && asset.ok && (path==='/' || path==='/index.html')){
      let html=await asset.text();
      html=html.replace('<title>GMP Körväg Studio V8.7 3D SATELLIT FIX</title>','<title>GMP Körväg Studio V8.11 OMLÄGGNING FIX</title>');
      html=html.replace('z=state.zoom,margin=2,','z=state.zoom,margin=1,');
      html=html.replace("function renderAll(){applyVisibility();renderMap();updateSummary();renderStopManager();renderDetourWorkflowState();renderTrafficStudioStatus();renderTrafficStudioPlayback();scheduleTrafficRefresh()}","function renderAll(){applyVisibility();renderMap();const later=()=>{updateSummary();renderStopManager();renderDetourWorkflowState();renderTrafficStudioStatus();renderTrafficStudioPlayback();scheduleTrafficRefresh()};if('requestIdleCallback' in window)requestIdleCallback(later,{timeout:220});else setTimeout(later,0)}");
      html=html.replace("async function osrmRoute(points){if(points.length<2)throw new Error('Minst två punkter krävs');const coords=points.map(c=>c[0].toFixed(6)+','+c[1].toFixed(6)).join(';');const url='/routing/route/v1/driving/'+coords+'?overview=full&geometries=geojson&steps=false&continue_straight=false';const r=await fetch(url);if(!r.ok)throw new Error('Ruttjänsten svarade '+r.status);const j=await r.json();if(!j.routes?.[0]?.geometry?.coordinates)throw new Error('Ingen körbar väg hittades');const out=j.routes[0].geometry.coordinates;let roadMeta=[];try{roadMeta=await traceRoadAttributes(out)}catch{}if(hasFerry(roadMeta))throw new Error('Reservrutten innehåller färja/vattenpassage');return{coords:out,events:[],roadMeta,source:'Reservrouting (bilprofil)'}}","async function osrmRoute(points){if(points.length<2)throw new Error('Minst två punkter krävs');const coords=points.map(c=>c[0].toFixed(6)+','+c[1].toFixed(6)).join(';');const url='/routing/route/v1/driving/'+coords+'?overview=full&geometries=geojson&steps=false&continue_straight=false';const r=await fetch(url);if(!r.ok)throw new Error('Ruttjänsten svarade '+r.status);const j=await r.json();if(!j.routes?.[0]?.geometry?.coordinates)throw new Error('Ingen körbar väg hittades');return{coords:j.routes[0].geometry.coordinates,events:[],roadMeta:[],source:'Reservrouting (bilprofil)'}}");
      html=html.replace("let roadMeta=[];try{roadMeta=await traceRoadAttributes(coords)}catch(e){console.warn(e)}if(hasFerry(roadMeta))throw new Error('Rutten innehåller färja/vattenpassage och godkänns inte som busskörväg');return{coords,events,roadMeta,source:'BUSS-routing (OSM/Valhalla)'}","return{coords,events,roadMeta:[],source:'BUSS-routing (OSM/Valhalla)'}");
      html=html.replace("const meta=await traceRoadAttributes(raw),coords=meta.matchedRoute?.length>1?meta.matchedRoute:raw;if(hasFerry(meta))return null;\n  return{coords,events:[],roadMeta:meta,source:'Västtrafik linjespår + bussvägnät (GTFS/OSM)'};","return{coords:raw,events:[],roadMeta:[],source:'Västtrafik linjespår (GTFS)'};");
      html=html.replace("d.routeSource=res.source||'';d.freeActive=false;state.driveRoute=null;fitCoords(d.route);toast((res.source||'Körvägen')+' är klar. Bussgator används när kartdatan tillåter bussaccess.',4200)","d.routeSource=res.source||'';d.freeActive=false;state.driveRoute=null;fitCoords(d.route);if(!d.roadMeta.length)setTimeout(()=>enrichDirRoadMeta(d,d.route),0);toast((res.source||'Körvägen')+' är klar. Vägdata kompletteras i bakgrunden.',3000)");
      html=html.replace("setTimeout(()=>scheduleTrafficRefresh(true),1600)","setTimeout(()=>scheduleTrafficRefresh(true),4500)");
      html=html.replace("toast('V8.6 MAP-ONLY REC – API, live trafik och kartinspelning klara.',5200)","toast('V8.10 AUTO OMLÄGGNING – smart ritning och fem automatiska körvägsförslag.',3000)");

      html=html.replace("function beginDetourDraw(){ensureEditableRouteMap();const d=dir();if(d.ordinary.length<2)return toast('Hämta eller sätt först en ordinarie linje.');if(!Number.isFinite(d.cutDistance)&&!(d.affected&&d._affDone))return toast('Välj först “Avbryt ordinarie linje här” eller markera två anslutningspunkter.');setTool('detour')}","function beginDetourDraw(){ensureEditableRouteMap();const d=dir();if(d.ordinary.length<2)return toast('Hämta eller sätt först en ordinarie linje.');if(!Number.isFinite(d.cutDistance)&&!(d.affected&&d._affDone))toast('Rita direkt från den del av linjen där omläggningen börjar. Jag hittar närmaste Tur/Retur, rätt riktning och nästa återanslutning automatiskt.',5200);setTool('detour')}");
      html=html.replace("el.innerHTML='<b>Ordinarie linje klar.</b><span>Välj “Avbryt ordinarie linje här” för att stoppa mitt i turen, eller “Omläggning mellan 2 punkter” för att återansluta senare.</span>'","el.innerHTML='<b>Ordinarie linje klar.</b><span>Tryck “Rita ny körväg” och börja ungefär där omläggningen startar. Systemet hittar automatiskt närmaste Tur/Retur, rätt färdriktning och återanslutning framåt. Manuella brytpunkter finns kvar om du vill styra exakt.</span>'");
      html=html.replace("detour:'Dra för att rita omläggning. Håll MELLANSLAG om du behöver flytta kartan mitt i arbetet.'","detour:'Börja rita ungefär på ordinarie linje och följ den väg du vill köra. Starten snappar till närmaste rätt Tur/Retur och slutet kopplas framåt mot linjen eller nästa relevanta hållplats. Håll MELLANSLAG för att flytta kartan.'");
      html=html.replace("async function snapDetour(raw){\n  toast('Låser omläggningen till körbart bussvägnät…',5000);\n  const d=dir();\n  try{","function detourAutoAnchor(raw){\n  if(!raw?.length)return null;\n  const startRaw=raw[0],tail=raw.slice(Math.max(1,Math.floor(raw.length*.45)));\n  const probe=raw.find(c=>hav(startRaw,c)>18)||raw.at(-1)||startRaw;\n  const drawBearing=probe&&hav(startRaw,probe)>3?bearing(startRaw,probe):null;\n  const idxAt=(route,dist)=>{let cum=0;for(let i=1;i<route.length;i++){const seg=hav(route[i-1],route[i]);if(cum+seg>=dist)return(dist-cum)<seg*.5?i-1:i;cum+=seg}return Math.max(0,route.length-1)};\n  let best=null;\n  for(const name of ['tur','retur']){\n    const dd=state.dirs[name],route=dd?.ordinary;if(!route?.length||route.length<2)continue;\n    const start=nearestPointOnRoute(route,startRaw);if(!start||start.offset>220)continue;\n    let endHint=null;\n    for(const c of tail){const n=nearestPointOnRoute(route,c);if(!n||n.offset>240||n.distance<=start.distance+25)continue;const s=n.offset-Math.min(45,(n.distance-start.distance)*.012);if(!endHint||s<endHint.score-3||(Math.abs(s-endHint.score)<=3&&n.distance>endHint.n.distance))endHint={n,score:s}}\n    const before=pointAtDistance(route,Math.max(0,start.distance-14)),after=pointAtDistance(route,Math.min(routeLength(route),start.distance+14));\n    const routeBearing=before&&after?bearing(before,after):0,headingPenalty=drawBearing==null?0:Math.min(95,Math.abs(angleDelta(routeBearing,drawBearing)))*.35;\n    const score=start.offset+headingPenalty+(endHint?-45:55)+(name===state.direction?-8:0);\n    if(!best||score<best.score)best={name,start,endHint,score};\n  }\n  if(!best)return null;\n  if(state.direction!==best.name)setDirection(best.name);\n  const d=state.dirs[best.name],route=d.ordinary,start=nearestPointOnRoute(route,startRaw);if(!start)return null;\n  const target=best.endHint?.n?.distance??Math.min(routeLength(route),start.distance+Math.max(90,Math.min(900,routeLength(raw)*.65)));\n  const stop=nextStopRejoinTarget(d,start.distance,target,raw.at(-1));\n  const endDistance=stop?.distance??best.endHint?.n?.distance??target,endCoord=stop?.coord??best.endHint?.n?.coord??pointAtDistance(route,endDistance);\n  if(!endCoord||endDistance<=start.distance+25)return null;\n  return{startCoord:start.coord,startDistance:start.distance,startIndex:idxAt(route,start.distance),endCoord,endDistance,endIndex:idxAt(route,endDistance),rejoinName:stop?.name||'närmaste framåtriktade linjepunkt'};\n}\nasync function snapDetour(raw){\n  toast('Låser omläggningen till körbart bussvägnät…',5000);\n  let d=dir();\n  try{\n    if(d.ordinary?.length>1&&!Number.isFinite(d.cutDistance)&&!(d.affected&&d._affDone)){\n      const auto=detourAutoAnchor(raw);if(!auto)throw new Error('börja ritningen närmare den ordinarie linjen');\n      d=dir();d.cutDistance=null;d.affected=[auto.startIndex,auto.endIndex];d._affDone=true;\n      if(raw.length>1)raw=[auto.startCoord,...raw.slice(1,-1),auto.endCoord];\n      toast('Kopplad automatiskt till '+(state.direction==='retur'?'Retur':'Tur')+' · återanslutning: '+auto.rejoinName+'.',3600);\n    }");
      // Detour scripts are embedded directly in index.html (GMP_DETOUR_STATIC_BOOTSTRAP_V1).

      const headers=new Headers(asset.headers);headers.set('content-type','text/html; charset=utf-8');headers.set('cache-control','no-cache');
      return new Response(html,{status:asset.status,statusText:asset.statusText,headers});
    }
    if(asset.ok && /\.(glb|png|jpg|jpeg|webp|svg|woff2?)$/i.test(path)){
      const headers=new Headers(asset.headers);headers.set('cache-control','public, max-age=604800, immutable');return new Response(asset.body,{status:asset.status,statusText:asset.statusText,headers});
    }
    return asset;
  }
};