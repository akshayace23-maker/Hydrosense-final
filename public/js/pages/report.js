requireAuth('citizen');

// ---------------------------------------------------------------- map + pinning
// `pinned` is only true once a real location has been chosen (GPS, pasted link/coordinates, photo GPS or a tap).
// Until then no coordinates are sent — the pin never silently defaults to a made-up spot.
let map, marker, circle, pinned = false, chosenLat = 10.8505, chosenLng = 78.6, manualPin = false;
const locStatus = document.getElementById('locStatus');
const geoStatus = document.getElementById('geoStatus');
const coordsLine = document.getElementById('coordsLine');
const defaultCoordsHint = coordsLine.textContent;

map = L.map('map', { zoomControl: true }).setView([chosenLat, chosenLng], 7); // Tamil Nadu overview
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
marker = L.marker([chosenLat, chosenLng], { draggable: true, opacity: 0 }).addTo(map);
marker.dragging.disable(); // becomes draggable once there is a real pin

function setPin(lat, lng, opts) {
  opts = opts || {};
  chosenLat = lat; chosenLng = lng; pinned = true;
  marker.setLatLng([lat, lng]); marker.setOpacity(1); marker.dragging.enable();
  if (opts.zoom) map.setView([lat, lng], opts.zoom); else if (opts.pan) map.panTo([lat, lng]);
  if (circle) { map.removeLayer(circle); circle = null; }
  if (opts.accuracy && opts.accuracy > 15) {
    circle = L.circle([lat, lng], { radius: opts.accuracy, color: '#14b8a6', weight: 1, fillOpacity: 0.12 }).addTo(map);
  }
  coordsLine.textContent = `Pinned: ${lat.toFixed(5)}, ${lng.toFixed(5)}` + (opts.accuracy ? ` (±${Math.round(opts.accuracy)} m)` : '') + ' — drag the marker to adjust.';
  checkNearby();
}
marker.on('dragend', () => { const p = marker.getLatLng(); manualPin = true; if (circle) { map.removeLayer(circle); circle = null; } setPin(p.lat, p.lng); });
map.on('click', (e) => { manualPin = true; setPin(e.latlng.lat, e.latlng.lng); locStatus.textContent = ''; });

// ---- "Use my current location": high accuracy, takes the best fix for a few seconds, clear errors
const locBtn = document.getElementById('useLocationBtn');
locBtn.addEventListener('click', () => {
  if (!navigator.geolocation) { locStatus.textContent = 'Geolocation is not supported by your browser.'; return toast('Geolocation is not supported by your browser.', 'error'); }
  if (window.isSecureContext === false) { locStatus.textContent = 'Location only works on a secure (https) page.'; return toast('Location only works on a secure (https) page.', 'error'); }
  locBtn.disabled = true; locStatus.textContent = 'Finding your location…';
  let best = null, finished = false, watchId = null;
  const done = (ok) => {
    if (finished) return; finished = true;
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    clearTimeout(settle); clearTimeout(hard);
    locBtn.disabled = false;
    if (ok && best) {
      manualPin = false;
      setPin(best.latitude, best.longitude, { zoom: 17, accuracy: best.accuracy });
      locStatus.textContent = `Location pinned (±${Math.round(best.accuracy)} m). Drag the marker if it is slightly off.`;
      toast('Your location has been pinned on the map.');
    }
  };
  const fail = (err) => {
    if (finished) return;
    const msg = err && err.code === 1 ? 'Location permission denied. Allow location for this site in your browser settings, or paste a map link below.'
      : err && err.code === 3 ? 'Finding your location took too long. Try again outdoors, or paste a map link below.'
      : 'Your location is unavailable right now. Turn on GPS, or paste a map link below.';
    finished = true; if (watchId != null) navigator.geolocation.clearWatch(watchId); clearTimeout(settle); clearTimeout(hard);
    locBtn.disabled = false; locStatus.textContent = msg; toast(msg, 'error');
  };
  // Phones often return a rough network fix first; keep listening briefly and keep the most accurate one.
  watchId = navigator.geolocation.watchPosition((pos) => {
    if (!best || pos.coords.accuracy < best.accuracy) best = pos.coords;
    // show the first fix immediately so the pin appears right away, then refine it
    if (!manualPin) setPin(best.latitude, best.longitude, { zoom: best.accuracy < 60 ? 17 : 15, accuracy: best.accuracy });
    if (best.accuracy <= 25) done(true);
  }, (err) => { if (best) done(true); else fail(err); }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  const settle = setTimeout(() => { if (best) done(true); }, 9000);          // good enough after 9 s
  const hard = setTimeout(() => { if (best) done(true); else fail({ code: 3 }); }, 22000);
});

// ---- Paste a map link / coordinates -> pin automatically
let geoTimer = null, lastGeoText = '';
async function handleGeoText(raw) {
  const text = (raw || '').trim();
  if (!text || text === lastGeoText) return;
  lastGeoText = text;
  geoStatus.textContent = 'Reading location…';
  let hit = HSGeo.parse(text);
  if (!hit && HSGeo.isShortMapLink(text)) {
    try {
      const url = (text.match(/https?:\/\/[^\s<>"']+/i) || [])[0];
      const r = await api.post('/api/geo/resolve', { url });
      hit = HSGeo.parse(r.url);
    } catch (e) { geoStatus.textContent = e.message; return; }
  }
  if (!hit) { geoStatus.textContent = "Couldn't find coordinates in that. Paste a Google Maps link, or type them like 10.9503, 78.6911."; return; }
  manualPin = false;
  setPin(hit.lat, hit.lng, { zoom: 17 });
  geoStatus.textContent = `Pinned from your link: ${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}.`;
  locStatus.textContent = '';
  toast('Location pinned from the link you pasted.');
}
const geoInput = document.getElementById('geoPaste');
geoInput.addEventListener('paste', (e) => {
  const txt = (e.clipboardData || window.clipboardData).getData('text');
  setTimeout(() => handleGeoText(txt || geoInput.value), 0);
});
geoInput.addEventListener('input', () => { clearTimeout(geoTimer); geoTimer = setTimeout(() => handleGeoText(geoInput.value), 700); });
geoInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); handleGeoText(geoInput.value); } });

// "I See This Too" surfaced proactively: if an existing open report sits within
// ~150m of the pin the citizen just placed, offer to confirm it instead of
// filing a fresh duplicate. They can still continue with their own report.
let nearbyCheckTimer = null;
function checkNearby() {
  clearTimeout(nearbyCheckTimer);
  nearbyCheckTimer = setTimeout(async () => {
    const box = document.getElementById('nearbyBox');
    try {
      const data = await api.get(`/api/reports/nearby?lat=${chosenLat}&lng=${chosenLng}&radius_m=150`);
      if (!data.nearby.length) { box.innerHTML = ''; return; }
      box.innerHTML = `
        <div class="nearby-notice">
          <h4>👀 Someone already reported an issue near this exact spot</h4>
          <p style="margin:0;">Confirming an existing report (instead of filing a new one) helps authorities see it's not an isolated case. You can still continue with your own report below if it's a different issue.</p>
          ${data.nearby.map((r) => `
            <div class="nearby-report-item">
              <div>
                <strong>${esc(r.water_body_name || 'Unnamed water body')}</strong>
                <span class="mono" style="font-size:0.78rem; display:block;">${esc(r.report_code)} · ${r.distance_m}m away · ${statusLabel(r.status)}</span>
              </div>
              <button type="button" class="btn btn-outline btn-sm" data-confirm-nearby="${r.id}">I See This Too</button>
            </div>
          `).join('')}
        </div>`;
    } catch (e) { /* non-critical; fail silently */ }
  }, 500);
}

async function confirmNearby(reportId, btn) {
  btn.disabled = true; btn.textContent = 'Confirming…';
  try {
    await api.post(`/api/reports/${reportId}/confirm`);
    btn.textContent = '✓ Confirmed';
  } catch (e) {
    btn.disabled = false; btn.textContent = 'I See This Too';
    showError(e);
  }
}

function goStep(n) {
  document.querySelectorAll('.step').forEach((s) => s.style.display = (+s.dataset.step === n ? 'block' : 'none'));
  document.querySelectorAll('#stepsNav span').forEach((s) => s.classList.toggle('active', +s.dataset.step === n));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

let selectedFiles = [];
document.getElementById('photos').addEventListener('change', async (e) => {
  selectedFiles = Array.from(e.target.files).slice(0, 6);
  // If the photo carries GPS and the person hasn't pinned anything yet, pin it for them.
  if (!pinned && window.exifr) {
    for (const f of selectedFiles) {
      try {
        const g = await exifr.gps(f);
        if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude)) {
          setPin(g.latitude, g.longitude, { zoom: 17 });
          locStatus.textContent = 'Pinned from your photo\'s GPS tag. Check it on the map in step 1.';
          toast('Location pinned from your photo\'s GPS data.');
          break;
        }
      } catch (err) { /* photo has no readable GPS */ }
    }
  }
  const preview = document.getElementById('photoPreview');
  preview.innerHTML = '';
  selectedFiles.forEach((f) => {
    const div = document.createElement('div');
    div.className = 'photo-thumb';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(f);
    div.appendChild(img);
    preview.appendChild(div);
  });
});

function renderSummary() {
  if (!pinned && !document.getElementById('address').value.trim()) {
    toast('Please set the location: use your current location, paste a map link, tap the map, or type an address / landmark.', 'error');
    goStep(1); return;
  }
  const issues = Array.from(document.querySelectorAll('.checkbox-grid input:checked')).map((i) => i.value);
  const isAnon = document.getElementById('is_anonymous').checked;
  const wbName = document.getElementById('water_body_name').value || '(unnamed — using pinned location)';
  document.getElementById('summaryBox').innerHTML = `
    <p><strong>Water body:</strong> ${esc(wbName)} (${document.getElementById('water_body_type').value})</p>
    <p><strong>Location:</strong> ${pinned ? chosenLat.toFixed(5) + ', ' + chosenLng.toFixed(5) : 'No map pin set'} ${document.getElementById('address').value ? '— ' + esc(document.getElementById('address').value) : ''}</p>
    <p><strong>Observed issues:</strong> ${issues.length ? issues.map(statusLabel).join(', ') : 'None selected'}</p>
    <p><strong>Photos:</strong> ${selectedFiles.length} attached</p>
    <p><strong>Notes:</strong> ${esc(document.getElementById('additional_notes').value || '—')}</p>
    <p><strong>Reporting:</strong> ${isAnon ? 'Anonymously' : 'With your account identity visible to authorities'}</p>
  `;
  goStep(4);
}

document.getElementById('reportForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = selectedFiles.length ? 'Submitting & checking photos…' : 'Submitting…';
  const fd = new FormData();
  fd.append('water_body_type', document.getElementById('water_body_type').value);
  fd.append('water_body_name', document.getElementById('water_body_name').value);
  if (pinned) { fd.append('lat', chosenLat); fd.append('lng', chosenLng); }
  fd.append('address', document.getElementById('address').value);
  const issues = Array.from(document.querySelectorAll('.checkbox-grid input:checked')).map((i) => i.value);
  fd.append('observed_issues', JSON.stringify(issues));
  fd.append('additional_notes', document.getElementById('additional_notes').value);
  fd.append('is_anonymous', document.getElementById('is_anonymous').checked);
  selectedFiles.forEach((f) => fd.append('photos', f));

  try {
    const data = await api.postForm('/api/reports', fd);
    document.getElementById('reportForm').style.display = 'none';
    document.getElementById('stepsNav').style.display = 'none';
    document.getElementById('successBox').innerHTML = `
      <div class="modal-backdrop" id="successModal">
        <div class="modal-card">
          <div class="modal-icon">✅</div>
          <h3>Report Successfully Submitted!</h3>
          <p>Your report has been logged and sent for review. Save this Report ID to track its progress anytime.</p>
          <p class="mono" style="font-size:1.3rem; color:var(--teal); margin:14px 0;">${esc(data.report.report_code)}</p>
          <div style="text-align:left;">${data.ai ? hsAiCard({ status: data.ai.status, relevance: data.ai.relevance, indicators: data.ai.indicators, note: data.ai.note, error: data.ai.error, question: data.ai.followup_question, options: data.ai.followup_options }) : ''}</div>
          <div style="display:flex; gap:10px; justify-content:center; flex-wrap:wrap; margin-top:14px;">
            <a class="btn btn-primary" href="/report-detail.html?id=${data.report.id}">Track this report</a>
            <a class="btn btn-outline" href="/dashboard.html">Go to my reports</a>
          </div>
        </div>
      </div>`;
  } catch (err) {
    document.getElementById('alertBox').innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    btn.disabled = false; btn.textContent = 'Submit report';
    goStep(1);
  }
});

// Delegated handlers (replaces inline onclick so the strict CSP can stay on)
document.addEventListener('click', (e) => {
  const goto = e.target.closest('[data-goto]');
  if (goto) { goStep(+goto.dataset.goto); return; }
  if (e.target.closest('[data-action="review"]')) { renderSummary(); return; }
  const nb = e.target.closest('[data-confirm-nearby]');
  if (nb) confirmNearby(+nb.dataset.confirmNearby, nb);
});
