import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { root, config } from './cli.mjs';
import { verifyStaffSchema } from '../src/db/staff-readiness.js';
import { userRepository } from '../src/db/users.js';
import { staffPlatformRepository } from '../src/db/staff-platform.js';
import { composeStaffPlatform } from '../src/app/compose.js';
import { staffPlatformService } from '../src/services/staff-platform.js';
import { prepareCutover, privatePath, verifyRemoteCutover } from './prepare-staff-cutover.mjs';

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

function cutoverHistory(sqlite) {
  const replaced = new Set(['member_roles','member_department_memberships','member_work_profiles','departments','d1_migrations','_staff_cutover_batch','_staff_cutover_decisions']);
  return sqlite.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
    .filter(({name}) => !replaced.has(name)).map(({name}) => {
      const columns = sqlite.prepare(`PRAGMA table_info("${name}")`).all().map(row => row.name)
        .filter(column => name !== 'staff_accounts' || !['auth_version','token_version'].includes(column));
      const rows = () => sqlite.prepare(`SELECT ${columns.map(column => '"'+column+'"').join(',')} FROM "${name}"`).all().map(row => JSON.stringify(row)).sort();
      return {name,rows,before:rows()};
    });
}

export async function rehearseSnapshot(dump, directory = resolve(root, 'migrations'), {privateInput} = {}) {
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
    const upgradingExpirations = !ledger.has('0036_appointment_expiration_time.sql');
    if (sqlite.prepare('PRAGMA table_info(staff_accounts)').all().some(row => row.name === 'member_id')) {
      const conflicts = sqlite.prepare('SELECT COUNT(*) AS count FROM (SELECT member_id FROM staff_accounts GROUP BY member_id HAVING COUNT(*)>1)').get().count;
      if(conflicts)throw new Error(`Migration preflight failed: ${conflicts} members have multiple login accounts; no accounts were merged`);
    }
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
      if (name === '0042_organization_permissions.sql' && privateInput) {
        const prepared = await prepareCutover(sqlite,privateInput,{directory,environment:privateInput.environment});
        sqlite.exec(prepared.sql);
      }
      const history = name === '0042_organization_permissions.sql' ? cutoverHistory(sqlite) : [];
      sqlite.exec('BEGIN; PRAGMA defer_foreign_keys=ON;');
      try {
        sqlite.exec(await readFile(resolve(directory, name), 'utf8'));
        for (const table of history) {
          const after = table.rows();
          assert.ok(['audit_events','staff_release_markers'].includes(table.name)
            ? table.before.every(row => after.includes(row))
            : JSON.stringify(table.before) === JSON.stringify(after), `Organization cutover changed history: ${table.name}`);
        }
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
      // The expiration migration changes only pending defaults and revisions.
      const normalize = (rows, advanceExpiration = false) => rows.map(value => {
        const row = JSON.parse(value); delete row.token_version; delete row.auth_version;
        if (advanceExpiration && original.table === 'appointments' && row.status === 'booked' && row.started_at === null && row.expires_at === `${row.date}T13:30:00.000Z`) {
          row.expires_at = `${row.date}T12:45:00.000Z`; row.revision++;
        }
        return JSON.stringify(row);
      }).sort();
      if (JSON.stringify(normalize(original.rows())) !== JSON.stringify(normalize(original.before, upgradingExpirations))) throw new Error(`Historical data changed: ${original.table}`);
    }
    assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length, 0, 'Foreign key violations after migration');
    const db = adapter(sqlite); await verifyStaffSchema(db);
    const users = userRepository(db), repository = staffPlatformRepository(db), platform = composeStaffPlatform({ repository });
    const staff = staffPlatformService({ repository, platform, manifests: platform.manifests });
    const counts = {};
    for (const row of sqlite.prepare('SELECT account,role,status FROM staff_accounts').all()) {
      const user = await users.find(row.account);
      assert.ok(user.memberId, 'Account is missing its stable member identity');
      const roleCodes = sqlite.prepare('SELECT department_id,position_code FROM member_department_memberships WHERE member_id=? ORDER BY department_id,position_code').all(user.memberId).map(post => `${post.department_id}:${post.position_code}`);
      const key = `${row.role} → ${roleCodes.join('+')}`; counts[key] = (counts[key] || 0) + 1;
      if (user.status === 'enabled' && user.memberStatus !== 'inactive' && user.authorizedCampuses.length) {
        const context = await staff.contextFor(user);
        for (const code of Object.keys(context.permissions)) {
          for (const campusId of ['campus-nanhu','campus-hunnan']) {
            if (user.authorizedCampuses.some(value => (value === '南湖' ? 'campus-nanhu' : value === '浑南' ? 'campus-hunnan' : value) === campusId)) continue;
            assert.equal(platform.authorizer.evaluate(context.actor,code,{campusId},context,context.grants).allowed,false,'Migrated authorization exceeded the account campus scope');
          }
        }
      }
    }
    const unconfirmedMembers = sqlite.prepare(`SELECT count(DISTINCT json_extract(a.source_ref,'$.id')) AS n FROM audit_events a
      WHERE a.action='organization.membership.archived'
      AND json_extract(a.source_ref,'$.id') NOT IN (SELECT member_id FROM staff_accounts WHERE protected=1)
      AND NOT EXISTS(SELECT 1 FROM audit_events c WHERE c.action='organization.cutover.confirmed'
        AND json_extract(c.source_ref,'$.id')=json_extract(a.source_ref,'$.id'))`).get().n;
    return { applied, accounts: counts, preservedTables: preserved.length, unconfirmedMembers };
  } finally { sqlite.close(); }
}

export async function rehearsePreview(args = process.argv.slice(2), preflight = verifyRemoteCutover) {
  if (args.length) {
    if (process.env.GITHUB_ACTIONS === 'true') throw new Error('CUTOVER_LOCAL_EXECUTION_REQUIRED');
    if (args.length !== 4 || args[0] !== '--snapshot' || args[2] !== '--input') throw new Error('Use --snapshot <private.sql> --input <private.json> for an offline rehearsal');
    const snapshot = await privatePath(args[1]), input = await privatePath(args[3]);
    let privateInput;
    try { privateInput = JSON.parse((await readFile(input, 'utf8')).replace(/^\uFEFF/, '')); }
    catch { throw new Error('CUTOVER_INPUT_INVALID'); }
    const report = await rehearseSnapshot(await readFile(snapshot, 'utf8'), undefined, {privateInput});
    console.log(JSON.stringify({result:'Local migration rehearsal passed; remote database unchanged',...report}));
    return report;
  }
  if (process.env.GITHUB_ACTIONS === 'true') {
    const report = await preflight({preview:true});
    console.log(JSON.stringify({result:'Preview cutover preflight passed; remote database unchanged',...report}));
    return report;
  }
  const cfg = await config(), parent = tmpdir();
  assert.equal(cfg.env.preview.d1_databases[0].database_name, 'pioneer-appointments-preview-v2');
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
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await rehearsePreview(); }
  catch { console.error('MIGRATION_REHEARSAL_FAILED'); process.exitCode = 1; }
}
