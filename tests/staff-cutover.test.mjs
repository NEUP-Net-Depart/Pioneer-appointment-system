import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';
import {cutoverDefinition,verifyRemoteCutover} from '../scripts/prepare-staff-cutover.mjs';
import {config} from '../scripts/cli.mjs';
import {stageD1Fixture,migrationStatements} from './fixtures/staff-cutover.mjs';

const post={departmentCode:'hardware',positionCode:'head',effectiveFrom:'2026-01-01',effectiveTo:'2098-01-01'};

for(const chain of ['migrations','database/staff-migrations'])test(`${chain}: D1 rolls back missing input and late conversion failure, then consumes the same private decisions atomically`,async()=>{
  const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'private-cutover-rollback',compatibilityDate:'2026-09-01',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("fixture")}}'}}},env:{DB:{type:'d1',id:'private-cutover-rollback'}}}}]});
  try{
    const db=await mf.getD1Database('DB');
    for(const file of (await readdir(chain)).filter(file=>file.endsWith('.sql')&&file<'0042').sort())await db.batch(migrationStatements(await readFile(`${chain}/${file}`,'utf8')).map(sql=>db.prepare(sql)));
    await db.batch([
      db.prepare('CREATE TABLE d1_migrations(name TEXT PRIMARY KEY)'),
      db.prepare("INSERT INTO d1_migrations VALUES('0041_attendance_reports.sql')")
    ]);
    await db.batch([
      db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('99272001','虚构 D1 成员','admin','南湖','unchanged-private-hash','2026-01-01')"),
      db.prepare("INSERT INTO staff_campus_grants VALUES('99272001','南湖')")
    ]);
    const history=async()=>Promise.all(['staff_accounts','members','member_roles','member_work_profiles','member_department_memberships','audit_events'].map(async table=>(await db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()).results));
    const original=await history(), definition=await cutoverDefinition(chain), statements=migrationStatements(definition.sql).map(sql=>db.prepare(sql));
    await assert.rejects(db.batch(statements),/staff_cutover_ready/);assert.deepEqual(await history(),original);
    await stageD1Fixture(db,{'member-99272001':{decision:'migrate',post}},chain);assert.deepEqual(await history(),original,'preparation does not change existing permissions');
    const databaseId=(await config()).env.preview.d1_databases.find(item=>item.binding==='DB').database_id;
    await db.prepare('UPDATE _staff_cutover_batch SET database_id=?').bind(databaseId).run();
    await db.prepare("UPDATE _staff_cutover_batch SET prepared_at='2000-01-01T00:00:00.000Z'").run();
    const run=async args=>{
      assert.equal(args[1],'execute');
      const result=await db.prepare(args[args.indexOf('--command')+1]).all();
      return JSON.stringify([result]);
    };
    assert.deepEqual(await verifyRemoteCutover({preview:true},run),{cutover:'private-input-ready',members:1});
    await db.prepare("CREATE TRIGGER fail_private_cutover BEFORE INSERT ON audit_events WHEN NEW.action='organization.cutover.confirmed' BEGIN SELECT RAISE(ABORT,'PRIVATE_CUTOVER_LATE_FAILURE'); END").run();
    await assert.rejects(db.batch(statements),/PRIVATE_CUTOVER_LATE_FAILURE/);assert.deepEqual(await history(),original);
    assert.ok(await db.prepare("SELECT name FROM sqlite_schema WHERE name='member_work_profiles'").first());
    assert.ok(await db.prepare("SELECT member_id FROM _staff_cutover_decisions").first());
    await db.prepare('DROP TRIGGER fail_private_cutover').run();await db.batch(statements);
    assert.equal((await db.prepare('SELECT * FROM staff_accounts').first()).password_hash,'unchanged-private-hash');
    assert.equal((await db.prepare("SELECT count(*) AS n FROM member_roles WHERE role_id='role-repair-lead'").first()).n,0);
    assert.ok(await db.prepare("SELECT role_id FROM effective_member_roles WHERE role_id='role-repair-lead'").first());
    assert.equal((await db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE '_staff_cutover_%' OR name LIKE '_organization_%'").first()).n,0);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  }finally{await mf.dispose();}
});
