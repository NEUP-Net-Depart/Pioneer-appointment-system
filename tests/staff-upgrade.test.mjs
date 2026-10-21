import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { migrationFingerprint } from '../scripts/migration-fingerprint.mjs';
import { staffPlatformRepository } from '../src/db/staff-platform.js';

async function statements(path) {
  const sql = (await readFile(path, 'utf8')).replace(/--[^\n]*/g, '');
  const result = []; let buffer = '';
  for (const line of sql.split('\n')) {
    buffer = `${buffer}\n${line}`.trim();
    if (buffer && (buffer.startsWith('CREATE TRIGGER') ? line.trim() === 'END;' : line.trim().endsWith(';'))) {
      result.push(buffer); buffer = '';
    }
  }
  assert.equal(buffer, '', `Incomplete SQL in ${path}`);
  return result;
}
const timestamp = '2026-10-15T10:00:00.000Z';

test('swap upgrades preserve legacy accepted requests and retain revisions on unchanged republication', async () => {
  const mf = new Miniflare({ telemetry:{ enabled:false },workers:[{ config:{ name:'swap-upgrade-test',compatibilityDate:'2026-10-01',
    manifest:{ mainModule:'index.js',modules:{ 'index.js':{ type:'esm',contents:'export default { fetch() { return new Response("test"); } };' } } },
    env:{ DEV:{ type:'d1',id:'swap-upgrade-dev' } }
  } }] });
  try {
    const binding='DEV',directory='migrations',last='0017_swap_revisions.sql';
    const db = await mf.getD1Database(binding);
    for (const file of (await readdir(directory)).filter(name => name.endsWith('.sql') && name < last).sort()) await db.batch((await statements(`${directory}/${file}`)).map(sql => db.prepare(sql)));
    for (const account of ['998821','998822']) await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,'旧版成员','technician','南湖','test-only',?)").bind(account,timestamp).run();
    await db.prepare("INSERT INTO roster_tasks(id,week_start,slot_start,slot_end,deadline,created_at) VALUES('old-swap-task','2026-11-09','19:00','21:00',?,?)").bind(timestamp,timestamp).run();
    await db.prepare("INSERT INTO roster_versions(id,task_id,status,version,rule_version,algorithm_version,created_at) VALUES('old-swap-version','old-swap-task','published',1,'1','old',?)").bind(timestamp).run();
    for (const [id,member,day] of [['old-a','member-998821','2026-11-09'],['old-b','member-998822','2026-11-10']]) await db.prepare("INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at) VALUES(?,'old-swap-version',?,?,'campus-nanhu','repair','19:00','21:00')").bind(id,member,day).run();
    await db.prepare("INSERT INTO swap_requests(id,from_assignment_id,to_assignment_id,from_member_id,to_member_id,from_revision,to_revision,created_at) VALUES('old-swap','old-a','old-b','member-998821','member-998822',0,0,?)").bind(timestamp).run();
    await db.batch([
      db.prepare("UPDATE duty_assignments SET member_id='member-998822',revision=1 WHERE id='old-a'"),
      db.prepare("UPDATE duty_assignments SET member_id='member-998821',revision=1 WHERE id='old-b'"),
      db.prepare("UPDATE swap_requests SET status='accepted',revision=1,decided_at=? WHERE id='old-swap'").bind(timestamp)
    ]);
    const before = (await db.prepare('SELECT * FROM swap_requests').all()).results;
    const originals = (await db.prepare('SELECT * FROM duty_assignments ORDER BY id').all()).results;
    const migration = await statements(`${directory}/${last}`);
    await assert.rejects(db.batch([...migration.map(sql => db.prepare(sql)),db.prepare('INSERT INTO missing_swap_upgrade VALUES(1)')]));
    assert.deepEqual((await db.prepare('SELECT * FROM swap_requests').all()).results,before);
    await db.batch(migration.map(sql => db.prepare(sql)));
    const after = (await db.prepare('SELECT * FROM swap_requests').all()).results;
    assert.deepEqual(after.map(({ applied_from_assignment_id,applied_to_assignment_id,...row }) => {
      assert.equal(applied_from_assignment_id,null); assert.equal(applied_to_assignment_id,null); return row;
    }),before);
    assert.deepEqual((await db.prepare('SELECT * FROM duty_assignments ORDER BY id').all()).results.map(({ previous_assignment_id,...row }) => {
      assert.equal(previous_assignment_id,null); return row;
    }),originals);
    for(const file of (await readdir(directory)).filter(name=>name.endsWith('.sql')&&name>last).sort())await db.batch((await statements(`${directory}/${file}`)).map(sql=>db.prepare(sql)));
    const repository = staffPlatformRepository(db), assignment = await repository.assignmentById('old-a');
    const draft = await repository.createRosterVersion({ taskId:'old-swap-task',assignments:[{ ...assignment,id:undefined }] });
    const copied = (await repository.versionAssignments(draft.id))[0];
    assert.equal(copied.originAssignmentId,assignment.id); assert.equal(copied.revision,1);
    assert.equal((await repository.assignmentById('old-a')).revision,1);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  } finally { await mf.dispose(); }
});

test('leave-lineage upgrades preserve populated roster history and reconnect unchanged shifts', async () => {
  const mf = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    name: 'leave-upgrade-test', compatibilityDate: '2026-10-01',
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: 'export default { fetch() { return new Response("test"); } };' } } },
    env: { DEV: { type: 'd1', id: 'leave-upgrade-dev' } }
  } }] });
  try {
    const binding='DEV',directory='migrations',last='0016_roster_leave_lineage.sql';
    const db = await mf.getD1Database(binding);
    for (const file of (await readdir(directory)).filter(file => file.endsWith('.sql') && file < last).sort()) {
      await db.batch((await statements(`${directory}/${file}`)).map(sql => db.prepare(sql)));
    }
    await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('998811','历史成员','technician','南湖','test-only',?)").bind(timestamp).run();
    await db.prepare("INSERT INTO roster_tasks(id,week_start,slot_start,slot_end,deadline,created_at) VALUES('history-task','2026-11-09','19:00','21:00',?,?)").bind(timestamp,timestamp).run();
    for (const version of [1, 2, 3]) {
      await db.prepare("INSERT INTO roster_versions(id,task_id,status,version,rule_version,algorithm_version,created_at) VALUES(?,'history-task',?,?,'1','test',?)").bind(`history-v${version}`,version === 3 ? 'published' : 'superseded',version,timestamp).run();
      await db.prepare("INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at) VALUES(?,?,'member-998811','2026-11-09','campus-nanhu','repair','19:00','21:00')").bind(`history-shift${version}`,`history-v${version}`).run();
    }
    await db.prepare("INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at) VALUES('rescheduled','history-v3','member-998811','2026-11-10','campus-nanhu','repair','19:00','21:00')").run();
    await db.prepare("INSERT INTO leave_requests(id,assignment_id,member_id,reason,status,created_at) VALUES('history-leave','history-shift2','member-998811','历史请假','approved',?)").bind(timestamp).run();
    await db.prepare("INSERT INTO leave_requests(id,assignment_id,member_id,reason,status,created_at) VALUES('history-later-pending','history-shift3','member-998811','旧版曾允许重新申请','pending','2026-10-16T10:00:00.000Z')").run();
    const before = await snapshot(db), migration = await statements(`${directory}/${last}`);
    await assert.rejects(db.batch([...migration.map(sql => db.prepare(sql)), db.prepare('INSERT INTO missing_leave_upgrade VALUES(1)')]));
    assert.deepEqual(await snapshot(db), before);
    await db.batch(migration.map(sql => db.prepare(sql)));
    const after = await snapshot(db);
    assert.deepEqual(after.leave_requests, before.leave_requests);
    assert.deepEqual(after.roster_versions, before.roster_versions);
    assert.equal(after.duty_assignments.find(row => row.id === 'history-shift1').origin_assignment_id, null);
    assert.equal(after.duty_assignments.find(row => row.id === 'history-shift2').origin_assignment_id, 'history-shift1');
    assert.equal(after.duty_assignments.find(row => row.id === 'history-shift3').origin_assignment_id, 'history-shift1');
    assert.equal(after.duty_assignments.find(row => row.id === 'rescheduled').origin_assignment_id, null);
    for(const file of (await readdir(directory)).filter(name=>name.endsWith('.sql')&&name>last).sort())await db.batch((await statements(`${directory}/${file}`)).map(sql=>db.prepare(sql)));
    const repository = staffPlatformRepository(db);
    const current = await repository.effectiveLeaveAssignment('history-shift2', 'member-998811');
    assert.equal(current.id, 'history-shift3');
    assert.equal(current.leaveStatus, 'approved');
    assert.equal((await repository.leaveImpact(current)).expected, 0);
    assert.equal((await repository.listAssignments('member-998811', '2026-11-09')).find(row => row.id === 'rescheduled').leaveStatus, '');
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  } finally { await mf.dispose(); }
});

async function snapshot(db) {
  const tables = (await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results;
  const result = {};
  for (const { name } of tables) {
    result[name] = (await db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()).results
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  return result;
}

test('dev platform and account-alias upgrades preserve populated history and roll back failed batches', async () => {
  const mf = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    name: 'platform-upgrade-test', compatibilityDate: '2026-10-01',
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: 'export default { fetch() { return new Response("test"); } };' } } },
    env: { DEV: { type: 'd1', id: 'platform-upgrade-dev' } }
  } }] });
  try {
    const dev = await mf.getD1Database('DEV');
    for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql') && file < '0007').sort()) {
      await dev.batch((await statements(`migrations/${file}`)).map(sql => dev.prepare(sql)));
    }
    const manifest = JSON.parse(await readFile('tests/fixtures/dev-migrations/manifest.json', 'utf8'));
    for (const file of manifest.migrations) {
      const path = `tests/fixtures/dev-migrations/${file.name}`;
      assert.equal(migrationFingerprint(await readFile(path)), file.sha256, `Fixture changed: ${file.name}`);
      await dev.batch((await statements(path)).map(sql => dev.prepare(sql)));
    }
    await dev.prepare(`INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at)
      VALUES ('root001','历史负责人','superadmin','南湖',1,'test-only',?)`).bind(timestamp).run();
    for (const [index, [status, outcome]] of [
      ['booked', null], ['in_progress', null], ['completed', 'repaired'], ['completed', 'unrepaired'],
      ['completed', 'not_needed'], ['completed', 'legacy_unknown'], ['cancelled', null], ['expired', null]
    ].entries()) {
      const day = index < 5 ? '2026-10-15' : '2026-10-12';
      await dev.prepare(`INSERT INTO appointments
        (id,student_id,name,campus,social,device_type,brand,device_model,warranty,fault_type,date,time_slot,
         status,outcome,assigned_to,access_token_hash,credential_rotated_at,created_at,agreement_at,agreement_version,
         started_at,completed_at,source,registered_by,registration_key,expires_at)
        VALUES (?,?,'历史客户','南湖','private','电脑','品牌','型号','未知','故障',?,?,
         ?,?,?, ?,?,?,?,'v1',?,?,'booking',NULL,NULL,?)`)
        .bind(`history-${index}`, String(200000 + index), day, index < 5 ? '19:00–19:30' : '19:00–20:00', status, outcome,
          status === 'in_progress' ? 'root001' : null, String(index).padStart(64, '0'),
          timestamp, timestamp, timestamp, status === 'in_progress' ? timestamp : null,
          status === 'completed' ? timestamp : null, `${day}T13:30:00.000Z`).run();
    }
    await dev.prepare(`INSERT INTO attachment_storage VALUES ('photo','private/photo',123,'complete',?,?)`).bind(timestamp, '2027-04-13T10:00:00.000Z').run();
    await dev.prepare(`INSERT INTO appointment_attachments
      VALUES ('photo','history-1','front.png','image/png',123,'private/photo',?,?,'intake_front','root001')`).bind(timestamp, '2027-04-13T10:00:00.000Z').run();
    await dev.prepare(`INSERT INTO credential_recoveries VALUES ('recovery','history-1','root001','核验',?)`).bind(timestamp).run();
    await dev.prepare(`INSERT INTO appointment_corrections VALUES ('correction','history-1','root001','历史修正','{}','{}',?)`).bind(timestamp).run();
    const before = await snapshot(dev);
    const upgrade = await statements('database/upgrades/dev-0009-to-staff-platform.sql');
    await assert.rejects(dev.batch([...upgrade.map(sql => dev.prepare(sql)), dev.prepare('INSERT INTO missing_upgrade_assertion VALUES (1)')]));
    assert.deepEqual(await snapshot(dev), before);
    await dev.batch(upgrade.map(sql => dev.prepare(sql)));
    const after = await snapshot(dev);
    for (const [name, original] of Object.entries(before)) {
      const projected = after[name].map(row => Object.fromEntries(Object.keys(original[0] || row).map(key => [key, row[key]])));
      assert.deepEqual(projected, original, `dev history changed: ${name}`);
    }
    assert.equal(after.staff_accounts[0].member_id, 'member-root001');
    assert.equal(after.active_repairs[0].member_id, 'member-root001');
    assert.deepEqual((await dev.prepare('PRAGMA foreign_key_check').all()).results, []);
    {
      const db = dev, path = 'migrations/0011_member_account_aliases.sql';
      const beforeAliases = await snapshot(db);
      const commands = await statements(path);
      await assert.rejects(db.batch([...commands.map(sql => db.prepare(sql)), db.prepare('INSERT INTO missing_alias_upgrade VALUES(1)')]));
      assert.deepEqual(await snapshot(db), beforeAliases);
      await db.batch(commands.map(sql => db.prepare(sql)));
      assert.deepEqual(await snapshot(db), beforeAliases);
    }
    {
      const database = dev;
      const insert = () => database.prepare(`INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at)
        VALUES ('998877','原成员','technician','南湖','test-only',?)`).bind(timestamp).run();
      await insert();
      const original = await database.prepare("SELECT member_id FROM staff_accounts WHERE account='998877'").first();
      const membership = await database.prepare('SELECT * FROM member_department_memberships WHERE member_id=?').bind(original.member_id).all();
      await database.prepare("DELETE FROM staff_accounts WHERE account='998877'").run();
      await insert();
      assert.deepEqual(await database.prepare("SELECT member_id FROM staff_accounts WHERE account='998877'").first(), original);
      assert.deepEqual((await database.prepare('SELECT * FROM member_department_memberships WHERE member_id=?').bind(original.member_id).all()).results, membership.results);
      assert.deepEqual((await database.prepare('PRAGMA foreign_key_check').all()).results, []);
    }

  } finally { await mf.dispose(); }
});
