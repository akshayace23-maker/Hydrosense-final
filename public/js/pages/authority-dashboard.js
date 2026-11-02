const STATUS_FLOW = ['submitted','under_review','verified','inspection_assigned','field_inspection','action_planned','action_taken','follow_up_required','resolved','reopened','rejected'];
document.getElementById('fStatus').innerHTML += STATUS_FLOW.map((s) => `<option value="${s}">${statusLabel(s)}</option>`).join('');

async function loadStats() {
  const s = await api.get('/api/reports/stats/summary');
  const pending = s.byStatus.filter((x) => !['resolved','rejected'].includes(x.status)).reduce((a,b) => a+b.n, 0);
  const resolved = (s.byStatus.find((x) => x.status === 'resolved') || {}).n || 0;
  document.getElementById('statCards').innerHTML = `
    <div class="stat-card"><div class="value">${s.total}</div><div class="label">Total reports</div></div>
    <div class="stat-card"><div class="value">${pending}</div><div class="label">Open / pending</div></div>
    <div class="stat-card"><div class="value">${resolved}</div><div class="label">Resolved</div></div>
    <div class="stat-card"><div class="value">${s.byDay.reduce((a,b)=>a+b.n,0)}</div><div class="label">Last 30 days</div></div>
  `;

  document.getElementById('chartByDay').innerHTML = svgBarChart(
    s.byDay.slice(-10).map((d) => ({ label: d.d.slice(5).split('-').reverse().join('-'), value: d.n })),
    { color: 'var(--sky)' }
  );
  document.getElementById('chartByStatus').innerHTML = svgBarChart(
    s.byStatus.map((d) => ({ label: statusLabel(d.status), value: d.n })),
    { color: 'var(--accent)' }
  );
  document.getElementById('chartByCategory').innerHTML = svgBarChart(
    Object.entries(s.categories).map(([k,v]) => ({ label: statusLabel(k), value: v })),
    { color: 'var(--teal)' }
  );
}

async function loadAlerts() {
  const { alerts } = await api.get('/api/reports/alerts');
  const panel = document.getElementById('alertsPanel');
  if (!alerts.length) { panel.innerHTML = ''; return; }
  panel.innerHTML = `
    <div class="card" style="border-color:var(--danger);">
      <h4>⚠️ Alerts — open high/critical priority reports</h4>
      ${alerts.map((a) => `
        <a href="/report-detail.html?id=${a.id}" style="display:flex; justify-content:space-between; text-decoration:none; padding:8px 0; border-bottom:1px solid var(--line);">
          <span><span class="pill pill-priority-${a.priority}">${a.level}</span> <strong style="margin-left:8px;">${esc(a.water_body_name || 'Unnamed water body')}</strong> <span class="mono" style="font-size:0.8rem;">${a.report_code}</span></span>
          <span style="color:var(--ink-soft); font-size:0.85rem;">${esc(a.reason)}</span>
        </a>`).join('')}
    </div>`;
}

async function loadReports() {
  const params = new URLSearchParams();
  if (document.getElementById('fStatus').value) params.set('status', document.getElementById('fStatus').value);
  if (document.getElementById('fPriority').value) params.set('priority', document.getElementById('fPriority').value);
  const data = await api.get('/api/reports?' + params.toString());
  document.getElementById('reportList').innerHTML = data.reports.map((r) => `
    <a href="/report-detail.html?id=${r.id}" class="card" style="display:flex; justify-content:space-between; align-items:center; text-decoration:none; margin-bottom:10px;">
      <div>
        <span class="pill pill-${r.status}">${statusLabel(r.status)}</span>
        <span class="pill pill-priority-${r.priority}">${statusLabel(r.priority)}</span>
        <h4 style="margin:8px 0 2px;">${esc(r.water_body_name || r.water_body_name_raw || 'Unnamed water body')}</h4>
        <p class="mono" style="font-size:0.8rem; margin:0;">${esc(r.report_code)} · ${esc(r.citizen_name || 'Anonymous citizen')}</p>
      </div>
      <div style="text-align:right; color:var(--ink-soft); font-size:0.85rem;">${fmtDate(r.created_at)}</div>
    </a>
  `).join('') || '<p>No reports match these filters.</p>';
}

document.getElementById('filterBtn').addEventListener('click', loadReports);

(async () => {
  await requireAuth('authority');
  loadStats();
  loadAlerts();
  loadReports();
})();
