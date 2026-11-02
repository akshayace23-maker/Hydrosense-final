(async () => {
  const { water_bodies } = await api.get('/api/water-bodies');
  if (!water_bodies.length) { document.getElementById('empty').style.display = 'block'; return; }
  document.getElementById('list').innerHTML = water_bodies.map((w) => `
    <a href="/waterbody.html?id=${w.id}" class="card" style="text-decoration:none;">
      <span class="eyebrow">${statusLabel(w.type)}</span>
      <h4>${esc(w.name)}</h4>
      <p style="font-size:0.85rem;">${esc(w.address || 'Location on file')}</p>
      <p style="font-size:0.85rem; margin-top:8px;"><strong>${w.report_count}</strong> report(s) · <strong>${w.active_count}</strong> active</p>
    </a>
  `).join('');
})();
