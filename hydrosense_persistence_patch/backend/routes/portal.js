// routes/portal.js
// Compatibility layer for the existing HydroSense single-page frontend.
// It adapts the UI's legacy route/field names to the current SQLite backend.
const express = require('express');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const db = require('../db/init');
const config = require('../config');
const { authRequired, authOptional, requireRole } = require('../middleware/auth');
const { upload, UPLOAD_ROOT } = require('../middleware/upload');
const { checkPhotos, isConfigured: aiConfigured } = require('../ai/photoCheck');
const { makeReportCode, sendMail, escapeHtml } = require('../utils');
const { reportCasePdf } = require('../pdf/generate');
const { computeFoodWebIndex } = require('../eco/foodWebIndex');

const router = express.Router();
const confirmLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 60,
  message: { error: 'Too many confirmations. Please slow down.' }
});
const VALID_STATUSES = [
  'submitted', 'under_review', 'verified', 'inspection_assigned',
  'field_inspection', 'action_planned', 'action_taken',
  'follow_up_required', 'resolved', 'reopened', 'rejected'
];
const ISSUE_KEYS = [
  'dead_fish', 'garbage', 'excess_plants', 'foul_smell', 'possible_sewage',
  'algal_surface', 'muddy_water', 'foam', 'water_level', 'encroachment'
];
const NEWS_CATEGORY_TO_DB = {
  alert: 'environmental_alert',
  restoration: 'restoration_update',
  inspection: 'inspection_update',
  awareness: 'research_awareness',
  general: 'community_update'
};
const NEWS_CATEGORY_FROM_DB = {
  environmental_alert: 'alert',
  restoration_update: 'restoration',
  inspection_update: 'inspection',
  water_body_condition: 'inspection',
  community_update: 'general',
  research_awareness: 'awareness',
  achievement: 'general'
};

function safeJsonArray(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) { return []; }
}
function uiPriority(value) { return value === 'normal' ? 'medium' : (value || 'medium'); }
function dbPriority(value) { return value === 'medium' ? 'normal' : (value || 'normal'); }
function isValidStatus(value) { return VALID_STATUSES.includes(value); }
function reportQuery(where, params) {
  return db.prepare(
    `SELECT r.*, wb.name AS wb_name, wb.type AS joined_wb_type,
      u.name AS citizen_name, u.email AS citizen_email, u.phone AS citizen_phone,
      (SELECT COUNT(*) FROM confirmations c WHERE c.report_id = r.id) AS confirmations
     FROM reports r
     LEFT JOIN water_bodies wb ON wb.id = r.water_body_id
     LEFT JOIN users u ON u.id = r.citizen_id
     WHERE ${where}`
  ).get(...params);
}
function reportList(where, params) {
  return db.prepare(
    `SELECT r.*, wb.name AS wb_name, wb.type AS joined_wb_type,
      (SELECT COUNT(*) FROM confirmations c WHERE c.report_id = r.id) AS confirmations
     FROM reports r LEFT JOIN water_bodies wb ON wb.id = r.water_body_id
     WHERE ${where} ORDER BY r.created_at DESC`
  ).all(...params);
}
function getByCode(code) {
  const value = String(code || '').trim().toUpperCase();
  return reportQuery('(r.report_code = ? OR CAST(r.id AS TEXT) = ?)', [value, value]);
}
function toCard(row, viewer) {
  const mine = !!viewer && viewer.role === 'citizen' && row.citizen_id === viewer.id;
  return {
    id: row.id,
    code: row.report_code,
    status: row.status,
    priority: uiPriority(row.priority),
    wb_id: row.water_body_id,
    wb_name: row.wb_name || row.water_body_name_raw || 'Unnamed water body',
    name: row.wb_name || row.water_body_name_raw || 'Unnamed water body',
    wb_type: row.water_body_type || row.joined_wb_type || 'other',
    lat: row.lat == null ? null : Number(row.lat),
    lng: row.lng == null ? null : Number(row.lng),
    address: row.address || '',
    map_url: row.map_url || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    issues: safeJsonArray(row.observed_issues).filter((x) => ISSUE_KEYS.includes(x)),
    notes: row.additional_notes || '',
    confirmations: Number(row.confirmations || 0),
    mine,
    anonymous: !!row.is_anonymous,
    is_demo: !!row.is_demo
  };
}
function toDetail(row, viewer) {
  const card = toCard(row, viewer);
  const mine = card.mine;
  const isAuthority = !!viewer && viewer.role === 'authority';
  const photos = db.prepare(
    'SELECT * FROM report_photos WHERE report_id = ? ORDER BY created_at ASC, id ASC'
  ).all(row.id).map((p) => ({
    id: p.id,
    kind: p.stage === 'evidence' ? 'before' : 'after',
    stage: p.stage,
    url: '/uploads/' + encodeURIComponent(path.basename(p.filename)),
    created_at: p.captured_at || p.created_at,
    gps_source: p.gps_source
  }));
  const updates = db.prepare(
    `SELECT ru.status, ru.remarks, ru.actor_role, ru.created_at, u.name AS actor_name
     FROM report_updates ru LEFT JOIN users u ON u.id = ru.actor_id
     WHERE ru.report_id = ? ORDER BY ru.created_at ASC, ru.id ASC`
  ).all(row.id);
  const rawInspections = db.prepare(
    `SELECT i.*, u.name AS inspector FROM inspections i
     LEFT JOIN users u ON u.id = i.inspector_id
     WHERE i.report_id = ? ORDER BY i.created_at DESC`
  ).all(row.id);
  const inspections = rawInspections.map((i) => ({
    created_at: i.created_at,
    inspector: i.inspector || 'Authority',
    data: {
      fields: {
        visible_pollution: i.visible_pollution ? 'observed' : 'not_observed',
        sewage_inflow: i.sewage_inflow ? 'observed' : 'not_observed',
        solid_waste: i.solid_waste ? 'observed' : 'not_observed',
        vegetation: i.aquatic_vegetation ? 'observed' : 'not_observed',
        fish_condition: i.fish_condition || 'unable',
        odour: i.odour || 'unable',
        water_appearance: i.water_appearance || 'unable'
      },
      stress: {
        fish_mortality: !!i.fish_mortality_observed,
        invasive_plants: !!i.invasive_plants_observed,
        biodiversity_reduction: !!i.biodiversity_reduced_observed,
        habitat_disturbance: !!i.habitat_disturbance_observed
      },
      producers: false, consumers: false,
      notes: i.additional_findings || ''
    }
  }));
  const actions = db.prepare(
    `SELECT a.*, u.name AS created_by FROM actions a
     LEFT JOIN users u ON u.id = a.recorded_by
     WHERE a.report_id = ? ORDER BY a.created_at DESC`
  ).all(row.id).map((a) => ({
    created_at: a.created_at,
    created_by: a.created_by || 'Authority',
    description: a.action_taken,
    code: row.report_code
  }));
  const canSeeReporter = mine || isAuthority || !!row.is_demo;
  let reporter = null;
  if (canSeeReporter && !row.is_anonymous) {
    reporter = {
      name: row.citizen_name || '',
      // Do not expose placeholder/example addresses on imported demonstration accounts.
      email: row.is_demo ? '' : (row.citizen_email || ''),
      phone: row.is_demo ? '' : (row.citizen_phone || '')
    };
  }
  let aiCheck = null;
  if (row.ai_relevance && row.ai_relevance !== 'unchecked') {
    const rawIndicators = safeJsonArray(row.ai_indicators);
    aiCheck = {
      water_body_plausible: row.ai_relevance === 'relevant',
      visible: rawIndicators.map((x) => String(x).replace(/_/g, ' ')),
      note: (() => { try { return JSON.parse(row.ai_followup || '{}').note || ''; } catch (_) { return ''; } })()
    };
  }
  const confirmation = viewer
    ? !!db.prepare('SELECT 1 FROM confirmations WHERE report_id = ? AND user_id = ?').get(row.id, viewer.id)
    : false;
  return {
    ...card,
    reporter,
    photos,
    updates,
    inspections,
    actions,
    ai_check: aiCheck,
    confirmed_by_me: confirmation,
    demo_notice: row.is_demo
      ? 'Imported historical/demo record. Source and current site condition have not been independently verified. No GPS coordinates or evidence photos were supplied.'
      : ''
  };
}
function csvCell(value) {
  return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
}
function priorityFilter(value) {
  return dbPriority(String(value || ''));
}

// Frontend boot/configuration and homepage data.
router.get('/config', (req, res) => res.json({
  aiEnabled: aiConfigured(),
  authorityDomain: config.AUTHORITY_EMAIL_DOMAIN,
  demoData: !!db.prepare('SELECT 1 FROM reports WHERE is_demo = 1 LIMIT 1').get()
}));
router.get('/public-stats', (req, res) => {
  const n = (sql) => db.prepare(sql).get().n;
  res.json({
    reports: n("SELECT COUNT(*) n FROM reports WHERE status != 'rejected'"),
    waterBodies: n('SELECT COUNT(*) n FROM water_bodies'),
    resolved: n("SELECT COUNT(*) n FROM reports WHERE status = 'resolved'"),
    active: n("SELECT COUNT(*) n FROM reports WHERE status NOT IN ('resolved','rejected')"),
    confirmations: n('SELECT COUNT(*) n FROM confirmations')
  });
});
router.get('/feed', authOptional, (req, res) => {
  const rows = reportList("r.status NOT IN ('rejected')", []);
  const cards = rows.map((r) => toCard(r, req.user || null));
  res.json({
    open: cards.filter((r) => !['resolved', 'rejected'].includes(r.status)),
    solved: cards.filter((r) => r.status === 'resolved')
  });
});
router.get('/track', authOptional, (req, res) => {
  const q = String(req.query.q || '').trim().toUpperCase();
  if (!q) return res.json({ reports: [] });
  const rows = reportList('r.report_code LIKE ?', ['%' + q + '%']).slice(0, 50);
  res.json({ reports: rows.map((r) => toCard(r, req.user || null)) });
});
router.get('/map', authOptional, (req, res) => {
  // Demo records have no verified GPS coordinates; do not invent map markers.
  const waterBodies = db.prepare(
    `SELECT wb.*,
      (SELECT COUNT(*) FROM reports r WHERE r.water_body_id = wb.id) AS reports,
      (SELECT COUNT(*) FROM reports r WHERE r.water_body_id = wb.id AND r.status NOT IN ('resolved','rejected')) AS open_reports
     FROM water_bodies wb WHERE wb.lat IS NOT NULL AND wb.lng IS NOT NULL ORDER BY reports DESC`
  ).all();
  const reports = reportList('r.lat IS NOT NULL AND r.lng IS NOT NULL', [])
    .map((r) => toCard(r, req.user || null));
  res.json({ waterBodies, reports });
});
router.get('/my/reports', authRequired, requireRole('citizen'), (req, res) => {
  const rows = reportList('r.citizen_id = ?', [req.user.id]);
  const reports = rows.map((r) => toCard(r, req.user));
  const confirmations = db.prepare('SELECT COUNT(*) n FROM confirmations WHERE user_id = ?').get(req.user.id).n;
  const meaningful = reports.filter((r) => r.status !== 'rejected').length;
  const score = meaningful + confirmations;
  const level = score >= 10 ? 2 : (score >= 4 ? 1 : 0);
  res.json({ reports, badge: { level, reports: meaningful, confirmations } });
});

// Optional AI photo screening for the citizen report wizard.
router.post('/ai-check', authRequired, requireRole('citizen'), upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a photo first.' });
  const result = await checkPhotos([req.file.path]);
  if (result.status !== 'ok') {
    return res.json({ available: false, error: result.error || result.note || 'AI screening unavailable.' });
  }
  return res.json({
    available: true,
    result: {
      water_body_plausible: result.relevance === 'relevant',
      visible: result.indicators.map((x) => String(x).replace(/_/g, ' ')),
      note: result.note,
      followup_question: result.followup_question
    },
    sig: ''
  });
});

// Citizen report submission adapter for the existing browser form.
router.post('/reports', authRequired, requireRole('citizen'), upload.array('photos', 6), async (req, res) => {
  const body = req.body || {};
  const type = String(body.type || '');
  if (!['pond', 'lake', 'river', 'reservoir', 'tank', 'wetland', 'other'].includes(type)) {
    return res.status(400).json({ error: 'Select a valid water-body type.' });
  }
  const lat = body.lat === undefined || body.lat === '' ? null : Number(body.lat);
  const lng = body.lng === undefined || body.lng === '' ? null : Number(body.lng);
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng) ||
      lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'Choose a valid location on the map.' });
  }
  const rawIssues = Array.isArray(body.issues) ? body.issues : (body.issues ? [body.issues] : []);
  const issues = rawIssues.filter((x) => ISSUE_KEYS.includes(x));
  const name = String(body.name || '').trim().slice(0, 150);
  const address = String(body.address || '').trim().slice(0, 300);
  const notes = String(body.notes || '').trim().slice(0, 2000);
  const anonymous = ['true', '1', 'on'].includes(String(body.anonymous || '').toLowerCase());
  let waterBodyId = null;
  if (name) {
    const found = db.prepare('SELECT id FROM water_bodies WHERE name = ? COLLATE NOCASE').get(name);
    waterBodyId = found ? found.id : db.prepare(
      'INSERT INTO water_bodies (name,type,lat,lng,address) VALUES (?,?,NULL,NULL,?)'
    ).run(name, type, address || null).lastInsertRowid;
  }

  const code = makeReportCode(db);
  const inserted = db.prepare(
    `INSERT INTO reports
      (report_code,citizen_id,water_body_id,water_body_name_raw,water_body_type,lat,lng,address,
       gps_source,is_anonymous,observed_issues,additional_notes,is_demo)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0)`
  ).run(
    code, req.user.id, waterBodyId, name || null, type, lat, lng,
    address || null, 'device', anonymous ? 1 : 0, JSON.stringify(issues), notes || null
  );
  const reportId = inserted.lastInsertRowid;
  db.prepare(
    'INSERT INTO report_updates (report_id,actor_id,actor_role,status,remarks) VALUES (?,?,?,?,?)'
  ).run(reportId, req.user.id, req.user.role, 'submitted', 'Report submitted by citizen.');

  const files = req.files || [];
  for (const f of files) {
    const gps = f.exifGps || null;
    db.prepare(
      'INSERT INTO report_photos (report_id,filename,stage,captured_at,gps_lat,gps_lng,gps_source,uploaded_by) VALUES (?,?,?,?,?,?,?,?)'
    ).run(
      reportId, f.filename, 'evidence', new Date().toISOString(),
      gps ? gps.latitude : null, gps ? gps.longitude : null, gps ? 'exif' : 'unavailable', req.user.id
    );
  }
  let ai = null;
  if (files.length) {
    ai = await checkPhotos(files.slice(0, 3).map((f) => f.path));
    db.prepare(
      'UPDATE reports SET ai_relevance=?,ai_indicators=?,ai_followup=? WHERE id=?'
    ).run(
      ai.status === 'ok' ? ai.relevance : 'unchecked',
      JSON.stringify(ai.indicators || []),
      JSON.stringify({ status: ai.status, error: ai.error || '', note: ai.note || '', water_visible: ai.water_visible }),
      reportId
    );
  }
  if (!anonymous && req.user.email && !String(req.user.email).endsWith('.invalid')) {
    await sendMail({
      to: req.user.email,
      subject: 'HydroSense: Report ' + code + ' submitted',
      html: '<p>Hello ' + escapeHtml(req.user.name) + ',</p><p>Your report <b>' + code + '</b> has been submitted.</p>'
    });
  }
  const row = reportQuery('r.id = ?', [reportId]);
  res.status(201).json({ code, report: toCard(row, req.user), ai });
});

// Nearby reports adapter.
router.get('/reports/nearby', (req, res) => {
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'lat and lng are required.' });
  }
  const radius = Math.min(Math.max(Number(req.query.radius_m || 150), 30), 2000);
  const latD = radius / 111320;
  const lngD = radius / (111320 * Math.cos(lat * Math.PI / 180) || 1);
  const rows = db.prepare(
    `SELECT r.*, wb.name AS wb_name, wb.type AS joined_wb_type,
      (SELECT COUNT(*) FROM confirmations c WHERE c.report_id = r.id) AS confirmations
     FROM reports r LEFT JOIN water_bodies wb ON wb.id = r.water_body_id
     WHERE r.lat BETWEEN ? AND ? AND r.lng BETWEEN ? AND ?
       AND r.status NOT IN ('resolved','rejected') LIMIT 100`
  ).all(lat - latD, lat + latD, lng - lngD, lng + lngD);
  const rad = (v) => v * Math.PI / 180;
  const metres = (a, b, c, d) => {
    const x = Math.sin(rad(c - a) / 2) ** 2 +
      Math.cos(rad(a)) * Math.cos(rad(c)) * Math.sin(rad(d - b) / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  };
  const nearby = rows
    .map((r) => ({ item: toCard(r, null), distance: metres(lat, lng, r.lat, r.lng) }))
    .filter((x) => x.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .map((x) => x.item);
  res.json({ reports: nearby });
});

router.post('/reports/:code/confirm', authRequired, confirmLimiter, (req, res) => {
  const row = getByCode(req.params.code);
  if (!row) return res.status(404).json({ error: 'Report not found.' });
  if (row.citizen_id === req.user.id) return res.status(400).json({ error: "You can't confirm your own report." });
  try {
    db.prepare('INSERT INTO confirmations (report_id,user_id) VALUES (?,?)').run(row.id, req.user.id);
  } catch (_) {
    return res.status(409).json({ error: 'You already confirmed this report.' });
  }
  const n = db.prepare('SELECT COUNT(*) n FROM confirmations WHERE report_id = ?').get(row.id).n;
  if (n >= 5) {
    db.prepare("UPDATE reports SET priority = CASE WHEN priority='normal' THEN 'high' ELSE priority END WHERE id = ?").run(row.id);
  }
  res.json({ ok: true, confirmations: n });
});
router.post('/reports/:code/evidence', authRequired, requireRole('citizen'), upload.array('photos', 4), (req, res) => {
  const row = getByCode(req.params.code);
  if (!row) return res.status(404).json({ error: 'Report not found.' });
  if (row.citizen_id !== req.user.id) return res.status(403).json({ error: 'Not your report.' });
  const files = req.files || [];
  for (const f of files) {
    const gps = f.exifGps || null;
    db.prepare(
      'INSERT INTO report_photos (report_id,filename,stage,captured_at,gps_lat,gps_lng,gps_source,uploaded_by) VALUES (?,?,?,?,?,?,?,?)'
    ).run(
      row.id, f.filename, 'followup', new Date().toISOString(),
      gps ? gps.latitude : null, gps ? gps.longitude : null, gps ? 'exif' : 'unavailable', req.user.id
    );
  }
  res.json({ ok: true, uploaded: files.length });
});
router.get('/reports/:code/pdf', authRequired, requireRole('authority'), (req, res) => {
  const row = getByCode(req.params.code);
  if (!row) return res.status(404).json({ error: 'Report not found.' });
  const report = { ...row, water_body_name: row.wb_name || row.water_body_name_raw };
  const photos = db.prepare('SELECT * FROM report_photos WHERE report_id = ? ORDER BY created_at ASC').all(row.id);
  const timeline = db.prepare('SELECT * FROM report_updates WHERE report_id = ? ORDER BY created_at ASC').all(row.id);
  const inspections = db.prepare('SELECT * FROM inspections WHERE report_id = ? ORDER BY created_at ASC').all(row.id);
  const actions = db.prepare('SELECT * FROM actions WHERE report_id = ? ORDER BY created_at ASC').all(row.id);
  const confirmations = db.prepare('SELECT COUNT(*) n FROM confirmations WHERE report_id = ?').get(row.id).n;
  return reportCasePdf({ res, report, photos, timeline, inspections, actions, confirmCount: confirmations });
});
router.post('/reports/:code/ai-recheck', authRequired, requireRole('authority'), async (req, res) => {
  const row = getByCode(req.params.code);
  if (!row) return res.status(404).json({ error: 'Report not found.' });
  const photos = db.prepare(
    "SELECT filename FROM report_photos WHERE report_id = ? AND stage = 'evidence' ORDER BY id ASC LIMIT 3"
  ).all(row.id);
  if (!photos.length) return res.status(400).json({ error: 'This report has no evidence photos to check.' });
  const { UPLOAD_ROOT } = require('../middleware/upload');
  const result = await checkPhotos(photos.map((p) => path.join(UPLOAD_ROOT, path.basename(p.filename))));
  db.prepare('UPDATE reports SET ai_relevance=?,ai_indicators=?,ai_followup=? WHERE id=?').run(
    result.status === 'ok' ? result.relevance : 'unchecked',
    JSON.stringify(result.indicators || []),
    JSON.stringify({ status: result.status, error: result.error || '', note: result.note || '', water_visible: result.water_visible }),
    row.id
  );
  res.json({ ok: true, ai: result });
});
router.get('/reports/:code', authOptional, (req, res) => {
  const row = getByCode(req.params.code);
  if (!row) return res.status(404).json({ error: 'Report not found.' });
  res.json({ report: toDetail(row, req.user || null) });
});

// Authority dashboard compatibility routes.
router.get('/admin/stats', authRequired, requireRole('authority'), (req, res) => {
  const count = (where) => db.prepare('SELECT COUNT(*) n FROM reports WHERE ' + where).get().n;
  res.json({
    total: count("status != 'rejected'"),
    pending: count("status IN ('submitted','under_review')"),
    high: count("priority IN ('high','critical') AND status NOT IN ('resolved','rejected')"),
    inspection: count("status IN ('inspection_assigned','field_inspection')"),
    resolved: count("status='resolved'")
  });
});
router.get('/admin/reports', authRequired, requireRole('authority'), (req, res) => {
  const filters = [], params = [];
  if (req.query.status) { filters.push('r.status = ?'); params.push(req.query.status); }
  if (req.query.priority) { filters.push('r.priority = ?'); params.push(priorityFilter(req.query.priority)); }
  const rows = reportList(filters.length ? filters.join(' AND ') : '1=1', params);
  res.json({ reports: rows.map((r) => toCard(r, req.user)) });
});
router.get('/admin/alerts', authRequired, requireRole('authority'), (req, res) => {
  const rows = reportList(
    "r.priority IN ('high','critical') AND r.status NOT IN ('resolved','rejected')", []
  );
  res.json({
    alerts: rows.map((r) => ({
      ...toCard(r, req.user),
      reason: Number(r.confirmations || 0) >= 5 ? 'confirmations' : 'priority'
    }))
  });
});
router.get('/admin/export.csv', authRequired, requireRole('authority'), (req, res) => {
  const rows = reportList('1=1', []);
  const body = ['Report ID,Water body,Status,Priority,Date,Location,Anonymous']
    .concat(rows.map((r) => [
      r.report_code, r.wb_name || r.water_body_name_raw || '', r.status, r.priority,
      r.created_at, r.address || '', r.is_anonymous ? 'Yes' : 'No'
    ].map(csvCell).join(','))).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="hydrosense_reports.csv"');
  res.send(body);
});
router.post('/admin/reports/:code/status', authRequired, requireRole('authority'), (req, res) => {
  const row = getByCode(req.params.code);
  if (!row) return res.status(404).json({ error: 'Report not found.' });
  const status = String(req.body.status || '');
  const priority = dbPriority(req.body.priority || row.priority);
  if (!isValidStatus(status)) return res.status(400).json({ error: 'Invalid report status.' });
  if (!['low', 'normal', 'high', 'critical'].includes(priority)) return res.status(400).json({ error: 'Invalid priority.' });
  const remarks = String(req.body.remarks || '').trim().slice(0, 1000);
  db.transaction(() => {
    db.prepare("UPDATE reports SET status=?,priority=?,updated_at=datetime('now') WHERE id=?").run(status, priority, row.id);
    db.prepare(
      'INSERT INTO report_updates (report_id,actor_id,actor_role,status,remarks) VALUES (?,?,?,?,?)'
    ).run(row.id, req.user.id, 'authority', status, remarks || 'Status updated by authority.');
  })();
  const citizen = db.prepare('SELECT email,name FROM users WHERE id = ?').get(row.citizen_id);
  if (citizen && citizen.email && !String(citizen.email).endsWith('.invalid')) {
    sendMail({
      to: citizen.email,
      subject: 'HydroSense: Report ' + row.report_code + ' updated',
      html: '<p>Hello ' + escapeHtml(citizen.name) + ',</p><p>Your report <b>' +
        escapeHtml(row.report_code) + '</b> is now <b>' + escapeHtml(status.replace(/_/g, ' ')) +
        '</b>.</p><p>' + escapeHtml(remarks) + '</p>'
    });
  }
  res.json({ ok: true });
});
router.post('/admin/reports/:code/action', authRequired, requireRole('authority'), upload.array('photos', 4), (req, res) => {
  const row = getByCode(req.params.code);
  if (!row) return res.status(404).json({ error: 'Report not found.' });
  const description = String(req.body.description || '').trim().slice(0, 2000);
  if (description.length < 3) return res.status(400).json({ error: 'Describe the action taken.' });
  const date = new Date().toISOString().slice(0, 10);
  db.prepare('INSERT INTO actions (report_id,recorded_by,action_taken,action_date) VALUES (?,?,?,?)')
    .run(row.id, req.user.id, description, date);
  for (const f of (req.files || [])) {
    db.prepare(
      'INSERT INTO report_photos (report_id,filename,stage,captured_at,uploaded_by) VALUES (?,?,?,?,?)'
    ).run(row.id, f.filename, 'action_after', new Date().toISOString(), req.user.id);
  }
  db.transaction(() => {
    db.prepare("UPDATE reports SET status='action_taken',updated_at=datetime('now') WHERE id=?").run(row.id);
    db.prepare(
      'INSERT INTO report_updates (report_id,actor_id,actor_role,status,remarks) VALUES (?,?,?,?,?)'
    ).run(row.id, req.user.id, 'authority', 'action_taken', description);
  })();
  res.status(201).json({ ok: true });
});
router.post('/admin/reports/:code/inspection', authRequired, requireRole('authority'), (req, res) => {
  const row = getByCode(req.params.code);
  if (!row) return res.status(404).json({ error: 'Report not found.' });
  const f = req.body.fields || {}, s = req.body.stress || {};
  const obs = (value) => value === 'observed' ? 1 : 0;
  db.prepare(
    `INSERT INTO inspections
      (report_id,inspector_id,inspection_date,observed_condition,visible_pollution,sewage_inflow,
       solid_waste,aquatic_vegetation,fish_condition,odour,water_appearance,additional_findings,
       fish_mortality_observed,invasive_plants_observed,biodiversity_reduced_observed,habitat_disturbance_observed)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    row.id, req.user.id, new Date().toISOString().slice(0, 10), 'Recorded by authority',
    obs(f.visible_pollution), obs(f.sewage_inflow), obs(f.solid_waste), obs(f.vegetation),
    f.fish_condition || 'unable', f.odour || 'unable', f.water_appearance || 'unable',
    String(req.body.notes || '').slice(0, 2000),
    s.fish_mortality ? 1 : 0, s.invasive_plants ? 1 : 0,
    s.biodiversity_reduction ? 1 : 0, s.habitat_disturbance ? 1 : 0
  );
  db.transaction(() => {
    db.prepare("UPDATE reports SET status='field_inspection',updated_at=datetime('now') WHERE id=?").run(row.id);
    db.prepare(
      'INSERT INTO report_updates (report_id,actor_id,actor_role,status,remarks) VALUES (?,?,?,?,?)'
    ).run(row.id, req.user.id, 'authority', 'field_inspection', 'Field inspection recorded by authority.');
  })();
  res.status(201).json({ ok: true });
});
router.delete('/admin/reports/:code', authRequired, requireRole('authority'), (req, res) => {
  const row = getByCode(req.params.code);
  if (!row) return res.status(404).json({ error: 'Report not found.' });
  const files = db.prepare('SELECT filename FROM report_photos WHERE report_id = ?').all(row.id);
  db.transaction(() => {
    db.prepare('INSERT INTO report_deletions (report_code,deleted_by,reason) VALUES (?,?,?)')
      .run(row.report_code, req.user.id, 'Removed by authority from the HydroSense dashboard.');
    db.prepare('DELETE FROM reports WHERE id = ?').run(row.id);
  })();
  for (const f of files) {
    try { fs.unlinkSync(path.join(UPLOAD_ROOT, path.basename(f.filename))); } catch (_) {}
  }
  res.json({ ok: true });
});

// Water-body directory/profile compatibility.
router.get('/water-bodies', (req, res) => {
  const rows = db.prepare(
    `SELECT wb.*,
      (SELECT COUNT(*) FROM reports r WHERE r.water_body_id=wb.id) AS reports,
      (SELECT COUNT(*) FROM reports r WHERE r.water_body_id=wb.id AND r.status NOT IN ('resolved','rejected')) AS open_reports
     FROM water_bodies wb ORDER BY reports DESC`
  ).all();
  res.json({ waterBodies: rows });
});
router.get('/water-bodies/:id', authOptional, (req, res) => {
  const wb = db.prepare('SELECT * FROM water_bodies WHERE id = ?').get(req.params.id);
  if (!wb) return res.status(404).json({ error: 'Water body not found.' });
  const rawReports = reportList('r.water_body_id = ?', [wb.id]);
  const reports = rawReports.map((r) => toCard(r, req.user || null));
  const ids = rawReports.map((r) => r.id);
  let inspections = [], actions = [], photos = [], confirmations = 0, fwri = null;
  if (ids.length) {
    const marks = ids.map(() => '?').join(',');
    inspections = db.prepare(
      'SELECT * FROM inspections WHERE report_id IN (' + marks + ') ORDER BY created_at DESC'
    ).all(...ids);
    actions = db.prepare(
      'SELECT a.*,r.report_code FROM actions a JOIN reports r ON r.id=a.report_id WHERE a.report_id IN (' +
      marks + ') ORDER BY a.created_at DESC'
    ).all(...ids).map((a) => ({ ...a, code: a.report_code, description: a.action_taken }));
    photos = db.prepare(
      'SELECT p.*,r.report_code FROM report_photos p JOIN reports r ON r.id=p.report_id WHERE p.report_id IN (' +
      marks + ') ORDER BY p.created_at DESC'
    ).all(...ids).map((p) => ({
      ...p,
      kind: p.stage === 'evidence' ? 'before' : 'after',
      url: '/uploads/' + encodeURIComponent(path.basename(p.filename))
    }));
    confirmations = db.prepare(
      'SELECT COUNT(*) n FROM confirmations WHERE report_id IN (' + marks + ')'
    ).get(...ids).n;
    const index = computeFoodWebIndex(inspections);
    fwri = index ? {
      score: index.score, level: index.label, count: index.basis,
      disclaimer: index.disclaimer
    } : null;
  }
  res.json({ waterBody: wb, fwri, reports, inspections, actions, photos, confirmations });
});

// News list, posting and deletion used by the SPA.
router.get('/news', (req, res) => {
  const rows = db.prepare(
    `SELECT n.*,u.name AS author_name,wb.name AS water_body_name
     FROM news_posts n LEFT JOIN users u ON u.id=n.author_id
     LEFT JOIN water_bodies wb ON wb.id=n.water_body_id
     WHERE n.status='published' ORDER BY COALESCE(n.created_at,'') DESC LIMIT 100`
  ).all();
  res.json({
    news: rows.map((n) => ({
      id: n.id, title: n.title,
      category: NEWS_CATEGORY_FROM_DB[n.category] || 'general',
      body: n.summary, author: n.author_name || 'HydroSense',
      created_at: n.created_at, is_demo: !!n.is_demo,
      publisher: n.source_publisher || null, water_body_name: n.water_body_name || ''
    }))
  });
});
router.post('/news', authRequired, requireRole('authority'), (req, res) => {
  const title = String(req.body.title || '').trim().slice(0, 150);
  const body = String(req.body.body || '').trim().slice(0, 2000);
  const category = NEWS_CATEGORY_TO_DB[req.body.category] || 'community_update';
  if (title.length < 3 || body.length < 3) return res.status(400).json({ error: 'Enter a title and summary.' });
  const id = db.prepare(
    'INSERT INTO news_posts (author_id,title,category,summary,status,is_demo) VALUES (?,?,?,?,?,0)'
  ).run(req.user.id, title, category, body, 'published').lastInsertRowid;
  res.status(201).json({ ok: true, id });
});
router.delete('/news/:id', authRequired, requireRole('authority'), (req, res) => {
  const info = db.prepare('DELETE FROM news_posts WHERE id = ?').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'News item not found.' });
  res.json({ ok: true });
});

module.exports = router;
