// db/migrate.js — additive schema migrations for the HydroSense portal compatibility layer.
const db = require('./init');

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn('reports', 'map_url', 'TEXT');
ensureColumn('reports', 'source_reference', 'TEXT');
ensureColumn('reports', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('news_posts', 'source_ref', 'TEXT');
ensureColumn('news_posts', 'source_publisher', 'TEXT');
ensureColumn('news_posts', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_news_source_ref
  ON news_posts(source_ref) WHERE source_ref IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_reports_demo ON reports(is_demo);
`);
module.exports = db;
