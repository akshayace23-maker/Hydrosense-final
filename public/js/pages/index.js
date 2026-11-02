// Landing page: real, live headline numbers (all zero until real reports exist — nothing is invented).
(async function () {
  const box = document.getElementById('heroStats');
  try {
    const s = await api.get('/api/reports/public-stats');
    const items = [
      [s.reports, 'Reports filed'], [s.water_bodies, 'Water bodies'], [s.active, 'Active issues'], [s.resolved, 'Resolved'],
    ];
    box.innerHTML = items.map(([n, l]) => `<div><b>${esc(n)}</b><span>${l}</span></div>`).join('');
  } catch (e) { box.innerHTML = ''; }
})();
