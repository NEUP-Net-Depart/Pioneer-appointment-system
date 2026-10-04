const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

function key(name) {
  const value = process.env[name] || '';
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be 64 hexadecimal characters`);
  return Buffer.from(value, 'hex');
}

function decrypt(value, secret) {
  const text = String(value || '');
  if (!text.startsWith('enc$')) return text;
  const [, iv, tag, body] = text.split('$');
  const decipher = crypto.createDecipheriv('aes-256-gcm', secret, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

function encrypt(value, secret) {
  const text = String(value || '');
  if (!text) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secret, iv);
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return `enc$${iv.toString('base64url')}$${cipher.getAuthTag().toString('base64url')}$${body.toString('base64url')}`;
}

const dbFile = path.resolve(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'repair.sqlite'));
if (!fs.existsSync(dbFile)) throw new Error(`Database not found: ${dbFile}`);
const oldKey = key('OLD_PII_ENCRYPTION_KEY');
const newKey = key('PII_ENCRYPTION_KEY');
if (oldKey.equals(newKey)) throw new Error('OLD_PII_ENCRYPTION_KEY and PII_ENCRYPTION_KEY must be different');
const db = new DatabaseSync(dbFile);
const rows = db.prepare("SELECT id, phone, social FROM appointments WHERE (phone IS NOT NULL AND phone <> '') OR (social IS NOT NULL AND social <> '')").all();
db.exec('BEGIN IMMEDIATE');
try {
  const update = db.prepare('UPDATE appointments SET phone = ?, social = ? WHERE id = ?');
  rows.forEach(row => update.run(encrypt(decrypt(row.phone, oldKey), newKey), encrypt(decrypt(row.social, oldKey), newKey), row.id));
  db.exec('COMMIT');
  console.log(`Migrated encrypted contacts for ${rows.length} appointments in ${dbFile}`);
} catch (error) {
  try { db.exec('ROLLBACK'); } catch { /* Preserve original error. */ }
  throw error;
}
