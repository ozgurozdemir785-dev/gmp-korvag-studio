from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')
marker = 'GMP_2D_MAP_2026_OSM_V1'

if marker not in s:
    old = """function tileUrl(z,x,y){
  const n=2**z,xx=((x%n)+n)%n,yy=Math.max(0,Math.min(n-1,y));
  // V5.8: edit maps load directly from Esri so 2D/Satellite drawing works even if a Cloudflare proxy route is unavailable.
  const service=state.mapMode==='sat'?'World_Imagery':'World_Street_Map';
  return `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/${z}/${yy}/${xx}`;
}"""
    new = """/* GMP_2D_MAP_2026_OSM_V1
   2D uses the current OpenStreetMap standard basemap.
   Satellite remains on Esri World Imagery. */
function tileUrl(z,x,y){
  const n=2**z,xx=((x%n)+n)%n,yy=Math.max(0,Math.min(n-1,y));
  if(state.mapMode==='2d')return `https://tile.openstreetmap.org/${z}/${xx}/${yy}.png`;
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${yy}/${xx}`;
}"""
    if old not in s:
        raise SystemExit('tileUrl block not found')
    s = s.replace(old, new)

    s = s.replace(
        '<div id="attrib" class="attrib">Karta © Esri</div>',
        '<div id="attrib" class="attrib">2D 2026 · © OpenStreetMap contributors</div>'
    )
    s = s.replace(
        "$('attrib').textContent=state.mapMode==='sat'?'Satellit © Esri, Maxar, Earthstar Geographics':'Karta © Esri'",
        "$('attrib').textContent=state.mapMode==='sat'?'Satellit © Esri, Maxar, Earthstar Geographics':'2D 2026 · © OpenStreetMap contributors'"
    )

    old_zoom = "const nz=Math.max(3,Math.min(20,state.zoom+(delta>0?1:-1)));"
    new_zoom = "const maxZoom=state.mapMode==='2d'?19:20;const nz=Math.max(3,Math.min(maxZoom,state.zoom+(delta>0?1:-1)));"
    if old_zoom in s:
        s = s.replace(old_zoom, new_zoom)

    old_mode = "state.mapMode=mode;\n  state.camera='overview';"
    new_mode = "state.mapMode=mode;\n  if(mode==='2d'&&state.zoom>19)state.zoom=19;\n  state.camera='overview';"
    if old_mode in s:
        s = s.replace(old_mode, new_mode, 1)

    old_err = """img.onload=settled;img.src=tileUrl(z,tx,ty);img.onerror=()=>{
       if(!img.dataset.retry){img.dataset.retry='1';img.src=img.src.replace('server.arcgisonline.com','services.arcgisonline.com');return}
       img.style.visibility='hidden';settled();
     };"""
    new_err = """img.onload=settled;img.src=tileUrl(z,tx,ty);img.onerror=()=>{
       if(!img.dataset.retry){
         img.dataset.retry='1';
         if(state.mapMode==='2d'){
           const n=2**z,xx=((tx%n)+n)%n,yy=Math.max(0,Math.min(n-1,ty));
           img.src=`https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${yy}/${xx}`;
         }else img.src=img.src.replace('server.arcgisonline.com','services.arcgisonline.com');
         return;
       }
       img.style.visibility='hidden';settled();
     };"""
    if old_err in s:
        s = s.replace(old_err, new_err)

    s = s.replace(
        '<title>GMP Körväg Studio V8.7 3D SATELLIT FIX</title>',
        '<title>GMP Körväg Studio V8.12 · 2D 2026</title>'
    )
    s = s.replace(
        '<span>V8.7 3D FIX – API + kameraregissör</span>',
        '<span>V8.12 · 2D 2026 + 3D</span>'
    )

    p.write_text(s, encoding='utf-8')
    print('2D 2026 map patch applied')
else:
    print('2D 2026 map patch already present')
