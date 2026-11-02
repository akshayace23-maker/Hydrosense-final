const STATUS_FLOW = ['submitted','under_review','verified','inspection_assigned','field_inspection','action_planned','action_taken','follow_up_required','resolved','reopened','rejected'];
document.getElementById('fStatus').innerHTML += STATUS_FLOW.map((s) => `<option value="${s}">${statusLabel(s)}</option>`).join('');

const map = L.map('map').setView([11.0, 78.5], 7);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
let currentLayer = null;

function clearLayer() { if (currentLayer) { map.removeLayer(currentLayer); currentLayer = null; } }

async function renderWaterBodies() {
  const { water_bodies } = await api.get('/api/water-bodies');
  const withCoords = water_bodies.filter((w) => w.lat && w.lng);
  document.getElementById('empty').style.display = withCoords.length ? 'none' : 'block';
  const group = L.layerGroup();
  withCoords.forEach((w) => {
    const color = w.active_count === 0 ? '#5fb98a' : (w.active_count > 2 ? '#d1495b' : '#d98e3f');
    const marker = L.circleMarker([w.lat, w.lng], { radius: 9, color, fillColor: color, fillOpacity: 0.75, weight: 2 });
    marker.bindPopup(`<strong>${w.name}</strong><br>${statusLabel(w.type)}<br>${w.report_count} report(s) · ${w.active_count} active<br><a href="/waterbody.html?id=${w.id}">View profile →</a>`);
    marker.addTo(group);
  });
  group.addTo(map);
  currentLayer = group;
}

async function fetchPoints() {
  const params = new URLSearchParams();
  if (document.getElementById('fStatus').value) params.set('status', document.getElementById('fStatus').value);
  if (document.getElementById('fCategory').value) params.set('category', document.getElementById('fCategory').value);
  if (document.getElementById('fPriority').value) params.set('priority', document.getElementById('fPriority').value);
  if (document.getElementById('fDays').value) params.set('days', document.getElementById('fDays').value);
  const { points } = await api.get('/api/reports/map/points?' + params.toString());
  return points;
}

async function renderReports() {
  const points = await fetchPoints();
  document.getElementById('empty').style.display = points.length ? 'none' : 'block';
  const group = L.layerGroup();
  const colorFor = (p) => (p.priority === 'critical' || p.priority === 'high') ? '#d1495b' : (p.status === 'resolved' ? '#5fb98a' : '#d98e3f');
  points.forEach((p) => {
    const marker = L.circleMarker([p.lat, p.lng], { radius: 6, color: colorFor(p), fillColor: colorFor(p), fillOpacity: 0.8, weight: 1.5 });
    marker.bindPopup(`
      <span class="mono">${esc(p.report_code)}</span><br>${statusLabel(p.status)}<br>
      <a href="/report-detail.html?id=${p.id}">View report →</a><br>
      <button type="button" data-confirm-map="${p.id}" style="margin-top:6px; padding:4px 10px; border-radius:999px; border:1px solid #0e8388; background:transparent; color:#0e8388; cursor:pointer; font-size:0.8rem;">👀 I See This Too</button>
    `);
    marker.addTo(group);
  });
  group.addTo(map);
  currentLayer = group;
}

async function confirmFromMap(reportId, btn) {
  const user = await currentUser();
  if (!user) { window.location.href = '/login.html'; return; }
  btn.disabled = true; btn.textContent = 'Confirming…';
  try {
    await api.post(`/api/reports/${reportId}/confirm`);
    btn.textContent = '✓ Confirmed';
  } catch (e) {
    btn.disabled = false; btn.textContent = '👀 I See This Too';
    showError(e);
  }
}

async function renderHeatmap() {
  const points = await fetchPoints();
  document.getElementById('empty').style.display = points.length ? 'none' : 'block';
  const heat = L.heatLayer(points.map((p) => [p.lat, p.lng, 0.6]), { radius: 28, blur: 22, maxZoom: 14, gradient: { 0.2: '#2dd4bf', 0.5: '#d98e3f', 0.8: '#d1495b' } });
  heat.addTo(map);
  currentLayer = heat;
}

async function render() {
  clearLayer();
  const layer = document.getElementById('layerSelect').value;
  if (layer === 'waterbodies') await renderWaterBodies();
  else if (layer === 'reports') await renderReports();
  else await renderHeatmap();
}

document.getElementById('applyBtn').addEventListener('click', render);
document.getElementById('layerSelect').addEventListener('change', render);
render();

// Delegated handler for the popup button (replaces inline onclick for strict CSP)
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-confirm-map]');
  if (b) confirmFromMap(+b.dataset.confirmMap, b);
});
