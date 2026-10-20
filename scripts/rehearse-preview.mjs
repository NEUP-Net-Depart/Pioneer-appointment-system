import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { root, config } from './cli.mjs';
import { verifyStaffSchema } from '../src/db/staff-readiness.js';
import { userRepository } from '../src/db/users.js';
import { staffPlatformRepository } from '../src/db/staff-platform.js';
import { composeStaffPlatform } from '../src/app/compose.js';
import { staffPlatformService } from '../src/services/staff-platform.js';

function adapter(sqlite) {
  return {
    prepare(sql) {
      const query = sqlite.prepare(sql);
      const statement = values => ({
        bind: (...args) => statement(args),
        first: async () => query.get(...values) || null,
        all: async () => ({ results: query.all(...values) }),
        run: async () => ({ meta: { changes: query.run(...values).changes } }),
      });
      return statement([]);
    },
    batch: statements => Promise.all(statements.map(statement => statement.all())),
  };
}
const preserved = ['staff_accounts', 'staff_campus_grants', 'appointments', 'appointment_attachments', 'appointment_corrections', 'credential_recoveries', 'activation_requests'];
export async function rehearseSnapshot(dump, directory = resolve(root, 'migrations')) {
  const sqlite = new DatabaseSync(':memory:');
  try {
    // D1 exports may interleave CREATE TABLE and INSERT statements. Restore
    // the snapshot first, then validate all references before applying any
    // migrations with foreign-key enforcement enabled.
    sqlite.exec('PRAGMA foreign_keys=OFF; BEGIN;');
    try { sqlite.exec(dump); sqlite.exec('COMMIT; PRAGMA foreign_keys=ON;'); }
    catch { throw new Error('Preview snapshot could not be imported locally'); }
    assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0,'Preview snapshot has invalid foreign keys');
    const ledger = new Set(sqlite.prepare('SELECT name FROM d1_migrations').all().map(row => row.name));
    const upgradingLegacyAdmins = !ledger.has('0030_react_cutover_access.sql');
    const upgradingLegacyTechnicians = !sqlite.prepare('PRAGMA table_info(staff_accounts)').all().some(row => row.name === 'member_id');
    const originals = preserved.map(table => {
      const columns = sqlite.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
      assert.ok(columns.length, `Missing baseline table: ${table}`);
      const rows = () => sqlite.prepare(`SELECT ${columns.map(column => '"' + column + '"').join(',')} FROM ${table}`).all().map(row => JSON.stringify(row)).sort();
      return { table, columns, before: rows(), rows };
    });
    const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
    for (const name of ledger) assert.ok(files.includes(name), 'Deployed migration is missing from this checkout');
    let applied = 0;
    for (const name of files) {
      if (ledger.has(name)) continue;
      sqlite.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');
      try {
        sqlite.exec(await readFile(resolve(directory, name), 'utf8'));
        sqlite.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(name);
        sqlite.exec('COMMIT;'); applied++;
      } catch {
        sqlite.exec('ROLLBACK;');
        // Never include SQL values, contacts, hashes or credentials in CI logs.
        throw new Error(`Preview migration rehearsal failed at ${name}`);
      }
    }
    for (const original of originals) {
      // Authorization migrations explicitly revoke existing sessions. Verify
      // every other historical field, including passwords and private tokens.
      const normalize = rows => rows.map(value => { const row = JSON.parse(value); delete row.token_version; delete row.auth_version; return JSON.stringify(row); }).sort();
      if (JSON.stringify(normalize(original.rows())) !== JSON.stringify(normalize(original.before))) throw new Error(`Historical data changed: ${original.table}`);
    }
    assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length, 0, 'Foreign key violations after migration');
    const db = adapter(sqlite); await verifyStaffSchema(db);
    const users = userRepository(db), repository = staffPlatformRepository(db), platform = composeStaffPlatform({ repository });
    const staff = staffPlatformService({ repository, platform, manifests: platform.manifests });
    const counts = {};
    for (const row of sqlite.prepare('SELECT account,role,status FROM staff_accounts').all()) {
      const user = await users.find(row.account);
      assert.ok(user.memberId, 'Account is missing its stable member identity');
      const roleCodes = sqlite.prepare('SELECT DISTINCT r.code FROM member_roles mr JOIN roles r ON r.id=mr.role_id WHERE mr.member_id=? ORDER BY r.code').all(user.memberId).map(role => role.code);
      const key = `${row.role} → ${roleCodes.join('+')}`; counts[key] = (counts[key] || 0) + 1;
      if (user.status === 'enabled' && user.memberStatus !== 'inactive' && user.authorizedCampuses.length) {
        const context = await staff.contextFor(user);
        if (row.role === 'technician' && upgradingLegacyTechnicians) {
          assert.equal(context.permissions['repair.summary.read'], true, 'Migrated technician lost repair summary access');
          assert.notEqual(context.permissions['roles.manage'], true, 'Technician gained role management');
        }
        if (row.role === 'admin' && upgradingLegacyAdmins) {
          for (const code of ['repair.summary.read','repair.correct','repair.transfer','statistics.read','accounts.manage','settings.manage','customer.identity.read','customer.contact.read']) {
            assert.equal(context.permissions[code], true, 'Migrated administrator lost an original management capability');
            for (const campusId of ['campus-nanhu','campus-hunnan']) {
              if (user.authorizedCampuses.some(value => (value === '南湖' ? 'campus-nanhu' : value === '浑南' ? 'campus-hunnan' : value) === campusId)) continue;
              assert.equal(platform.authorizer.evaluate(context.actor,code,{campusId},context,context.grants.filter(grant => grant.roleCode === 'legacy_admin')).allowed,false,'Migrated administrator exceeded the original campus scope');
            }
          }
        }
        if (row.role !== 'superadmin') assert.notEqual(context.permissions['roles.manage'], true, 'Non-superadmin gained role management');
      }
    }
    return { applied, accounts: counts, preservedTables: preserved.length };
  } finally { sqlite.close(); }
}

export async function rehearsePreview() {
  const cfg = await config(), parent = resolve(root, '.wrangler');
  assert.equal(cfg.env.preview.d1_databases[0].database_name, 'pioneer-appointments-preview-v2');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(resolve(parent, 'preview-rehearsal-')), inside = relative(parent, dir);
  assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside));
  try {
    const snapshot = resolve(dir, 'private-snapshot.sql');
    const result = spawnSync(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'd1', 'export', 'DB', '--remote', '--env', 'preview', '--config', resolve(root, 'wrangler.jsonc'), '--output', snapshot], { cwd: root, env: { ...process.env, WRANGLER_SEND_METRICS: 'false' }, encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error('Could not export the existing Preview D1 snapshot for rehearsal');
    const report = await rehearseSnapshot(await readFile(snapshot, 'utf8'));
    console.log(JSON.stringify({ result: 'Preview rehearsal passed; remote database unchanged', ...report }));
    return report;
  } finally { await rm(dir, { recursive: true, force: true }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await rehearsePreview();
