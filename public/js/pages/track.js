document.querySelectorAll('#modeTabs button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('#modeTabs button').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  document.getElementById('codeSearch').style.display = b.dataset.mode === 'code' ? 'block' : 'none';
  document.getElementById('placeSearch').style.display = b.dataset.mode === 'place' ? 'block' : 'none';
  document.getElementById('result').innerHTML = '';
}));

document.getElementById('trackBtn').addEventListener('click', search);
document.getElementById('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

async function search() {
  const code = document.getElementById('codeInput').value.trim();
  const result = document.getElementById('result');
  if (!code) return;
  try {
    const data = await api.get('/api/reports/track/' + encodeURIComponent(code));
    const r = data.report;
    result.innerHTML = `
      <div class="card">
        <span class="pill pill-${r.status}">${statusLabel(r.status)}</span>
        <h3 style="margin-top:10px;">${esc(r.water_body_name || 'Unnamed water body')}</h3>
        <p class="mono">${esc(r.report_code)}</p>
        <p>Reported ${fmtDate(r.created_at)} · Last update ${fmtDate(r.updated_at)}</p>
        <ul class="timeline" style="margin-top:16px;">
          ${data.timeline.map((t) => `<li><div class="status">${statusLabel(t.status)}</div>${t.remarks ? `<div>${t.remarks}</div>`:''}<div class="time">${fmtDate(t.created_at)}</div></li>`).join('')}
        </ul>
      </div>`;
  } catch (e) {
    result.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  }
}

let allWaterBodies = null;
document.getElementById('placeInput').addEventListener('input', async (e) => {
  if (!allWaterBodies) {
    const data = await api.get('/api/water-bodies');
    allWaterBodies = data.water_bodies;
  }
  const q = e.target.value.trim().toLowerCase();
  const box = document.getElementById('placeResults');
  if (!q) { box.innerHTML = ''; return; }
  const matches = allWaterBodies.filter((w) => w.name.toLowerCase().includes(q) || (w.address || '').toLowerCase().includes(q));
  box.innerHTML = matches.length ? matches.map((w) => `
    <a href="/waterbody.html?id=${w.id}" class="card" style="display:block; text-decoration:none; margin-top:10px;">
      <strong>${esc(w.name)}</strong> <span style="color:var(--ink-soft); font-size:0.85rem;">(${statusLabel(w.type)})</span>
      <p style="margin:4px 0 0; font-size:0.85rem;">${w.report_count} report(s) · ${w.active_count} active</p>
    </a>`).join('') : '<p style="margin-top:12px;">No matching water body found.</p>';
});
