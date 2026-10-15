from pathlib import Path

p = Path('_worker.js')
s = p.read_text(encoding='utf-8')

if '/active-detour.js?v=1' in s:
    print('active-detour.js is already injected')
    raise SystemExit(0)

old = "html=html.replace('</body>','<script src=\"/detour-search.js?v=1\"></script></body>');"
new = "html=html.replace('</body>','<script src=\"/detour-search.js?v=1\"></script><script src=\"/active-detour.js?v=1\"></script></body>');"

if old not in s:
    raise SystemExit('Could not find detour-search script injection in _worker.js')

s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('Injected active-detour.js after detour-search.js')
