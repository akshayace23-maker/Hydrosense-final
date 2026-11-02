// pages/community.js — public list of open reports with the "I See This Too" confirmation button.
(async () => {
  const list = document.getElementById('list');
  const empty = document.getElementById('empty');
  const note = document.getElementById('note');
  const q = document.getElementById('q');
  let data;
  try { data = await api.get('/api/reports/community'); } catch (e) { list.innerHTML = ''; showError(e); return; }
  const viewer = data.viewer; // 'guest' | 'citizen' | 'authority'
  let reports = data.reports;

  if (viewer === 'guest') note.innerHTML = '<div class="alert alert-info" style="margin-top:14px;">You are browsing as a guest. <a href="/login.html">Log in</a> or <a href="/register.html?role=citizen">create a free citizen account</a> to confirm a report.</div>';
  else if (viewer === 'authority') note.innerHTML = '<div class="alert alert-info" style="margin-top:14px;">Confirmations come from citizens. As an authority you can see the counts here and review reports from your dashboard.</div>';

  const label = (s) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  function action(r) {
    if (viewer === 'guest') return '<a class="btn btn-primary btn-sm btn-block" href="/login.html">Log in to confirm</a>';
    if (viewer !== 'citizen') return '';
    if (r.is_mine) return '<button class="btn btn-ghost btn-sm btn-block" disabled>This is your report</button>';
    if (r.i_confirmed) return '<button class="btn btn-ghost btn-sm btn-block" disabled>✓ You confirmed this</button>';
    return `<button class="btn btn-primary btn-sm btn-block" data-confirm="${r.id}">👀 I See This Too</button>`;
  }

  function card(r) {
    const issues = (r.issues || []).slice(0, 4).map((i) => `<span class="pill">${esc(label(i))}</span>`).join(' ');
    return `<div class="card card--hover" data-card="${r.id}">
      <span class="pill pill-${esc(r.status)}">${esc(statusLabel(r.status))}</span>
      <h4 style="margin-top:10px;">${esc(r.water_body_name || (r.water_body_type ? label(r.water_body_type) : 'Water body'))}</h4>
      <p class="mono" style="font-size:0.8rem;">${esc(r.report_code)}</p>
      <p style="font-size:0.85rem;">${fmtDate(r.created_at)}</p>
      <div style="margin:8px 0;">${issues}</div>
      <p style="margin:10px 0;"><strong data-count="${r.id}">${r.confirm_count}</strong> citizen(s) confirmed this</p>
      ${action(r)}
      ${viewer !== 'guest' ? `<p style="margin-top:8px;"><a href="/report-detail.html?id=${r.id}">View details →</a></p>` : ''}
    </div>`;
  }

  function draw() {
    const term = q.value.trim().toLowerCase();
    const shown = reports.filter((r) => !term || [r.water_body_name, r.report_code, r.water_body_type, (r.issues || []).join(' ')].join(' ').toLowerCase().includes(term));
    list.innerHTML = shown.map(card).join('');
    empty.style.display = reports.length ? 'none' : 'block';
  }
  draw();
  q.addEventListener('input', draw);

  list.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-confirm]');
    if (!btn) return;
    const id = +btn.dataset.confirm;
    btn.disabled = true; btn.textContent = 'Confirming…';
    try {
      const out = await api.post(`/api/reports/${id}/confirm`);
      const r = reports.find((x) => x.id === id);
      if (r) { r.i_confirmed = true; r.confirm_count = out.confirmCount; }
      draw();
      toast('Thanks — your confirmation was added.', 'success');
    } catch (err) {
      btn.disabled = false; btn.textContent = '👀 I See This Too';
      showError(err);
    }
  });
})();
