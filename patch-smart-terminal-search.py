from pathlib import Path

path = Path('linne-preset-button.js')
s = path.read_text(encoding='utf-8')

if 'SMART_PLACE_TERMINAL_SEARCH_V1' in s:
    print('terminal search already patched')
    raise SystemExit(0)

s = s.replace('/* SMART_PLACE_DETOUR_V4', '/* SMART_PLACE_DETOUR_V4\n   SMART_PLACE_TERMINAL_SEARCH_V1')

needle = "function mapAliasQuery(q){return isCentralAlias(q)?'Nils Ericson Terminalen':q}\n"
insert = """function mapAliasQuery(q){return isCentralAlias(q)?'Nils Ericson Terminalen':q}\nfunction isTerminalName(v){const n=norm(v);return /terminal|busstation|bus station|resecentrum|resecenter|centralstation|knutpunkt/.test(n)}\n"""
if needle not in s:
    raise SystemExit('mapAliasQuery marker missing')
s = s.replace(needle, insert, 1)

marker = "async function mapMatches(q){"
start = s.index(marker)
end = s.index("\nasync function suggestions(q){", start)
new_block = r'''function loadedTerminalMatches(q){
  const nq=norm(q);if(!nq)return[];const toks=nq.split(' ').filter(Boolean),groups=new Map();
  for(const x of allLoadedStops()){
    const n=norm(x.name),match=isCentralAlias(nq)?isCentralStopName(n):toks.every(t=>n.includes(t));if(!match)continue;
    const key=n||x.name;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x);
  }
  const out=[];
  for(const arr of groups.values()){
    const name=arr[0]?.name||'';if(!name)continue;
    if(arr.length<2&&!isTerminalName(name)&&!isCentralStopName(name))continue;
    const coord=[arr.reduce((a,x)=>a+x.coord[0],0)/arr.length,arr.reduce((a,x)=>a+x.coord[1],0)/arr.length];
    out.push({kind:'terminal',name,detail:`Bussterminal / knutpunkt · Västtrafik · ${arr.length} hållplatsläge${arr.length===1?'':'n'} på laddad linje`,coord,official:true,terminal:true,score:isCentralStopName(name)?190:145});
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,6);
}
function classifyMapResult(x,q){
  const meta=((x.class||'')+' '+(x.type||'')+' '+(x.addresstype||'')+' '+(x.display_name||'')).toLowerCase();
  const terminal=/bus_station|bus_terminal|coach_station|transportation/.test(meta)||isTerminalName(x.display_name||'');
  const stop=!terminal&&/bus_stop|platform|public_transport|stop_position|station/.test(meta);
  return {kind:terminal?'terminal':stop?'stop':'place',name:(x.display_name||q).split(',')[0],detail:(terminal?'Bussterminal / knutpunkt · ':'')+(x.display_name||q),coord:[+x.lon,+x.lat],official:false,terminal,score:terminal?88:stop?55:30};
}
async function mapMatches(q){
  if(!q?.trim())return[];
  try{
    const base=mapAliasQuery(q).trim(),queries=[base+', Göteborg'];
    if(!/terminal|busstation|resecentrum|resecenter/i.test(base))queries.push(base+' busstation, Göteborg');
    const responses=await Promise.all(queries.map(async qq=>{
      const u='/geo/search?format=json&addressdetails=1&limit=8&countrycodes=se&q='+encodeURIComponent(qq);
      try{const r=await fetch(u,{headers:{Accept:'application/json'},cache:'no-store'});return r.ok?(await r.json()):[]}catch{return[]}
    }));
    const seen=new Set(),out=[];
    for(const x of responses.flat()){
      if(!Number.isFinite(+x.lon)||!Number.isFinite(+x.lat))continue;
      const item=classifyMapResult(x,q),k=norm(item.name)+'_'+item.coord.map(v=>v.toFixed(4)).join('_');if(seen.has(k))continue;seen.add(k);out.push(item);
    }
    return out.sort((a,b)=>b.score-a.score).slice(0,10);
  }catch{return[]}
}'''
s = s[:start] + new_block + s[end:]

old = "const local=localMatches(q),map=await mapMatches(q),seen=new Set(),out=[];\n  for(const x of [...local,...map]){"
new = "const local=localMatches(q),terminals=loadedTerminalMatches(q),map=await mapMatches(q),seen=new Set(),out=[];\n  for(const x of [...terminals,...local,...map]){"
if old not in s:
    raise SystemExit('suggestions marker missing')
s = s.replace(old, new, 1)

old = "${x.kind==='stop'?'🚏':'📍'} ${esc(x.name)}${x.official?'<span>VÄSTTRAFIK</span>':''}"
new = "${x.kind==='terminal'?'🚌':x.kind==='stop'?'🚏':'📍'} ${esc(x.name)}${x.official?'<span>VÄSTTRAFIK</span>':x.kind==='terminal'?'<span>TERMINAL</span>':''}"
if old not in s:
    raise SystemExit('render icon marker missing')
s = s.replace(old, new, 1)

s = s.replace("btn.textContent='🧭 SMART OMLÄGGNING – sök hållplats/gata';", "btn.textContent='🧭 SMART OMLÄGGNING – hållplats/gata/terminal';")
s = s.replace('Från – börja skriva, t.ex. Linnéplatsen', 'Från – sök hållplats, gata eller bussterminal')
s = s.replace('Via – sök gata/hållplats och välj träff', 'Via – sök gata, hållplats eller bussterminal och välj träff')
s = s.replace('placeholder="Linnéplatsen"', 'placeholder="Linnéplatsen, Hjalmar eller Nils Ericson Terminalen"')
s = s.replace('placeholder="Hjalmar Brantingsplatsen"', 'placeholder="Hållplats eller bussterminal"')

path.write_text(s, encoding='utf-8')
print('patched smart terminal search')
