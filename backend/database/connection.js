const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

// Allow direct database scripts to load backend/.env without going through server.js.
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) fs.readFileSync(envFile, 'utf8').split(/\r?\n/).forEach(line => {
  const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
});

const dbFile = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(__dirname, '..', 'data', 'repair.sqlite');
const dataDir = path.dirname(dbFile);
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(dbFile);

module.exports = { db, dbFile, dataDir };
