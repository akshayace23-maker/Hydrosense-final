(async () => {
  const id = new URLSearchParams(location.search).get('id');
  const app = document.getElementById('app');
  try {
    const { water_body, stats, reports, inspections, actions, eco_index } = await api.get('/api/water-bodies/' + id);
    const me = await currentUser();
    app.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:start; flex-wrap:wrap; gap:10px;">
        <div>
          <span class="eyebrow">${statusLabel(water_body.type)}</span>
          <h2>${esc(water_body.name)}</h2>
          <p>${esc(water_body.address || 'Location on file with GIS coordinates.')}</p>
        </div>
        ${me && me.role === 'authority' ? `<a class="btn btn-outline btn-sm" href="/api/water-bodies/${id}/pdf">⬇ Download history PDF</a>` : ''}
      </div>
      <div class="grid-4">
        <div class="stat-card"><div class="value">${stats.total_reports}</div><div class="label">Total reports</div></div>
        <div class="stat-card"><div class="value">${stats.active}</div><div class="label">Active issues</div></div>
        <div class="stat-card"><div class="value">${stats.resolved}</div><div class="label">Resolved</div></div>
        <div class="stat-card"><div class="value">${stats.confirmations}</div><div class="label">Community confirmations</div></div>
      </div>

      ${eco_index ? `
      <div class="card" style="margin-top:24px; border-color:var(--teal);">
        <h4>Conceptual Food Web Resilience Index</h4>
        <div style="display:flex; align-items:center; gap:16px;">
          <div style="font-family:var(--font-display); font-size:2.4rem; color:var(--teal);">${eco_index.score}<span style="font-size:1rem; color:var(--ink-soft);">/100</span></div>
          <div><strong>${eco_index.label}</strong><p style="margin:0; font-size:0.82rem;">Based on ${eco_index.basis} field inspection(s).</p></div>
        </div>
        <p style="font-size:0.78rem; font-style:italic; margin-top:8px;">${eco_index.disclaimer}</p>
      </div>` : `<div class="card" style="margin-top:24px;"><h4>Conceptual Food Web Resilience Index</h4><p>No data available yet — this appears once an authority records at least one field inspection.</p></div>`}

      <div class="card" style="margin-top:16px;">
        <h4>Report history</h4>
        ${reports.length ? reports.map((r) => `
          <a href="/report-detail.html?id=${r.id}" style="text-decoration:none; display:block; padding:10px 0; border-bottom:1px solid var(--line);">
            <span class="pill pill-${r.status}">${statusLabel(r.status)}</span>
            <span class="mono" style="font-size:0.8rem; margin-left:8px;">${esc(r.report_code)}</span>
            <span style="float:right; color:var(--ink-soft); font-size:0.85rem;">${fmtDate(r.created_at)}</span>
          </a>`).join('') : '<p>No data available yet.</p>'}
      </div>

      <div class="card" style="margin-top:16px;">
        <h4>Inspection history</h4>
        ${inspections.length ? inspections.map((i) => `<p><strong>${esc(i.inspection_date)}</strong> — ${esc(i.observed_condition || 'Field inspection recorded')}</p>`).join('<hr>') : '<p>No data available yet.</p>'}
      </div>

      <div class="card" style="margin-top:16px;">
        <h4>Authority actions / restoration history</h4>
        ${actions.length ? actions.map((a) => `<p><strong>${esc(a.action_date)}</strong> — ${esc(a.action_taken)}</p>`).join('<hr>') : '<p>No data available yet.</p>'}
      </div>
    `;
  } catch (e) {
    app.innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
  }
})();
