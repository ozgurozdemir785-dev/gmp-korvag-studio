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

export default {
  async fetch(request, env) {
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
      const init = {
        method: request.method,
        headers,
        redirect: 'follow'
      };
      if (!['GET', 'HEAD'].includes(request.method)) init.body = request.body;
      const response = await fetch(target, init);
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    };

    if (path.startsWith('/tiles/street/')) {
      const rest = path.slice('/tiles/street/'.length);
      return proxy(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${rest}`);
    }

    if (path.startsWith('/tiles/sat/')) {
      const rest = path.slice('/tiles/sat/'.length);
      return proxy(`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${rest}`);
    }

    if (path === '/geo/search') {
      const target = new URL('https://nominatim.openstreetmap.org/search');
      url.searchParams.forEach((v, k) => target.searchParams.append(k, v));
      return proxy(target.toString(), {
        'Accept': 'application/json',
        'User-Agent': 'GMP-Korvag-Studio/8.0'
      });
    }


    if (path === '/routing-bus') {
      const target = new URL('https://valhalla1.openstreetmap.de/route');
      url.searchParams.forEach((v, k) => target.searchParams.append(k, v));
      return proxy(target.toString(), {
        'Accept': 'application/json',
        'X-Client-Id': 'gmp-korvag-studio.pages.dev'
      });
    }

    if (path === '/trace-attrs') {
      const target = new URL('https://valhalla1.openstreetmap.de/trace_attributes');
      return proxy(target.toString(), {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'X-Client-Id': 'gmp-korvag-studio.pages.dev'
      });
    }

    if (path === '/osm-busways' && request.method === 'POST') {
      let bbox = null;
      try {
        const body = await request.json();
        if (Array.isArray(body?.bbox) && body.bbox.length === 4) {
          const a = body.bbox.map(Number);
          if (a.every(Number.isFinite)) bbox = a;
        }
      } catch {}
      if (!bbox) return new Response(JSON.stringify({elements: []}), {headers: {'content-type':'application/json'}});
      const [south, west, north, east] = bbox;
      if (north <= south || east <= west || north - south > .12 || east - west > .18) {
        return new Response(JSON.stringify({elements: []}), {status:400, headers:{'content-type':'application/json'}});
      }
      const b = `${south},${west},${north},${east}`;
      const q = `[out:json][timeout:18];(way[highway=busway](${b});way[highway=bus_guideway](${b});way[bus=designated](${b});way[psv=designated](${b});way["bus:lanes"](${b});way["psv:lanes"](${b});way[busway](${b}););out tags geom;`;
      const endpoints = ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
      for (const endpoint of endpoints) {
        try {
          const r = await fetch(endpoint, {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','Accept':'application/json','User-Agent':'GMP-Korvag-Studio/8.0'},body:'data='+encodeURIComponent(q)});
          if (r.ok) return new Response(r.body,{status:r.status,headers:{'content-type':'application/json','cache-control':'public, max-age=21600'}});
        } catch {}
      }
      return new Response(JSON.stringify({elements: []}), {status:200, headers:{'content-type':'application/json'}});
    }

    if (path === '/osm-road-safety' && request.method === 'POST') {
      let bbox = null;
      try {
        const body = await request.json();
        if (Array.isArray(body?.bbox) && body.bbox.length === 4) {
          const a = body.bbox.map(Number);
          if (a.every(Number.isFinite)) bbox = a;
        }
      } catch {}
      if (!bbox) return new Response(JSON.stringify({elements: []}), {headers: {'content-type':'application/json'}});
      const [south, west, north, east] = bbox;
      if (north <= south || east <= west || north - south > .12 || east - west > .18) {
        return new Response(JSON.stringify({elements: []}), {status:400, headers:{'content-type':'application/json'}});
      }
      const b = `${south},${west},${north},${east}`;
      const q = `[out:json][timeout:18];(node[highway=crossing](${b});node[highway=traffic_signals](${b});node[highway=stop](${b});node[highway=give_way](${b});node[traffic_calming](${b}););out tags;`;
      const endpoints = ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
      for (const endpoint of endpoints) {
        try {
          const r = await fetch(endpoint, {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','Accept':'application/json','User-Agent':'GMP-Korvag-Studio/8.0'},body:'data='+encodeURIComponent(q)});
          if (r.ok) return new Response(r.body,{status:r.status,headers:{'content-type':'application/json','cache-control':'public, max-age=21600'}});
        } catch {}
      }
      return new Response(JSON.stringify({elements: []}), {status:200, headers:{'content-type':'application/json'}});
    }

    if (path === '/osm-way-tags' && request.method === 'POST') {
      let ids = [];
      try {
        const body = await request.json();
        ids = Array.isArray(body?.ids) ? body.ids.map(Number).filter(Number.isFinite).slice(0, 120) : [];
      } catch {}
      if (!ids.length) return new Response(JSON.stringify({elements: []}), {headers: {'content-type':'application/json'}});
      const q = `[out:json][timeout:15];way(id:${ids.join(',')});out tags;`;
      const endpoints = ['https://overpass-api.de/api/interpreter','https://overpass.kumi.systems/api/interpreter'];
      for (const endpoint of endpoints) {
        try {
          const r = await fetch(endpoint, {method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8','Accept':'application/json','User-Agent':'GMP-Korvag-Studio/8.0'},body:'data='+encodeURIComponent(q)});
          if (r.ok) return new Response(r.body,{status:r.status,headers:{'content-type':'application/json','cache-control':'public, max-age=86400'}});
        } catch {}
      }
      return new Response(JSON.stringify({elements: []}), {status:200, headers:{'content-type':'application/json'}});
    }

    if (path === '/api/traffic-events' && request.method === 'GET') {
      const bboxRaw = url.searchParams.get('bbox') || '';
      const bbox = bboxRaw.split(',').map(Number);
      const validBbox = bbox.length === 4 && bbox.every(Number.isFinite) && bbox[2]>bbox[0] && bbox[3]>bbox[1];
      const key = env.TRAFIKVERKET_API_KEY;
      if (!key) {
        return new Response(JSON.stringify({ok:true,configured:false,live:false,bbox:validBbox?bbox:null,events:[],source:'trafikverket',error:'TRAFIKVERKET_API_KEY saknas'}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
      }
      if (!validBbox) {
        return new Response(JSON.stringify({ok:false,configured:true,live:false,events:[],source:'trafikverket',error:'Ogiltig bbox'}),{status:400,headers:{'content-type':'application/json','cache-control':'no-store'}});
      }
      const [south,west,north,east]=bbox;
      // GMP används i Göteborg/Mölndal/Partille. CountyNo 14 håller frågan liten och snabb,
      // sedan filtrerar vi exakt mot den aktiva ruttens bbox i Worker + webbläsare.
      const situationQuery=`<QUERY objecttype="Situation" schemaversion="1.5" orderby="ModifiedTime desc" limit="250">
        <FILTER><ELEMENTMATCH><AND><EQ name="Deviation.CountyNo" value="14" /><OR><EXISTS name="Deviation.EndTime" value="false" /><GT name="Deviation.EndTime" value="$now" /></OR></AND></ELEMENTMATCH></FILTER>
        <INCLUDE>Id</INCLUDE><INCLUDE>ModifiedTime</INCLUDE><INCLUDE>PublicationTime</INCLUDE>
        <INCLUDE>Deviation.Id</INCLUDE><INCLUDE>Deviation.Header</INCLUDE><INCLUDE>Deviation.Message</INCLUDE>
        <INCLUDE>Deviation.MessageType</INCLUDE><INCLUDE>Deviation.MessageTypeValue</INCLUDE>
        <INCLUDE>Deviation.MessageCode</INCLUDE><INCLUDE>Deviation.MessageCodeValue</INCLUDE>
        <INCLUDE>Deviation.SeverityCode</INCLUDE><INCLUDE>Deviation.SeverityText</INCLUDE>
        <INCLUDE>Deviation.RoadNumber</INCLUDE><INCLUDE>Deviation.LocationDescriptor</INCLUDE>
        <INCLUDE>Deviation.StartTime</INCLUDE><INCLUDE>Deviation.EndTime</INCLUDE><INCLUDE>Deviation.IconId</INCLUDE>
        <INCLUDE>Deviation.TrafficRestrictionType</INCLUDE><INCLUDE>Deviation.TemporaryLimit</INCLUDE>
        <INCLUDE>Deviation.Geometry.WGS84</INCLUDE>
      </QUERY>`;
      const flowQuery=`<QUERY objecttype="TrafficFlow" schemaversion="1.4" orderby="MeasurementTime desc" limit="500">
        <FILTER><EQ name="CountyNo" value="14" /></FILTER>
        <INCLUDE>SiteId</INCLUDE><INCLUDE>MeasurementTime</INCLUDE><INCLUDE>VehicleType</INCLUDE>
        <INCLUDE>VehicleFlowRate</INCLUDE><INCLUDE>AverageVehicleSpeed</INCLUDE><INCLUDE>SpecificLane</INCLUDE>
        <INCLUDE>MeasurementSide</INCLUDE><INCLUDE>Geometry.WGS84</INCLUDE>
      </QUERY>`;
      const events=[]; const errors=[]; const seen=new Set(); let situationCount=0, flowCount=0;
      try {
        const j=await trafikverketQuery(key,situationQuery);
        const situations=trafikResult(j,'Situation'); situationCount=situations.length;
        for(const s of situations){
          for(const d of (Array.isArray(s?.Deviation)?s.Deviation:[])){
            const coord=geometryCoord(d.Geometry);
            if(!coord || !insideBbox(coord,bbox,.004)) continue;
            const id=String(d.Id||s.Id||`${coord[0]},${coord[1]}`); if(seen.has(id))continue; seen.add(id);
            const type=classifySituation(d), road=d.RoadNumber?`Väg ${d.RoadNumber}`:'', loc=d.LocationDescriptor||'';
            const title=d.Header||d.MessageCode||d.MessageType||'Trafikhändelse';
            const detail=[road,loc,d.Message,d.TrafficRestrictionType,d.TemporaryLimit,d.SeverityText].filter(Boolean).join(' · ');
            events.push({id:`sit:${id}`,type,coord,title,text:detail,severity:+d.SeverityCode||0,start:d.StartTime||null,end:d.EndTime||null,source:'Trafikverket Situation'});
          }
        }
      } catch(e){ errors.push(String(e?.message||e)); }
      // TrafikFlow är mätpunkter, inte incidenter. Visa bara tydligt långsam trafik så kartan inte fylls av gula punkter.
      try {
        const j=await trafikverketQuery(key,flowQuery);
        const flows=trafikResult(j,'TrafficFlow'); flowCount=flows.length;
        const bySite=new Map();
        for(const f of flows){
          const coord=geometryCoord(f.Geometry); if(!coord || !insideBbox(coord,bbox,.002))continue;
          const speed=+f.AverageVehicleSpeed, rate=+f.VehicleFlowRate;
          if(!Number.isFinite(speed) || speed>28 || (Number.isFinite(rate)&&rate<80))continue;
          const site=String(f.SiteId||`${coord[0]},${coord[1]}`); const prev=bySite.get(site);
          if(prev && String(prev.MeasurementTime||'')>=String(f.MeasurementTime||''))continue;
          bySite.set(site,{...f,coord});
        }
        for(const [site,f] of bySite){
          const speed=Math.max(0,+f.AverageVehicleSpeed||0),rate=+f.VehicleFlowRate||0;
          events.push({id:`flow:${site}`,type:'congestion',coord:f.coord,title:speed<12?'Mycket långsam trafik':'Långsam trafik',text:`${Math.round(speed)} km/h${rate?` · ca ${Math.round(rate)} fordon/h`:''}`,severity:speed<12?4:2,start:f.MeasurementTime||null,end:null,source:'Trafikverket TrafficFlow'});
        }
      } catch(e){ errors.push(String(e?.message||e)); }
      events.sort((a,b)=>(b.severity||0)-(a.severity||0));
      const live=errors.length<2; // Situation räcker för live-läge även om TrafficFlow saknas tillfälligt.
      return new Response(JSON.stringify({ok:live||events.length>0,configured:true,live,bbox:[south,west,north,east],events,source:'trafikverket',stats:{situations:situationCount,trafficFlow:flowCount,returned:events.length},errors}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
    }

    if (path.startsWith('/routing/')) {
      const rest = path.slice('/routing/'.length);
      const target = new URL(`https://router.project-osrm.org/${rest}`);
      url.searchParams.forEach((v, k) => target.searchParams.append(k, v));
      return proxy(target.toString(), { 'Accept': 'application/json' });
    }

    if (path === '/gtfs/vt.zip') {
      const target = new URL('https://opendata.samtrafiken.se/gtfs/vt/vt.zip');
      url.searchParams.forEach((v, k) => target.searchParams.append(k, v));
      return proxy(target.toString(), {
        'Accept': 'application/zip',
        'Accept-Encoding': 'gzip, deflate'
      });
    }

    return env.ASSETS.fetch(request);
  }
};
