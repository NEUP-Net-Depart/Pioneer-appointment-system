import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {Miniflare} from 'miniflare';
import {cutoverDefinition,prepareCutover,projectCutoverSnapshot,verifyCutoverSnapshot,verifyRemoteCutover} from '../scripts/prepare-staff-cutover.mjs';
import {config} from '../scripts/cli.mjs';
import {rehearseSnapshot} from '../scripts/rehearse-preview.mjs';
import {fixtureInput,stageFixture,stageD1Fixture,migrationStatements} from './fixtures/staff-cutover.mjs';

const directory='migrations';
async function setup() {
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL);');
  for(const file of (await readdir(directory)).filter(file=>file.endsWith('.sql')&&file<'0042').sort()){
    db.exec(await readFile(`${directory}/${file}`,'utf8'));db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(file);
  }
  db.exec(`INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES
    ('99271001','虚构核对甲','admin','南湖','private-fixture-password-hash','2026-01-01'),
    ('99271002','虚构核对乙','technician','浑南','private-fixture-password-hash','2026-01-01');
    INSERT INTO staff_campus_grants VALUES('99271001','南湖'),('99271002','浑南');`);
  return db;
}
function people(db){return db.prepare('SELECT * FROM members ORDER BY id').all();}
function convert(db,sql){db.exec('BEGIN; PRAGMA defer_foreign_keys=ON');try{db.exec(sql);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}}
function model(db){return ['staff_accounts','members','departments','member_roles','member_work_profiles','member_department_memberships','audit_events'].map(table=>[table,db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]);}
function dump(db){
  const objects=db.prepare("SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type='trigger',type='index'").all();
  const quote=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
  return [...objects.filter(row=>row.type==='table').flatMap(row=>[row.sql+';',...db.prepare(`SELECT * FROM "${row.name}"`).all().map(value=>`INSERT INTO "${row.name}" VALUES(${Object.values(value).map(quote).join(',')});`)]),...objects.filter(row=>row.type!=='table').map(row=>row.sql+';')].join('\n');
}
const post={departmentCode:'hardware',positionCode:'head',effectiveFrom:'2026-01-01',effectiveTo:'2098-01-01'};
const grant={roleCode:'technician',scope:{campusIds:['campus-hunnan']},effectiveFrom:'2026-01-01',effectiveTo:'2098-01-01',reason:'虚构成员已核对的特殊维修留任'};

test('private preparation rejects omissions, duplicate or mismatched identities, illegal positions, dates and scopes without changing source',async()=>{
  const db=await setup();
  try {
    const before=model(db), valid=fixtureInput(people(db),{'member-99271001':{decision:'migrate',post}});
    const cases=[
      [input=>input.members.pop(),'CUTOVER_DECISIONS_INCOMPLETE'],
      [input=>input.members.push(input.members[0]),'CUTOVER_DUPLICATE_OR_PROTECTED_MEMBER'],
      [input=>input.members[0].name='另一个虚构姓名','CUTOVER_IDENTITY_MISMATCH'],
      [input=>input.members[0].memberId='missing-member','CUTOVER_IDENTITY_MISMATCH'],
      [input=>input.members[0].post.positionCode='president','CUTOVER_INVALID_POSITION'],
      [input=>input.members[0].post.effectiveFrom='2026-02-30','CUTOVER_INVALID_INTERVAL'],
      [input=>input.members[0].decision='revoke','CUTOVER_INVALID_DECISION'],
      [input=>input.members[0].exchangeEnabled=true,'CUTOVER_INPUT_INVALID'],
      [input=>input.members[1]={...input.members[1],decision:'migrate',authorizations:[{...grant,scope:{campusIds:['campus-nanhu']}}]},'CUTOVER_SCOPE_EXCEEDS_ACCOUNT'],
      [input=>input.members[1]={...input.members[1],decision:'migrate',authorizations:[{...grant,roleCode:'superadmin'}]},'CUTOVER_INVALID_ROLE'],
      [input=>input.members[1]={...input.members[1],decision:'migrate',authorizations:[{...grant,reason:''}]},'CUTOVER_AUTHORIZATION_REASON_REQUIRED']
    ];
    for(const [mutate,code] of cases){const input=structuredClone(valid);mutate(input);await assert.rejects(prepareCutover(db,input),error=>error.code===code);assert.deepEqual(model(db),before);}
    const prepared=await prepareCutover(db,valid);assert.deepEqual(model(db),before);assert.equal(prepared.summary.posts,1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE '_staff_cutover_%'").get().n,0);
  }finally{db.close();}
});

test('0042 independently refuses missing decisions and stale identity, role, qualification and campus data before changing permissions',async()=>{
  const definition=await cutoverDefinition();
  const mutations=[null,
    db=>db.exec("DELETE FROM _staff_cutover_decisions WHERE member_id='member-99271002'"),
    db=>db.exec("UPDATE members SET name='更新后的虚构姓名' WHERE id='member-99271001'"),
    db=>db.exec("UPDATE member_roles SET effective_to='2026-01-02' WHERE member_id='member-99271002'"),
    db=>db.exec("UPDATE member_department_memberships SET effective_to='2026-01-02' WHERE member_id='member-99271002'"),
    db=>db.exec("UPDATE member_work_profiles SET effective_to='2026-01-02' WHERE member_id='member-99271002'"),
    db=>db.exec("UPDATE role_grants SET condition_spec='[]',revision=revision+1 WHERE role_id='role-technician'"),
    db=>db.exec("DELETE FROM staff_campus_grants WHERE account='99271002'"),
    db=>db.exec("UPDATE _staff_cutover_batch SET business_date='2000-01-01'")
  ];
  for(const [index,mutate] of mutations.entries()){
    const db=await setup();
    try{
      if(mutate){await stageFixture(db);mutate(db);}
      const before=model(db);assert.throws(()=>convert(db,definition.sql),/staff_cutover_ready/,`source mutation ${index}`);assert.deepEqual(model(db),before);
      assert.equal(db.prepare("SELECT name FROM pragma_table_info('departments') WHERE name='kind'").get(),undefined);
    }finally{db.close();}
  }
});

test('private input is bound to environment, database and migration bytes; approved explicit revocations survive and input disappears',async()=>{
  const db=await setup();
  try{
    await stageFixture(db,{'member-99271001':{decision:'migrate',post},'member-99271002':{decision:'migrate',authorizations:[grant]}});
    const snapshot=dump(db), correct={environment:'preview',databaseId:'isolated-test'};
    assert.equal((await verifyCutoverSnapshot(snapshot,correct)).cutover,'private-input-verified');
    for(const target of [{...correct,environment:'production'},{...correct,databaseId:'different-database'}])await assert.rejects(verifyCutoverSnapshot(snapshot,target),error=>error.code==='CUTOVER_INPUT_TARGET_OR_VERSION_MISMATCH');
    db.exec("UPDATE _staff_cutover_batch SET migration_sha256='different-reviewed-code'");
    await assert.rejects(verifyCutoverSnapshot(dump(db),correct),error=>error.code==='CUTOVER_INPUT_TARGET_OR_VERSION_MISMATCH');
    const fresh=await setup();try{await assert.rejects(verifyCutoverSnapshot(dump(fresh),correct),error=>error.code==='CUTOVER_INPUT_NOT_STAGED');}finally{fresh.close();}
    const definition=await cutoverDefinition();db.prepare('UPDATE _staff_cutover_batch SET migration_sha256=?').run(definition.sha256);
    convert(db,definition.sql);
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE '_staff_cutover_%' OR name LIKE '_organization_%'").get().n,0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM member_roles WHERE role_id='role-repair-lead'").get().n,0,'a real manager post has no stored default manager binding');
    assert.equal(db.prepare("SELECT count(*) AS n FROM member_roles WHERE member_id='member-99271002' AND role_id='role-technician'").get().n,1);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
});

test('private staging import refuses source changes after export and public CLI logs contain summaries only',async()=>{
  const db=await setup(), temporary=await mkdtemp(resolve(tmpdir(),'pioneer-private-cutover-test-'));
  const operator={encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'false'}};
  try{
    const before=model(db), input=fixtureInput(people(db),{'member-99271001':{decision:'migrate',post}});
    const prepared=await prepareCutover(db,input);
    assert.ok(!prepared.sql.includes('private-fixture-password-hash'));
    db.exec("UPDATE staff_accounts SET name='变更后的虚构姓名',revision=revision+1 WHERE account='99271001'");
    assert.throws(()=>convert(db,prepared.sql),/staff_cutover_source_unchanged/);
    assert.deepEqual(db.prepare('SELECT * FROM member_roles ORDER BY rowid').all(),before.find(([name])=>name==='member_roles')[1]);
    const snapshot=resolve(temporary,'snapshot.sql'),file=resolve(temporary,'private-input.json'),output=resolve(temporary,'private-stage.sql');
    await writeFile(snapshot,dump(db));await writeFile(file,JSON.stringify(input));
    const result=spawnSync(process.execPath,['scripts/prepare-staff-cutover.mjs','--preview','--input',file,'--snapshot',snapshot,'--output',output],operator);
    assert.equal(result.status,0,result.stderr);const summary=JSON.parse(result.stdout);assert.equal(summary.mode,'plan-only');assert.equal(summary.changesAuthorization,false);
    for(const value of ['虚构核对','变更后的虚构姓名','99271001','private-fixture-password-hash'])assert.ok(!result.stdout.includes(value)&&!result.stderr.includes(value));
    const contents=await readFile(output,'utf8');assert.ok(contents.includes('_staff_cutover_decisions'));assert.ok(!contents.includes('private-fixture-password-hash'));
    const rehearsal=spawnSync(process.execPath,['scripts/rehearse-preview.mjs','--snapshot',snapshot,'--input',file],operator);
    assert.equal(rehearsal.status,0,rehearsal.stderr);assert.ok(JSON.parse(rehearsal.stdout).preservedTables>0);
    for(const value of ['虚构核对','变更后的虚构姓名','99271001','private-fixture-password-hash'])assert.ok(!rehearsal.stdout.includes(value)&&!rehearsal.stderr.includes(value));
    await writeFile(file,'{"private_invalid_name":');
    const denied=spawnSync(process.execPath,['scripts/prepare-staff-cutover.mjs','--preview','--input',file,'--snapshot',snapshot],operator);
    assert.equal(denied.status,1);assert.ok(denied.stderr.trim().endsWith('CUTOVER_INPUT_INVALID'));
    const inside=spawnSync(process.execPath,['scripts/prepare-staff-cutover.mjs','--input',resolve('package.json')],operator);
    assert.equal(inside.status,1);assert.ok(inside.stderr.trim().endsWith('CUTOVER_INPUT_INSIDE_REPOSITORY'));
    const ci=spawnSync(process.execPath,['scripts/prepare-staff-cutover.mjs'],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true'}});
    assert.equal(ci.status,1);assert.ok(ci.stderr.split(/\r?\n/).includes('CUTOVER_LOCAL_EXECUTION_REQUIRED'));
  }finally{db.close();await rm(temporary,{recursive:true,force:true});}
});

test('CI preflight accepts complete staged input, rejects missing, changed or misdirected input and never exports Production records',async()=>{
  const db=await setup(), calls=[];
  const run=args=>{
    calls.push(args);
    assert.equal(args[1],'execute','CI must never export a snapshot');
    const sql=args[args.indexOf('--command')+1];
    return JSON.stringify([{success:true,results:db.prepare(sql).all()}]);
  };
  try{
    const options={},databaseId=(await config()).d1_databases.find(item=>item.binding==='DB').database_id;
    await assert.rejects(verifyRemoteCutover(options,run),error=>error.code==='CUTOVER_INPUT_NOT_STAGED');
    const input={...fixtureInput(people(db)),environment:'production'};
    db.exec((await prepareCutover(db,input,{environment:'production',databaseId})).sql);
    assert.deepEqual(await verifyRemoteCutover(options,run),{cutover:'private-input-ready',members:2});
    for(const [sql,code] of [
      ["UPDATE _staff_cutover_batch SET environment='preview'",'CUTOVER_INPUT_TARGET_OR_VERSION_MISMATCH'],
      ["UPDATE _staff_cutover_batch SET database_id='different-database'",'CUTOVER_INPUT_TARGET_OR_VERSION_MISMATCH'],
      ["UPDATE _staff_cutover_batch SET migration_sha256='unreviewed-code'",'CUTOVER_INPUT_TARGET_OR_VERSION_MISMATCH'],
      ["UPDATE _staff_cutover_batch SET business_date='2000-01-01'",'CUTOVER_INPUT_EXPIRED'],
      ["DELETE FROM _staff_cutover_decisions WHERE member_id='member-99271002'",'CUTOVER_DECISIONS_INCOMPLETE'],
      ["UPDATE _staff_cutover_decisions SET member_id='not-a-real-member' WHERE member_id='member-99271002'",'CUTOVER_DECISIONS_INCOMPLETE'],
      ["UPDATE members SET name='变更后的虚构姓名' WHERE id='member-99271001'",'CUTOVER_SOURCE_CHANGED']
    ]){
      db.exec('SAVEPOINT invalid_input');
      try{db.exec(sql);await assert.rejects(verifyRemoteCutover(options,run),error=>error.code===code);}
      finally{db.exec('ROLLBACK TO invalid_input; RELEASE invalid_input');}
    }
    assert.equal((await rehearseSnapshot(dump(db))).unconfirmedMembers,0,'Preview CI can consume already staged decisions without a private file');
    db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run('0042_organization_permissions.sql');
    assert.deepEqual(await verifyRemoteCutover(options,run),{cutover:'already-applied'});
    db.exec("DELETE FROM d1_migrations WHERE name='0042_organization_permissions.sql'; DELETE FROM staff_accounts; DELETE FROM members;");
    await assert.rejects(verifyRemoteCutover(options,run),error=>error.code==='CUTOVER_DECISIONS_INCOMPLETE');
    db.exec('DELETE FROM _staff_cutover_decisions; DELETE FROM _staff_cutover_batch;');
    assert.deepEqual(await verifyRemoteCutover(options,run),{cutover:'empty-database',members:0});
    assert.ok(calls.every(args=>args[1]==='execute'));
  }finally{db.close();}
});

test('the legacy Production ledger can stage once and upgrade through the existing CI migration path',async()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('PRAGMA foreign_keys=ON; CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY,name TEXT UNIQUE NOT NULL);');
    for(const file of (await readdir(directory)).filter(file=>file.endsWith('.sql')&&file<'0010').sort()){
      db.exec(await readFile(`${directory}/${file}`,'utf8'));db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(file);
    }
    db.exec("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('99273001','虚构生产旧成员','admin','南湖','preserved-private-hash','2026-01-01'); INSERT INTO staff_campus_grants VALUES('99273001','南湖');");
    const databaseId=(await config()).d1_databases.find(item=>item.binding==='DB').database_id;
    const projected=await projectCutoverSnapshot(dump(db));
    try{
      const input={...fixtureInput(people(projected.sqlite)),environment:'production'};
      const prepared=await prepareCutover(projected.sqlite,input,{environment:'production',databaseId,original:projected.original});
      db.exec(prepared.sql);
    }finally{projected.sqlite.close();}
    const run=args=>{
      assert.equal(args[1],'execute','the CI path must not export any Production records');
      return JSON.stringify([{success:true,results:db.prepare(args[args.indexOf('--command')+1]).all()}]);
    };
    assert.deepEqual(await verifyRemoteCutover({},run),{cutover:'private-input-ready',members:1});
    const report=await rehearseSnapshot(dump(db));assert.ok(report.applied>1);assert.equal(report.accounts['admin → '],1);
    for(const file of (await readdir(directory)).filter(file=>file.endsWith('.sql')).sort()){
      if(db.prepare('SELECT 1 FROM d1_migrations WHERE name=?').get(file))continue;
      convert(db,await readFile(`${directory}/${file}`,'utf8'));
      db.prepare('INSERT INTO d1_migrations(name) VALUES(?)').run(file);
    }
    assert.deepEqual(await verifyRemoteCutover({},run),{cutover:'already-applied'});
    assert.equal(db.prepare('SELECT password_hash FROM staff_accounts').get().password_hash,'preserved-private-hash');
    assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name LIKE '_staff_cutover_%'").get().n,0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
});

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
