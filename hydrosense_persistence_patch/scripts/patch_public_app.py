#!/usr/bin/env python3
"""Apply the small frontend compatibility edits to the existing public/app.js."""
from pathlib import Path

path = Path('public/app.js')
if not path.exists():
    raise SystemExit('Run this script from the HydroSense repository root (public/app.js not found).')
s = path.read_text(encoding='utf-8')
changes = [
    (
        "headers:{'X-HS-CSRF':'1'}",
        "headers:{'X-Requested-With':'HydroSense'}",
        'CSRF header expected by Express backend'
    ),
    (
        '<div class="row noprint">${stB(r.status)}${prB(r.priority)}<button class="btn ghost sm" onclick="window.print()">🖨 ${esc(t(\'print\'))}</button></div></div>\n   <div class="grid g2"',
        '<div class="row noprint">${stB(r.status)}${prB(r.priority)}${au?`<a class="btn ghost sm" href="/api/reports/${encodeURIComponent(r.code)}/pdf">⬇ PDF</a>`:\'\'}<button class="btn ghost sm" onclick="window.print()">🖨 ${esc(t(\'print\'))}</button></div></div>\n   ${r.is_demo?`<div class="card" style="margin:.8rem 0;border-color:#d99b37"><b>Historical / demonstration record</b><p class="hint">${esc(r.demo_notice||\'Imported record. Verify the current site condition before treating this status as current.\')}</p></div>`:\'\'}\n   <div class="grid g2"',
        'PDF link and historical demo-record notice'
    ),
    (
        '<span class="mono">${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}</span> ${esc(r.address||\'\')}',
        '<span class="mono">${r.lat!=null&&r.lng!=null?`${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`:esc(r.address||\'Exact GPS coordinates not supplied.\')}</span>${r.map_url?` · <a href="${esc(r.map_url)}" target="_blank" rel="noopener">Open map search</a>`:\'\'}',
        'Null-safe report coordinates and map-search link'
    ),
    (
        "const ba=['before','after'].map(k=>d.photos.filter(p=>p.kind===k));",
        "const ba=['before','after'].map(k=>d.photos.filter(p=>p.kind===k));\n  const coordText=w.lat!=null&&w.lng!=null?`${Number(w.lat).toFixed(4)}, ${Number(w.lng).toFixed(4)}`:'Exact GPS coordinates not supplied';\n  const mapUrl=(d.reports.find(r=>r.map_url)||{}).map_url;",
        'Null-safe water-body coordinates and map-search URL'
    ),
    (
        '<span class="mono">${w.lat.toFixed(4)}, ${w.lng.toFixed(4)}</span></p></div>',
        '<span class="mono">${esc(coordText)}</span>${mapUrl?` · <a href="${esc(mapUrl)}" target="_blank" rel="noopener">Open map search</a>`:\'\'}</p></div>',
        'Null-safe water-body profile coordinates'
    ),
]

applied = []
for old, new, label in changes:
    if old in s:
        count = s.count(old)
        if count != 1:
            raise SystemExit(f'Expected one match for {label}, found {count}; no file written.')
        s = s.replace(old, new, 1)
        applied.append(label)
    elif new in s:
        applied.append(label + ' (already applied)')
    else:
        raise SystemExit(f'Could not find expected source text for: {label}. No file written.')

path.write_text(s, encoding='utf-8')
print('Updated public/app.js:')
for label in applied:
    print(' - ' + label)
