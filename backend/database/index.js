const fs = require('node:fs');
const path = require('node:path');
const { db, dbFile, dataDir } = require('./connection');
const { ensureSchema } = require('./schema');
const { hashPassword } = require('../security');
const { encryptText } = require('../privacy');
const repository = require('./repository');

function importJsonIfEmpty() {
  const userCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const appointmentCount = db.prepare('SELECT COUNT(*) AS count FROM appointments').get().count;
  if (!userCount) {
    const file = path.join(dataDir, 'users.json');
    if (fs.existsSync(file)) {
      const users = JSON.parse(fs.readFileSync(file, 'utf8'));
      users.forEach(repository.insertUser);
    }
  }
  if (!appointmentCount) {
    const file = path.join(dataDir, 'appointments.json');
    if (fs.existsSync(file)) {
      const appointments = JSON.parse(fs.readFileSync(file, 'utf8'));
      appointments.forEach(repository.insertAppointment);
    }
  }
}

function ensurePasswords() {
  const fallback = process.env.BOOTSTRAP_PASSWORD || '123456';
  const rows = db.prepare("SELECT account FROM users WHERE password_hash IS NULL OR password_hash = ''").all();
  if (rows.length && process.env.NODE_ENV === 'production' && !process.env.BOOTSTRAP_PASSWORD) {
    throw new Error('BOOTSTRAP_PASSWORD must be set before starting production with accounts missing passwords');
  }
  if (rows.length) {
    const hashed = hashPassword(fallback);
    rows.forEach(row => db.prepare('UPDATE users SET password_hash = ? WHERE account = ?').run(hashed, row.account));
  }
}

function encryptLegacyContacts() {
  const rows = db.prepare("SELECT id, phone, social FROM appointments WHERE (phone IS NOT NULL AND phone <> '' AND phone NOT LIKE 'enc$%') OR (social IS NOT NULL AND social <> '' AND social NOT LIKE 'enc$%')").all();
  if (!rows.length) return;
  db.exec('BEGIN');
  try {
    const update = db.prepare('UPDATE appointments SET phone = ?, social = ? WHERE id = ?');
    rows.forEach(row => update.run(encryptText(row.phone), encryptText(row.social), row.id));
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* Preserve the original migration error. */ }
    throw error;
  }
}

// Database startup is the only place that opens the schema and imports legacy seed data.
ensureSchema(db);
importJsonIfEmpty();
encryptLegacyContacts();
ensurePasswords();

module.exports = { ...repository, db, dbFile, dataDir };
