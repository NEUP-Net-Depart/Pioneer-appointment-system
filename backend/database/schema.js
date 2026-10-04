function ensureSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      account TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL,
      campus TEXT NOT NULL DEFAULT '南湖 / 浑南', active INTEGER NOT NULL DEFAULT 1,
      protected INTEGER NOT NULL DEFAULT 0, password_hash TEXT, token_version INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY, student_id TEXT NOT NULL, name TEXT NOT NULL,
      college TEXT, campus TEXT NOT NULL, phone TEXT, social TEXT,
      device_type TEXT NOT NULL, brand TEXT, device_model TEXT, serial TEXT,
      warranty TEXT, fault_type TEXT NOT NULL, issue TEXT, liquid_drop TEXT,
      date TEXT NOT NULL, time_slot TEXT NOT NULL, note TEXT, status TEXT NOT NULL,
      assigned_to TEXT, repair_note TEXT, created_at TEXT NOT NULL,
      agreement_at TEXT, agreement_version TEXT
    );
    CREATE TABLE IF NOT EXISTS appointment_attachments (
      id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL, filename TEXT NOT NULL,
      mime_type TEXT NOT NULL, size INTEGER NOT NULL, storage_path TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_attachment_appointment ON appointment_attachments(appointment_id);
    CREATE INDEX IF NOT EXISTS idx_appointments_queue ON appointments(date, campus, time_slot, created_at);
    CREATE INDEX IF NOT EXISTS idx_appointments_fault ON appointments(fault_type);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_student_slot
      ON appointments(student_id, date, time_slot)
      WHERE status NOT IN ('cancelled', 'no_show');
  `);
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
  if (!userColumns.includes('password_hash')) db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  if (!userColumns.includes('token_version')) db.exec('ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0');
  const currentVersion = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version || 0;
  if (currentVersion < 1) db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(1, new Date().toISOString());
  if (currentVersion < 2) db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(2, new Date().toISOString());
  if (currentVersion < 3) db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(3, new Date().toISOString());
}

module.exports = { ensureSchema };
