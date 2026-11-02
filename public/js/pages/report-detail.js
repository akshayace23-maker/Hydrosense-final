const id = new URLSearchParams(location.search).get('id');
let me, reportData;

const STATUS_FLOW = ['submitted','under_review','verified','inspection_assigned','field_inspection','action_planned','action_taken','follow_up_required','resolved','reopened','rejected'];

async function load() {
  me = await currentUser();
  if (!me) { location.href = '/login.html'; return; }
  try {
    reportData = await api.get('/api/reports/' + id);
  } catch (e) {
    document.getElementById('app').innerHTML = `<div class="alert alert-error">${esc(e.message)}</div>`;
    return;
  }
  render();
}

function render() {
  const { report: r, photos, timeline, confirmCount, iConfirmed, inspections, actions, citizenBadge } = reportData;
  const isOwner = me.role === 'citizen' && r.is_owner === true;
  const isAuthority = me.role === 'authority';

  document.getElementById('app').innerHTML = `
    <div class="split">
      <div>
        <span class="pill pill-${r.status}">${statusLabel(r.status)}</span>
        <span class="pill pill-priority-${r.priority}">${statusLabel(r.priority)} priority</span>
        <h2 style="margin-top:12px;">${esc(r.water_body_name || r.water_body_name_raw || 'Unnamed water body')}</h2>
        <p class="mono">${esc(r.report_code)} · ${fmtDate(r.created_at)}</p>
        <p>${esc(r.address || '')} ${r.lat ? `(${r.lat.toFixed(5)}, ${r.lng.toFixed(5)})` : ''}</p>

        <div class="card" style="margin-top:16px;">
          <h4>Photo evidence</h4>
          <div class="grid-3">
            ${photos.length ? photos.map((p) => `
              <div class="photo-thumb"><img src="/uploads/${esc(p.filename)}" loading="lazy"><span class="tag">${p.stage.replace(/_/g,' ')}</span></div>
            `).join('') : '<p>No photos attached.</p>'}
          </div>
        </div>

        ${photos.some((p) => p.stage === 'evidence') ? hsAiCard(hsAiFromReport(r), { extra: isAuthority ? '<button class="btn btn-outline btn-sm" id="aiRecheckBtn" type="button" style="margin-top:12px;">🔄 Re-run AI check</button>' : '' }) : ''}

        <div class="card" style="margin-top:16px;">
          <h4>What the citizen observed</h4>
          <p>${JSON.parse(r.observed_issues || '[]').map(statusLabel).join(', ') || 'No specific indicators selected'}</p>
          ${r.additional_notes ? `<p>"${esc(r.additional_notes)}"</p>` : ''}
          <p style="font-size:0.85rem;">Reported ${r.is_anonymous ? 'anonymously' : 'by ' + esc(r.citizen_name || 'a citizen')}${citizenBadge ? ` · <span class="pill pill-resolved">🌊 ${esc(citizenBadge)}</span>` : ''}</p>
          ${(isAuthority && !r.is_anonymous) ? `<p style="font-size:0.85rem; color:var(--ink-soft);">Contact: ${esc(r.citizen_email || '—')}${r.citizen_phone ? ' · ' + esc(r.citizen_phone) : ''}</p>` : ''}
        </div>

        <div class="card" style="margin-top:16px;">
          <h4>Timeline</h4>
          <ul class="timeline">
            ${timeline.map((t) => `<li><div class="status">${statusLabel(t.status)}</div>${t.remarks ? `<div>${esc(t.remarks)}</div>` : ''}<div class="time">${fmtDate(t.created_at)}</div></li>`).join('')}
          </ul>
        </div>

        ${inspections.length ? `<div class="card" style="margin-top:16px;"><h4>Field inspections</h4>${inspections.map((i) => `
          <p><strong>${esc(i.inspection_date)}</strong> — ${esc(i.observed_condition || '')}</p>
          <p style="font-size:0.85rem;">Pollution: ${i.visible_pollution?'Yes':'No'} · Sewage inflow: ${i.sewage_inflow?'Yes':'No'} · Solid waste: ${i.solid_waste?'Yes':'No'} · Vegetation: ${i.aquatic_vegetation?'Yes':'No'}</p>
          ${i.recommended_intervention ? `<p><em>Recommended: ${esc(i.recommended_intervention)}</em></p>` : ''}
        `).join('<hr>')}</div>` : ''}

        ${actions.length ? `<div class="card" style="margin-top:16px;"><h4>Actions taken</h4>${actions.map((a) => `<p><strong>${esc(a.action_date)}</strong> — ${esc(a.action_taken)}</p>`).join('<hr>')}</div>` : ''}
      </div>

      <div>
        ${!isOwner && me.role === 'citizen' ? `
        <div class="card">
          <h4>👀 I See This Too</h4>
          <p>${confirmCount} citizen(s) have confirmed this issue.</p>
          <button class="btn btn-primary btn-block" id="confirmBtn" ${iConfirmed ? 'disabled' : ''}>${iConfirmed ? 'Already confirmed' : 'I see this too'}</button>
        </div>` : ''}

        ${isOwner ? `
        <div class="card">
          <h4>Add follow-up photo</h4>
          <input type="file" id="followupPhotos" accept="image/jpeg,image/png,image/webp" multiple>
          <button class="btn btn-outline btn-block" style="margin-top:10px;" id="followupBtn">Upload</button>
        </div>` : ''}

        ${isAuthority ? `
        <div class="card">
          <h4>Update status</h4>
          <select id="statusSelect">${STATUS_FLOW.map((s) => `<option value="${s}" ${s===r.status?'selected':''}>${statusLabel(s)}</option>`).join('')}</select>
          <textarea id="statusRemarks" rows="2" placeholder="Remarks (visible to citizen)" style="margin-top:8px;"></textarea>
          <button class="btn btn-primary btn-block" style="margin-top:8px;" id="statusBtn">Update status</button>
        </div>

        <div class="card">
          <h4>Priority</h4>
          <select id="prioritySelect">
            ${['low','normal','high','critical'].map((p) => `<option value="${p}" ${p===r.priority?'selected':''}>${statusLabel(p)}</option>`).join('')}
          </select>
          <button class="btn btn-outline btn-block" style="margin-top:8px;" id="priorityBtn">Save priority</button>
        </div>

        <div class="card">
          <h4>Record field inspection</h4>
          <form id="inspectForm">
            <div class="field"><label>Inspection date</label><input type="date" name="inspection_date" required></div>
            <div class="field"><label>Observed condition</label><textarea name="observed_condition" rows="2"></textarea></div>
            <p style="font-size:0.8rem; font-weight:600; margin:10px 0 4px;">Physical / pollution indicators</p>
            <label class="check-tile"><input type="checkbox" name="visible_pollution" class="cause-check" data-cause="sewage"> Visible pollution</label>
            <label class="check-tile"><input type="checkbox" name="sewage_inflow" class="cause-check" data-cause="sewage"> Sewage inflow</label>
            <label class="check-tile"><input type="checkbox" name="solid_waste"> Solid waste</label>
            <label class="check-tile"><input type="checkbox" name="aquatic_vegetation" class="cause-check" data-cause="siltation"> Excess vegetation</label>
            <p style="font-size:0.8rem; font-weight:600; margin:10px 0 4px;">Ecological stress indicators (feeds conceptual Food Web Resilience Index)</p>
            <label class="check-tile"><input type="checkbox" name="fish_mortality_observed"> Fish mortality observed</label>
            <label class="check-tile"><input type="checkbox" name="invasive_plants_observed" class="cause-check" data-cause="hyacinth"> Invasive plants observed</label>
            <label class="check-tile"><input type="checkbox" name="biodiversity_reduced_observed"> Reduced biodiversity observed</label>
            <label class="check-tile"><input type="checkbox" name="habitat_disturbance_observed" class="cause-check" data-cause="encroachment"> Habitat disturbance / encroachment</label>
            <div class="field" style="margin-top:10px;">
              <label>Recommended intervention</label>
              <input type="text" name="recommended_intervention" id="interventionInput">
              <div class="hint" id="interventionHint">Suggestions appear here based on checked indicators — shown as a recommendation only, not an automatically authorized action.</div>
            </div>
            <button class="btn btn-primary btn-block" type="submit">Save inspection</button>
          </form>
        </div>

        <div class="card">
          <h4>Record action + evidence</h4>
          <form id="actionForm">
            <div class="field"><label>Action taken</label><textarea name="action_taken" rows="2" required></textarea></div>
            <div class="field"><label>Date</label><input type="date" name="action_date" required></div>
            <div class="field"><label>After photo(s)</label><input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple>
              <div class="hint">On a phone this lets you either take a new photo on the spot or choose one already saved in your gallery.</div>
            </div>
            <button class="btn btn-primary btn-block" type="submit">Save action</button>
          </form>
        </div>

        <div class="card">
          <h4>Export</h4>
          <a class="btn btn-outline btn-block" href="/api/reports/${id}/pdf">⬇ Download case report (PDF)</a>
        </div>

        <div class="card">
          <h4>Delete report</h4>
          <p style="font-size:0.85rem;">Use only for spam, duplicates or invalid reports. This permanently removes the report and its photos, and the reporter is notified by email with your reason.</p>
          <textarea id="deleteReason" rows="2" placeholder="Reason for deleting (required, 5+ characters)"></textarea>
          <button class="btn btn-outline btn-block" style="margin-top:8px; color:#d1495b; border-color:#d1495b;" id="deleteBtn">🗑 Delete this report</button>
        </div>` : ''}
      </div>
    </div>
  `;

  if (document.getElementById('confirmBtn')) {
    document.getElementById('confirmBtn').addEventListener('click', async () => {
      try { await api.post(`/api/reports/${id}/confirm`); await load(); }
      catch (e) { showError(e); }
    });
  }
  if (document.getElementById('followupBtn')) {
    document.getElementById('followupBtn').addEventListener('click', async () => {
      const files = document.getElementById('followupPhotos').files;
      if (!files.length) return toast('Choose at least one photo.', 'error');
      const fd = new FormData(); Array.from(files).forEach((f) => fd.append('photos', f));
      try { await api.postForm(`/api/reports/${id}/followup-photo`, fd); await load(); }
      catch (e) { showError(e); }
    });
  }
  if (document.getElementById('statusBtn')) {
    document.getElementById('statusBtn').addEventListener('click', async () => {
      try {
        await api.post(`/api/reports/${id}/status`, { status: document.getElementById('statusSelect').value, remarks: document.getElementById('statusRemarks').value });
        await load();
      } catch (e) { showError(e); }
    });
  }
  if (document.getElementById('aiRecheckBtn')) {
    document.getElementById('aiRecheckBtn').addEventListener('click', async (ev) => {
      ev.target.disabled = true; ev.target.textContent = 'Checking…';
      try { await api.post(`/api/reports/${id}/ai-recheck`); await load(); toast('AI check updated.'); }
      catch (e) { showError(e); ev.target.disabled = false; ev.target.textContent = '🔄 Re-run AI check'; }
    });
  }
  if (document.getElementById('deleteBtn')) {
    document.getElementById('deleteBtn').addEventListener('click', async () => {
      const reason = document.getElementById('deleteReason').value.trim();
      if (reason.length < 5) return toast('Please enter a reason (at least 5 characters).', 'error');
      if (!(await confirmDialog({ title: 'Delete this report?', message: 'Permanently delete this report and its photos? This cannot be undone.', okText: 'Delete', danger: true }))) return;
      try {
        await api.request('DELETE', `/api/reports/${id}`, { reason });
        toast('Report deleted.');
        location.href = '/authority-dashboard.html';
      } catch (e) { showError(e); }
    });
  }
  if (document.getElementById('priorityBtn')) {
    document.getElementById('priorityBtn').addEventListener('click', async () => {
      try { await api.post(`/api/reports/${id}/priority`, { priority: document.getElementById('prioritySelect').value }); await load(); }
      catch (e) { showError(e); }
    });
  }
  if (document.getElementById('inspectForm')) {
    const causeMap = {
      sewage: 'Diversion channel + constructed wetland/reed-bed treatment + community behaviour intervention',
      encroachment: 'Boundary demarcation + revenue/municipal validation',
      siltation: 'Desilting assessment + natural vegetation-based bund stabilization',
      hyacinth: 'Manual/mechanical removal + native vegetation restoration',
    };
    document.querySelectorAll('.cause-check').forEach((cb) => cb.addEventListener('change', () => {
      const active = Array.from(document.querySelectorAll('.cause-check:checked')).map((c) => causeMap[c.dataset.cause]);
      const unique = [...new Set(active)];
      document.getElementById('interventionInput').value = unique.join(' · ');
      document.getElementById('interventionHint').textContent = unique.length
        ? 'Auto-suggested from checked indicators — edit freely; this is a recommendation, not an authorized action.'
        : 'Suggestions appear here based on checked indicators — shown as a recommendation only, not an automatically authorized action.';
    }));
    document.getElementById('inspectForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd.entries());
      try { await api.post(`/api/reports/${id}/inspection`, body); await load(); }
      catch (err) { showError(err); }
    });
  }
  if (document.getElementById('actionForm')) {
    document.getElementById('actionForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try { await api.postForm(`/api/reports/${id}/action`, fd); await load(); }
      catch (err) { showError(err); }
    });
  }
}

load();
