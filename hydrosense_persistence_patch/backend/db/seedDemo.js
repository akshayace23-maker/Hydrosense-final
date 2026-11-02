// db/seedDemo.js
// Imports the supplied demonstration records once by stable Report ID / news reference.
// These are historical/source-compiled examples, not verified current field incidents.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const db = require('./init');

const SOURCE = path.join(__dirname, 'hydrosense_seed.json');
const STATUS = {
  'Pending': 'submitted',
  'Assigned': 'inspection_assigned',
  'Inspection required': 'inspection_assigned',
  'Action taken': 'action_taken',
  'Follow-up required': 'follow_up_required',
  'Resolved': 'resolved'
};
const TYPE = (name) => {
  const s = String(name || '').toLowerCase();
  if (s.includes('lake')) return 'lake';
  if (s.includes('river')) return 'river';
  if (s.includes('tank') || s.includes('kulam')) return 'tank';
  if (s.includes('pond')) return 'pond';
  if (s.includes('wetland')) return 'wetland';
  return 'other';
};
const ISSUE = {
  Sewage: ['possible_sewage'],
  Garbage: ['garbage'],
  Foam: ['foam'],
  'Invasive plants': ['excess_plants'],
  'Dead fish': ['dead_fish'],
  'Maintenance (verify on site)': []
};
const NEWS_CATEGORY = {
  Sewage: 'environmental_alert',
  Garbage: 'environmental_alert',
  Foam: 'environmental_alert',
  'Invasive plants': 'restoration_update',
  'Dead fish': 'environmental_alert',
  'Maintenance (verify on site)': 'inspection_update'
};

function ensureDemoUser(user, userIds) {
  // .invalid is a reserved non-deliverable domain. Demo identities cannot receive email
  // and their random passwords are intentionally not disclosed or usable as login credentials.
  const slug = user.name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '');
  const email = `demo+${slug}@hydrosense.invalid`;
  let row = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (!row) {
    const passwordHash = bcrypt.hashSync(crypto.randomBytes(48).toString('hex'), 12);
    const id = db.prepare(
      "INSERT INTO users (role,name,email,password_hash,password_changed_at) VALUES (?,?,?,?,datetime('now'))"
    ).run(user.role, user.name, email, passwordHash).lastInsertRowid;
    row = { id };
  }
  userIds[user.name] = row.id;
}

function seedDemo() {
  if (!fs.existsSync(SOURCE)) throw new Error(`Missing demo seed source: ${SOURCE}`);
  const seed = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  if (!Array.isArray(seed.users) || !Array.isArray(seed.reports) || !Array.isArray(seed.news)) {
    throw new Error('Invalid HydroSense seed file: expected users, reports and news arrays.');
  }

  const userIds = {};
  for (const user of seed.users) ensureDemoUser(user, userIds);
  // System publisher gives imported news a visible provenance without impersonating a staff login.
  ensureDemoUser({ name: 'HydroSense Demo Archive', role: 'authority' }, userIds);

  const run = db.transaction(() => {
    for (const report of seed.reports) {
      if (db.prepare('SELECT id FROM reports WHERE report_code = ?').get(report.reportId)) continue;

      const type = TYPE(report.waterBodyName);
      let waterBody = db.prepare('SELECT id FROM water_bodies WHERE name = ? COLLATE NOCASE').get(report.waterBodyName);
      if (!waterBody) {
        const id = db.prepare(
          'INSERT INTO water_bodies (name,type,lat,lng,address) VALUES (?,?,NULL,NULL,?)'
        ).run(report.waterBodyName, type, report.locationDescription || null).lastInsertRowid;
        waterBody = { id };
      } else if (report.locationDescription) {
        db.prepare('UPDATE water_bodies SET address = COALESCE(address, ?) WHERE id = ?')
          .run(report.locationDescription, waterBody.id);
      }

      const category = report.complaintCategory || '';
      const issues = ISSUE[category] || [];
      const verification = report.verificationNote ||
        'Historical/source-compiled demonstration entry. Verify on site before treating as a current condition.';
      const detail = [
        report.observationDescription || '',
        report.locationDescription ? `Location description: ${report.locationDescription}` : '',
        report.newsReference ? `Source references listed in supplied seed: ${report.newsReference}.` : 'No source reference supplied.',
        `DEMO DATA NOTICE: ${verification}`,
        'No GPS coordinates or evidence photographs were supplied with this record. No laboratory result is implied.'
      ].filter(Boolean).join('\n\n');

      const reportedAt = report.reportedDate ? `${report.reportedDate} 12:00:00` : null;
      const reportId = db.prepare(
        `INSERT INTO reports
          (report_code,citizen_id,water_body_id,water_body_name_raw,water_body_type,
           lat,lng,address,gps_source,is_anonymous,observed_issues,additional_notes,
           status,priority,created_at,updated_at,map_url,source_reference,is_demo)
         VALUES (?,?,?,?,?,NULL,NULL,?,'unavailable',0,?,?,?,'normal',?,?,?,?,1)`
      ).run(
        report.reportId,
        userIds[report.reporter],
        waterBody.id,
        report.waterBodyName,
        type,
        report.locationDescription || null,
        JSON.stringify(issues),
        detail,
        STATUS[report.status] || 'submitted',
        reportedAt || new Date().toISOString(),
        reportedAt || new Date().toISOString(),
        report.mapSearchUrl || null,
        report.newsReference || null
      ).lastInsertRowid;

      for (const event of (report.timeline || [])) {
        const actor = userIds[event.by] || userIds['HydroSense Demo Archive'];
        const actorRole = (seed.users.find((u) => u.name === event.by) || { role: 'authority' }).role;
        const eventStatus = STATUS[event.status] || 'submitted';
        const note = `[Imported demo timeline; unverified] ${event.note || event.status}` +
          (event.date ? '' : ' Original event date was not supplied; the displayed date is the import timestamp.');
        if (event.date) {
          db.prepare(
            'INSERT INTO report_updates (report_id,actor_id,actor_role,status,remarks,created_at) VALUES (?,?,?,?,?,?)'
          ).run(reportId, actor, actorRole, eventStatus, note, `${event.date} 12:00:00`);
        } else {
          db.prepare(
            'INSERT INTO report_updates (report_id,actor_id,actor_role,status,remarks) VALUES (?,?,?,?,?)'
          ).run(reportId, actor, actorRole, eventStatus, note);
        }

        if (event.status === 'Action taken') {
          db.prepare(
            'INSERT INTO actions (report_id,recorded_by,action_taken,action_date) VALUES (?,?,?,?)'
          ).run(
            reportId, actor,
            `${event.note || 'Action marked in supplied seed'} (Imported demo history; not independently verified.)`,
            event.date || report.reportedDate || new Date().toISOString().slice(0, 10)
          );
        }
      }
    }

    const archiveId = userIds['HydroSense Demo Archive'];
    for (const item of seed.news) {
      if (db.prepare('SELECT id FROM news_posts WHERE source_ref = ?').get(item.newsId)) continue;
      const report = seed.reports.find((r) => r.reportId === item.reportId);
      const category = report ? (NEWS_CATEGORY[report.complaintCategory] || 'research_awareness') : 'research_awareness';
      const waterBody = db.prepare('SELECT id FROM water_bodies WHERE name = ? COLLATE NOCASE').get(item.waterBodyName);
      const summary = [
        item.summary || '',
        `Location: ${report ? report.locationDescription : item.waterBodyName}`,
        `Publisher/source listed in supplied seed: ${item.publisher || 'Not supplied'}.`,
        item.url ? `Source URL: ${item.url}` : 'No source article URL was supplied.',
        'HISTORICAL / DEMO NEWS: This entry is imported from a user-supplied compilation. It is not independent verification of a current site condition.'
      ].join('\n\n');
      const publishedAt = item.publishedDate ? `${item.publishedDate} 12:00:00` : new Date().toISOString();
      db.prepare(
        `INSERT INTO news_posts
          (author_id,title,category,water_body_id,summary,status,created_at,source_ref,source_publisher,is_demo)
         VALUES (?,?,?,?,?,'published',?,?,?,1)`
      ).run(
        archiveId,
        `${item.waterBodyName}: ${report ? report.complaintCategory : 'Water-body update'}`,
        category,
        waterBody ? waterBody.id : null,
        summary,
        publishedAt,
        item.newsId,
        item.publisher || null
      );
    }
  });

  run();
  return {
    importedReports: seed.reports.length,
    importedNews: seed.news.length,
    status: 'ok'
  };
}

module.exports = seedDemo;
