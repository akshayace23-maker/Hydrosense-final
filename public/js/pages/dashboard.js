(async () => {
  await requireAuth('citizen');
  const data = await api.get('/api/reports/mine');
  const list = document.getElementById('list');

  const r = data.recognition;
  document.getElementById('badgeBox').innerHTML = `
    <div class="card" style="display:flex; align-items:center; gap:16px;">
      <div style="font-size:2rem;">🌊</div>
      <div>
        <strong>${r.badge}</strong>
        <p style="margin:2px 0 0; font-size:0.85rem;">${r.reports} report(s) filed · ${r.confirmations} "I See This Too" confirmation(s) given</p>
      </div>
    </div>`;

  if (!data.reports.length) { document.getElementById('empty').style.display = 'block'; return; }
  list.innerHTML = data.reports.map((rep) => `
    <a href="/report-detail.html?id=${rep.id}" class="card" style="text-decoration:none;">
      <span class="pill pill-${rep.status}">${statusLabel(rep.status)}</span>
      <h4 style="margin-top:10px;">${esc(rep.water_body_name || rep.water_body_name_raw || 'Unnamed water body')}</h4>
      <p class="mono" style="font-size:0.8rem;">${esc(rep.report_code)}</p>
      <p style="font-size:0.85rem;">${fmtDate(rep.created_at)}</p>
    </a>
  `).join('');
})();
