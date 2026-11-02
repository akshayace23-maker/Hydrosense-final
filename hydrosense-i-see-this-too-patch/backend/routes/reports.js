// routes/reports.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const { body, validationResult, query } = require('express-validator');

const db = require('../db/init');
const { authRequired, authOptional, requireRole } = require('../middleware/auth');
const { upload, UPLOAD_ROOT } = require('../middleware/upload');
const { makeReportCode, escapeHtml, sendMail } = require('../utils');
const { checkPhotos, isConfigured: aiConfigured } = require('../ai/photoCheck');
const { reportCasePdf } = require('../pdf/generate');

const router = express.Router();

const STATUS_FLOW = [
  'submitted', 'under_review', 'verified', 'inspection_assigned',
  'field_inspection', 'action_planned', 'action_taken',
  'follow_up_required', 'resolved', 'reopened', 'rejected',
];

const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { error: 'Too many reports submitted. Please slow down.' } });
const confirmLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 60, message: { error: 'Too many confirmations. Please slow down.' } });

function tryExtractExif(filePath) {
  try {
    const exifr = require('exifr');
    return exifr.gps(filePath); // returns {latitude, longitude} or undefined, never throws async here
  } catch (e) {
    return Promise.resolve(undefined);
  }
}

function findOrCreateWaterBody({ name, type, lat, lng, address }) {
  if (!name) return null;
  const existing = db.prepare('SELECT * FROM water_bodies WHERE name = ? COLLATE NOCASE').get(name);
  if (existing) return existing.id;
  const info = db
    .prepare('INSERT INTO water_bodies (name, type, lat, lng, address) VALUES (?,?,?,?,?)')
    .run(name, type || 'other', lat || null, lng || null, address || null);
  return info.lastInsertRowid;
}

// Never let the reporter's internal user id leave the server except to the reporter themself.
function publicReport(r, viewer) {
  const out = { ...r };
  const isOwner = !!viewer && viewer.role === 'citizen' && r.citizen_id === viewer.id;
  out.is_owner = isOwner;
  delete out.citizen_id;
  return out;
}

function saveAiResult(reportId, ai) {
  db.prepare('UPDATE reports SET ai_relevance = ?, ai_indicators = ?, ai_followup = ? WHERE id = ?').run(
    ai.status === 'ok' ? ai.relevance : 'unchecked',
    JSON.stringify(ai.indicators || []),
    JSON.stringify({ status: ai.status, error: ai.error || '', note: ai.note || '', water_visible: ai.water_visible, question: ai.followup_question || '', options: ai.followup_options || [] }),
    reportId
  );
}

function recordUpdate(reportId, actor, status, remarks) {
  db.prepare('INSERT INTO report_updates (report_id, actor_id, actor_role, status, remarks) VALUES (?,?,?,?,?)').run(
    reportId, actor ? actor.id : null, actor ? actor.role : 'system', status, remarks || null
  );
  db.prepare('UPDATE reports SET status = ?, updated_at = datetime(\'now\') WHERE id = ?').run(status, reportId);
}

// ---------- PUBLIC HEADLINE NUMBERS (no personal data) ----------
router.get('/public-stats', (req, res) => {
  const one = (sql) => db.prepare(sql).get().c;
  res.json({
    reports: one("SELECT COUNT(*) c FROM reports WHERE status != 'rejected'"),
    resolved: one("SELECT COUNT(*) c FROM reports WHERE status = 'resolved'"),
    active: one("SELECT COUNT(*) c FROM reports WHERE status NOT IN ('resolved','rejected')"),
    water_bodies: one('SELECT COUNT(*) c FROM water_bodies'),
    confirmations: one('SELECT COUNT(*) c FROM confirmations'),
  });
});

// Is the AI photo check switched on? (lets the report form tell people honestly)
router.get('/ai-status', (req, res) => res.json({ configured: aiConfigured() }));

// ---------- CREATE REPORT (citizen) ----------
router.post(
  '/',
  authRequired,
  requireRole('citizen'),
  submitLimiter,
  upload.array('photos', 6),
  [
    body('water_body_type').isIn(['pond', 'lake', 'river', 'reservoir', 'tank', 'wetland', 'other']),
    body('lat').optional({ checkFalsy: true }).isFloat({ min: -90, max: 90 }),
    body('lng').optional({ checkFalsy: true }).isFloat({ min: -180, max: 180 }),
    body('is_anonymous').optional().isBoolean().toBoolean(),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    const {
      water_body_name, water_body_type, lat, lng, address,
      observed_issues, additional_notes, is_anonymous,
    } = req.body;

    if (water_body_name && String(water_body_name).length > 150) return res.status(400).json({ error: 'Water body name is too long (max 150 characters).' });
    if (address && String(address).length > 300) return res.status(400).json({ error: 'Address is too long (max 300 characters).' });

    let issues = [];
    try { issues = JSON.parse(observed_issues || '[]'); } catch (e) { issues = []; }
    if (!Array.isArray(issues)) issues = [];

    const water_body_id = findOrCreateWaterBody({
      name: water_body_name, type: water_body_type, lat, lng, address,
    });

    const report_code = makeReportCode(db);
    const info = db.prepare(`
      INSERT INTO reports (report_code, citizen_id, water_body_id, water_body_name_raw, water_body_type,
        lat, lng, address, gps_source, is_anonymous, observed_issues, additional_notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      report_code, req.user.id, water_body_id || null, water_body_name || null, water_body_type,
      lat || null, lng || null, address || null, (lat && lng) ? 'device' : 'unavailable',
      is_anonymous ? 1 : 0, JSON.stringify(issues), additional_notes ? String(additional_notes).slice(0, 2000) : null
    );
    const reportId = info.lastInsertRowid;
    recordUpdate(reportId, req.user, 'submitted', 'Report submitted by citizen.');

    // Store photos + best-effort EXIF GPS + best-effort AI relevance check on the first photo.
    const files = req.files || [];
    let aiResult = null;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      let gps;
      gps = f.exifGps;
      db.prepare(`
        INSERT INTO report_photos (report_id, filename, stage, captured_at, gps_lat, gps_lng, gps_source, uploaded_by)
        VALUES (?,?,?,?,?,?,?,?)
      `).run(
        reportId, f.filename, 'evidence', new Date().toISOString(),
        gps ? gps.latitude : null, gps ? gps.longitude : null, gps ? 'exif' : 'unavailable',
        req.user.id
      );
    }
    if (files.length) aiResult = await checkPhotos(files.map((f) => f.path));

    if (aiResult) saveAiResult(reportId, aiResult);

    const citizen = db.prepare('SELECT email, name FROM users WHERE id = ?').get(req.user.id);
    sendMail({
      to: citizen.email,
      subject: `HydroSense: Report ${report_code} submitted`,
      html: `<p>Hi ${escapeHtml(citizen.name)},</p><p>Your report <b>${escapeHtml(report_code)}</b> has been submitted and is now <b>Submitted</b>. You can track it anytime using this Report ID.</p>`,
    });

    res.status(201).json({
      report: { id: reportId, report_code, status: 'submitted' },
      ai: aiResult,
    });
  }
);

// ---------- LIST MY REPORTS (citizen) ----------
router.get('/mine', authRequired, requireRole('citizen'), (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, wb.name as water_body_name
    FROM reports r LEFT JOIN water_bodies wb ON wb.id = r.water_body_id
    WHERE r.citizen_id = ? ORDER BY r.created_at DESC
  `).all(req.user.id);

  // Simple, non-competitive recognition: based on meaningful contribution
  // (reports filed + confirmations given), never on report volume alone
  // being treated as a race, and never rewarding unverified/rejected reports.
  const confirmationsGiven = db.prepare('SELECT COUNT(*) c FROM confirmations WHERE user_id = ?').get(req.user.id).c;
  const meaningfulReports = rows.filter((r) => r.status !== 'rejected').length;
  const score = meaningfulReports + confirmationsGiven;
  let badge = 'New Observer';
  if (score >= 10) badge = 'Water Guardian';
  else if (score >= 4) badge = 'Active Reporter';

  res.json({ reports: rows.map((r) => publicReport(r, req.user)), recognition: { badge, reports: meaningfulReports, confirmations: confirmationsGiven } });
});

// ---------- LIST ALL REPORTS (authority, filterable) ----------
router.get('/', authRequired, requireRole('authority'), (req, res) => {
  const { status, category, water_body_id, priority } = req.query;
  let sql = `SELECT r.*, wb.name as water_body_name, u.name as citizen_name, u.email as citizen_email
             FROM reports r LEFT JOIN water_bodies wb ON wb.id = r.water_body_id
             LEFT JOIN users u ON u.id = r.citizen_id WHERE 1=1`;
  const params = [];
  if (status) { sql += ' AND r.status = ?'; params.push(status); }
  if (water_body_id) { sql += ' AND r.water_body_id = ?'; params.push(water_body_id); }
  if (priority) { sql += ' AND r.priority = ?'; params.push(priority); }
  sql += ' ORDER BY r.created_at DESC LIMIT 500';
  let rows = db.prepare(sql).all(...params);
  if (category) {
    rows = rows.filter((r) => JSON.parse(r.observed_issues || '[]').includes(category));
  }
  // Mask identity for anonymous reports.
  rows = rows.map((r) => {
    const o = publicReport(r, req.user);
    return r.is_anonymous ? { ...o, citizen_name: 'Anonymous citizen', citizen_email: null } : o;
  });
  res.json({ reports: rows });
});

// ---------- CSV EXPORT (authority) ----------
router.get('/export.csv', authRequired, requireRole('authority'), (req, res) => {
  const rows = db.prepare(`
    SELECT r.report_code, r.status, r.priority, r.water_body_type, wb.name as water_body_name,
           r.address, r.created_at, r.updated_at, r.is_anonymous
    FROM reports r LEFT JOIN water_bodies wb ON wb.id = r.water_body_id ORDER BY r.created_at DESC
  `).all();
  const header = 'Report ID,Status,Priority,Water Body Type,Water Body Name,Address,Created,Updated,Anonymous\n';
  const body = rows.map((r) => [
    r.report_code, r.status, r.priority, r.water_body_type, r.water_body_name || '',
    (r.address || '').replace(/,/g, ';'), r.created_at, r.updated_at, r.is_anonymous ? 'Yes' : 'No',
  ].join(',')).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="hydrosense_reports.csv"');
  res.send(header + body);
});

// ---------- PUBLIC TRACK BY CODE (no login) ----------
router.get('/track/:code', (req, res) => {
  const r = db.prepare(`
    SELECT r.report_code, r.status, r.priority, r.water_body_type, r.created_at, r.updated_at,
           wb.name as water_body_name
    FROM reports r LEFT JOIN water_bodies wb ON wb.id = r.water_body_id
    WHERE r.report_code = ?
  `).get(req.params.code.trim().toUpperCase());
  if (!r) return res.status(404).json({ error: 'No report found with that Report ID.' });
  const timeline = db.prepare('SELECT status, remarks, created_at FROM report_updates WHERE report_id = (SELECT id FROM reports WHERE report_code = ?) ORDER BY created_at ASC').all(req.params.code.trim().toUpperCase());
  res.json({ report: r, timeline });
});

// ---------- PUBLIC MAP POINTS (no login; used by GIS map for markers/heatmap) ----------
router.get('/map/points', (req, res) => {
  const { status, category, priority, days } = req.query;
  let sql = `SELECT id, report_code, lat, lng, status, priority, water_body_type, observed_issues, created_at
             FROM reports WHERE lat IS NOT NULL AND lng IS NOT NULL`;
  const params = [];
  if (status) { sql += ' AND status = ?'; params.push(status); }
  if (priority) { sql += ' AND priority = ?'; params.push(priority); }
  if (days) { sql += " AND created_at >= datetime('now', ?)"; params.push(`-${parseInt(days, 10)} days`); }
  sql += ' ORDER BY created_at DESC LIMIT 1000';
  let rows = db.prepare(sql).all(...params);
  if (category) rows = rows.filter((r) => JSON.parse(r.observed_issues || '[]').includes(category));
  res.json({ points: rows.map((r) => ({ id: r.id, report_code: r.report_code, lat: r.lat, lng: r.lng, status: r.status, priority: r.priority, created_at: r.created_at })) });
});

// ---------- NEARBY REPORTS (public; surfaces "I See This Too" before a duplicate is filed) ----------
// Uses a simple bounding-box + haversine distance check (no PostGIS/SpatiaLite needed).
// radius_m defaults to 150m — close enough to be "the same spot", not "the same town".
router.get('/nearby', (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  const radiusM = Math.min(parseInt(req.query.radius_m, 10) || 150, 2000);
  if (isNaN(lat) || isNaN(lng)) return res.status(400).json({ error: 'lat and lng are required.' });

  const latDelta = radiusM / 111320; // ~meters per degree latitude
  const lngDelta = radiusM / (111320 * Math.cos((lat * Math.PI) / 180) || 1);

  const rows = db.prepare(`
    SELECT r.id, r.report_code, r.status, r.observed_issues, r.lat, r.lng, r.created_at,
           wb.name as water_body_name
    FROM reports r LEFT JOIN water_bodies wb ON wb.id = r.water_body_id
    WHERE r.lat BETWEEN ? AND ? AND r.lng BETWEEN ? AND ?
      AND r.status NOT IN ('resolved', 'rejected')
    ORDER BY r.created_at DESC LIMIT 10
  `).all(lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta);

  function haversineM(lat1, lon1, lat2, lon2) {
    const R = 6371000, toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  const nearby = rows
    .map((r) => ({ ...r, distance_m: Math.round(haversineM(lat, lng, r.lat, r.lng)) }))
    .filter((r) => r.distance_m <= radiusM)
    .sort((a, b) => a.distance_m - b.distance_m);

  res.json({ nearby });
});

// ---------- COMMUNITY LIST (public): open reports that neighbours can back with "I See This Too" ----------
// No reporter identity is ever returned. Guests see the counts; signed-in citizens can confirm.
router.get('/community', authOptional, (req, res) => {
  const uid = req.user ? req.user.id : -1;
  const rows = db.prepare(`
    SELECT r.id, r.report_code, r.status, r.priority, r.water_body_type, r.observed_issues, r.created_at, r.citizen_id,
           wb.name as water_body_name,
           (SELECT COUNT(*) FROM confirmations c WHERE c.report_id = r.id) as confirm_count,
           EXISTS(SELECT 1 FROM confirmations c WHERE c.report_id = r.id AND c.user_id = ?) as i_confirmed
    FROM reports r LEFT JOIN water_bodies wb ON wb.id = r.water_body_id
    WHERE r.status NOT IN ('resolved', 'rejected')
    ORDER BY r.created_at DESC LIMIT 100
  `).all(uid);
  const isCitizen = !!req.user && req.user.role === 'citizen';
  res.json({
    viewer: req.user ? req.user.role : 'guest',
    reports: rows.map((r) => {
      let issues = []; try { issues = JSON.parse(r.observed_issues || '[]'); } catch (e) { /* ignore */ }
      return {
        id: r.id, report_code: r.report_code, status: r.status, priority: r.priority,
        water_body_type: r.water_body_type, water_body_name: r.water_body_name, issues,
        created_at: r.created_at, confirm_count: r.confirm_count,
        i_confirmed: !!r.i_confirmed, is_mine: isCitizen && r.citizen_id === uid,
      };
    }),
  });
});

// ---------- ALERTS (authority): open high/critical priority reports ----------
router.get('/alerts', authRequired, requireRole('authority'), (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, r.report_code, r.status, r.priority, r.created_at, wb.name as water_body_name,
      (SELECT COUNT(*) FROM confirmations c WHERE c.report_id = r.id) as confirm_count
    FROM reports r LEFT JOIN water_bodies wb ON wb.id = r.water_body_id
    WHERE r.priority IN ('high','critical') AND r.status NOT IN ('resolved','rejected')
    ORDER BY CASE r.priority WHEN 'critical' THEN 0 ELSE 1 END, r.created_at DESC
  `).all();
  const alerts = rows.map((r) => ({
    ...r,
    level: r.priority === 'critical' ? 'Critical' : 'High',
    reason: r.confirm_count >= 5 ? `${r.confirm_count} community confirmations` : 'Marked high priority by authority review',
  }));
  res.json({ alerts });
});


// ---------- CASE REPORT PDF (authority) ----------
router.get('/:id/pdf', authRequired, requireRole('authority'), (req, res) => {
  const r = db.prepare(`
    SELECT r.*, wb.name as water_body_name FROM reports r
    LEFT JOIN water_bodies wb ON wb.id = r.water_body_id WHERE r.id = ?
  `).get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Report not found.' });
  const photos = db.prepare('SELECT stage, created_at, gps_source FROM report_photos WHERE report_id = ? ORDER BY created_at ASC').all(r.id);
  const timeline = db.prepare('SELECT status, remarks, created_at FROM report_updates WHERE report_id = ? ORDER BY created_at ASC').all(r.id);
  const inspections = db.prepare('SELECT * FROM inspections WHERE report_id = ? ORDER BY created_at ASC').all(r.id);
  const actions = db.prepare('SELECT * FROM actions WHERE report_id = ? ORDER BY created_at ASC').all(r.id);
  const confirmCount = db.prepare('SELECT COUNT(*) c FROM confirmations WHERE report_id = ?').get(r.id).c;
  reportCasePdf({ res, report: r, photos, timeline, inspections, actions, confirmCount });
});

router.get('/:id', authRequired, (req, res) => {
  const r = db.prepare(`
    SELECT r.*, wb.name as water_body_name, u.name as citizen_name, u.email as citizen_email, u.phone as citizen_phone
    FROM reports r LEFT JOIN water_bodies wb ON wb.id = r.water_body_id
    LEFT JOIN users u ON u.id = r.citizen_id WHERE r.id = ?
  `).get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Report not found.' });
  const isOwner = req.user.role === 'citizen' && r.citizen_id === req.user.id;
  const ownerId = r.citizen_id; // kept server-side only (badge lookup below)
  // Any logged-in citizen can view a report to confirm it ("I See This Too");
  // only the owner or an authority ever see the reporter's real identity.
  if (r.is_anonymous || (!isOwner && req.user.role !== 'authority')) {
    r.citizen_name = isOwner ? r.citizen_name : 'Anonymous citizen';
    r.citizen_email = isOwner ? r.citizen_email : null;
    r.citizen_phone = isOwner ? r.citizen_phone : null;
  }
  // An authority viewing an anonymous report must not learn who filed it.
  if (r.is_anonymous && !isOwner) { r.citizen_name = 'Anonymous citizen'; r.citizen_email = null; r.citizen_phone = null; }
  // Meaningful-contribution recognition for the reporting citizen (never shown for anonymous reports).
  let citizenBadge = null;
  if (!r.is_anonymous) {
    const reportCount = db.prepare("SELECT COUNT(*) c FROM reports WHERE citizen_id = ? AND status != 'rejected'").get(ownerId).c;
    const confirmCount2 = db.prepare('SELECT COUNT(*) c FROM confirmations WHERE user_id = ?').get(ownerId).c;
    const score = reportCount + confirmCount2;
    citizenBadge = score >= 10 ? 'Water Guardian' : (score >= 4 ? 'Active Reporter' : 'New Observer');
  }
  const photos = db.prepare('SELECT id, filename, stage, captured_at, gps_lat, gps_lng, gps_source FROM report_photos WHERE report_id = ? ORDER BY created_at ASC').all(r.id);
  const timeline = db.prepare('SELECT status, remarks, actor_role, created_at FROM report_updates WHERE report_id = ? ORDER BY created_at ASC').all(r.id);
  const confirmCount = db.prepare('SELECT COUNT(*) c FROM confirmations WHERE report_id = ?').get(r.id).c;
  const iConfirmed = db.prepare('SELECT 1 FROM confirmations WHERE report_id = ? AND user_id = ?').get(r.id, req.user.id) ? true : false;
  const inspections = db.prepare('SELECT * FROM inspections WHERE report_id = ? ORDER BY created_at DESC').all(r.id);
  const actions = db.prepare('SELECT * FROM actions WHERE report_id = ? ORDER BY created_at DESC').all(r.id);
  res.json({ report: publicReport({ ...r, citizen_id: ownerId }, req.user), photos, timeline, confirmCount, iConfirmed, inspections, actions, citizenBadge });
});

// ---------- "I SEE THIS TOO" ----------
router.post('/:id/confirm', authRequired, requireRole('citizen'), confirmLimiter, (req, res) => {
  const report = db.prepare('SELECT id, citizen_id FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  if (report.citizen_id === req.user.id) {
    return res.status(400).json({ error: "You can't confirm your own report." });
  }
  try {
    db.prepare('INSERT INTO confirmations (report_id, user_id) VALUES (?,?)').run(report.id, req.user.id);
  } catch (e) {
    return res.status(409).json({ error: 'You already confirmed this report.' });
  }
  const count = db.prepare('SELECT COUNT(*) c FROM confirmations WHERE report_id = ?').get(report.id).c;
  if (count >= 5) {
    db.prepare("UPDATE reports SET priority = CASE WHEN priority = 'normal' THEN 'high' ELSE priority END WHERE id = ?").run(report.id);
  }
  res.json({ ok: true, confirmCount: count });
});

// ---------- FOLLOW-UP PHOTO UPLOAD (citizen, own report) ----------
router.post('/:id/followup-photo', authRequired, requireRole('citizen'), upload.array('photos', 4), async (req, res) => {
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  if (report.citizen_id !== req.user.id) return res.status(403).json({ error: 'Not your report.' });
  const files = req.files || [];
  for (const f of files) {
    let gps;
    gps = f.exifGps;
    db.prepare(`INSERT INTO report_photos (report_id, filename, stage, captured_at, gps_lat, gps_lng, gps_source, uploaded_by)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      report.id, f.filename, 'followup', new Date().toISOString(),
      gps ? gps.latitude : null, gps ? gps.longitude : null, gps ? 'exif' : 'unavailable', req.user.id
    );
  }
  res.json({ ok: true, uploaded: files.length });
});

// ---------- STATUS UPDATE (authority) ----------
router.post(
  '/:id/status',
  authRequired,
  requireRole('authority'),
  [body('status').isIn(STATUS_FLOW), body('remarks').optional().isString().isLength({ max: 1000 })],
  (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found.' });

    recordUpdate(report.id, req.user, req.body.status, req.body.remarks);

    const citizen = db.prepare('SELECT email, name FROM users WHERE id = ?').get(report.citizen_id);
    sendMail({
      to: citizen.email,
      subject: `HydroSense: Report ${report.report_code} — ${req.body.status.replace(/_/g, ' ')}`,
      html: `<p>Hi ${escapeHtml(citizen.name)},</p><p>Your report <b>${escapeHtml(report.report_code)}</b> is now <b>${escapeHtml(req.body.status.replace(/_/g, ' '))}</b>.</p><p>${escapeHtml(req.body.remarks || '')}</p>`,
    });

    res.json({ ok: true });
  }
);

// ---------- PRIORITY UPDATE (authority) ----------
router.post('/:id/priority', authRequired, requireRole('authority'), [body('priority').isIn(['low', 'normal', 'high', 'critical'])], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Invalid priority.' });
  const info = db.prepare('UPDATE reports SET priority = ? WHERE id = ?').run(req.body.priority, req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Report not found.' });
  res.json({ ok: true });
});

// ---------- INSPECTION RECORD (authority) ----------
router.post('/:id/inspection', authRequired, requireRole('authority'), (req, res) => {
  const report = db.prepare('SELECT id FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  const b = req.body;
  db.prepare(`INSERT INTO inspections (report_id, inspector_id, inspection_date, observed_condition,
      visible_pollution, sewage_inflow, solid_waste, aquatic_vegetation, fish_condition, odour,
      water_appearance, additional_findings, recommended_intervention,
      fish_mortality_observed, invasive_plants_observed, biodiversity_reduced_observed, habitat_disturbance_observed)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    report.id, req.user.id, b.inspection_date || new Date().toISOString().slice(0, 10),
    b.observed_condition || null, b.visible_pollution ? 1 : 0, b.sewage_inflow ? 1 : 0,
    b.solid_waste ? 1 : 0, b.aquatic_vegetation ? 1 : 0, b.fish_condition || null, b.odour || null,
    b.water_appearance || null, b.additional_findings || null, b.recommended_intervention || null,
    b.fish_mortality_observed ? 1 : 0, b.invasive_plants_observed ? 1 : 0,
    b.biodiversity_reduced_observed ? 1 : 0, b.habitat_disturbance_observed ? 1 : 0
  );
  recordUpdate(report.id, req.user, 'field_inspection', 'Field inspection recorded.');
  res.status(201).json({ ok: true });
});

// ---------- ACTION RECORD + EVIDENCE (authority) ----------
router.post('/:id/action', authRequired, requireRole('authority'), upload.array('photos', 4), async (req, res) => {
  const report = db.prepare('SELECT id FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  const { action_taken, action_date } = req.body;
  if (!action_taken) return res.status(400).json({ error: 'Describe the action taken.' });
  db.prepare('INSERT INTO actions (report_id, recorded_by, action_taken, action_date) VALUES (?,?,?,?)').run(
    report.id, req.user.id, String(action_taken).slice(0, 2000), action_date || new Date().toISOString().slice(0, 10)
  );
  const files = req.files || [];
  for (const f of files) {
    db.prepare(`INSERT INTO report_photos (report_id, filename, stage, captured_at, uploaded_by) VALUES (?,?,?,?,?)`).run(
      report.id, f.filename, 'action_after', new Date().toISOString(), req.user.id
    );
  }
  recordUpdate(report.id, req.user, 'action_taken', action_taken);
  res.status(201).json({ ok: true });
});

// ---------- RE-RUN AI PHOTO CHECK (authority) ----------
router.post('/:id/ai-recheck', authRequired, requireRole('authority'), async (req, res) => {
  const report = db.prepare('SELECT id FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  const photos = db.prepare("SELECT filename FROM report_photos WHERE report_id = ? AND stage = 'evidence' ORDER BY id ASC LIMIT 3").all(report.id);
  if (!photos.length) return res.status(400).json({ error: 'This report has no evidence photos to check.' });
  const ai = await checkPhotos(photos.map((p) => path.join(UPLOAD_ROOT, path.basename(p.filename))));
  saveAiResult(report.id, ai);
  res.json({ ok: true, ai });
});

// ---------- DELETE REPORT (authority) ----------
// Hard delete with a mandatory reason; a minimal audit row (no citizen identity) is kept.
router.delete('/:id', authRequired, requireRole('authority'), [body('reason').isString().trim().isLength({ min: 5, max: 500 })], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ error: 'Please give a reason (5–500 characters) for deleting this report.' });
  const report = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!report) return res.status(404).json({ error: 'Report not found.' });
  const photos = db.prepare('SELECT filename FROM report_photos WHERE report_id = ?').all(report.id);
  const citizen = db.prepare('SELECT email, name FROM users WHERE id = ?').get(report.citizen_id);

  db.transaction(() => {
    db.prepare('INSERT INTO report_deletions (report_code, deleted_by, reason) VALUES (?,?,?)').run(report.report_code, req.user.id, req.body.reason);
    db.prepare('DELETE FROM reports WHERE id = ?').run(report.id); // child rows cascade
  })();

  for (const p of photos) {
    try { fs.unlinkSync(path.join(UPLOAD_ROOT, path.basename(p.filename))); } catch (e) { /* already gone */ }
  }
  if (citizen) {
    sendMail({
      to: citizen.email,
      subject: `HydroSense: Report ${report.report_code} was removed`,
      html: `<p>Hi ${escapeHtml(citizen.name)},</p><p>Your report <b>${escapeHtml(report.report_code)}</b> was removed by the reviewing authority.</p><p>Reason: ${escapeHtml(req.body.reason)}</p>`,
    });
  }
  res.json({ ok: true });
});

// ---------- BASIC ANALYTICS (authority) ----------
router.get('/stats/summary', authRequired, requireRole('authority'), (req, res) => {
  const byStatus = db.prepare('SELECT status, COUNT(*) n FROM reports GROUP BY status').all();
  const total = db.prepare('SELECT COUNT(*) n FROM reports').get().n;
  const byDay = db.prepare(`SELECT date(created_at) d, COUNT(*) n FROM reports WHERE created_at >= datetime('now','-30 days') GROUP BY d ORDER BY d`).all();
  const categories = {};
  for (const row of db.prepare('SELECT observed_issues FROM reports').all()) {
    for (const issue of JSON.parse(row.observed_issues || '[]')) categories[issue] = (categories[issue] || 0) + 1;
  }
  res.json({ total, byStatus, byDay, categories });
});

module.exports = router;
