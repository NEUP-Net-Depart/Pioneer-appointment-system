import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {verifyStaffSchema,STAFF_RELEASE} from '../src/db/staff-readiness.js';
import {staffPlatformRepository} from '../src/db/staff-platform.js';
import {userRepository} from '../src/db/users.js';
import {composeStaffPlatform} from '../src/app/compose.js';
import {staffPlatformService} from '../src/services/staff-platform.js';

function adapter(sqlite) {
  return {prepare(sql) {
    const query=sqlite.prepare(sql);
    const statement=values=>({bind:(...args)=>statement(args),first:async()=>query.get(...values)||null,all:async()=>({results:query.all(...values)})});
    return statement([]);
  },batch:async statements=>Promise.all(statements.map(statement=>statement.all()))};
}
async function baseline(directory) {
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  for(const name of (await readdir(directory)).filter(name=>name<'0033').sort())db.exec(await readFile(directory+'/'+name,'utf8'));
  db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('20268801','原管理员','admin','南湖','unchanged-hash','2026-01-01')").run();
  db.prepare("INSERT INTO staff_campus_grants VALUES('20268801','南湖')").run();
  db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('20268803','原维修人员','technician','南湖','technician-hash','2026-01-01')").run();
  db.prepare("INSERT INTO staff_campus_grants VALUES('20268803','南湖')").run();
  return db;
}
function snapshot(db) {
  return db.prepare("SELECT name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY name").all().map(row=>({
    ...row,rows:row.sql.startsWith('CREATE TABLE') ? db.prepare(`SELECT * FROM "${row.name}"`).all() : []
  }));
}
for(const directory of ['migrations','database/staff-migrations']) {
  test(`${directory}: explicit scopes, expired and future authorization survive the real business-role upgrade`,async()=>{
    const db=await baseline(directory);
    try {
      const today=db.prepare("SELECT date('now','+8 hours') AS day").get().day;
      for(const account of ['20268804','20268805','20268806','20268807']){
        db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,'显式配置负责人','admin','南湖','preserved-explicit-hash','2026-01-01')").run(account);
        if(account!=='20268807')for(const campus of ['南湖','浑南'])db.prepare('INSERT INTO staff_campus_grants VALUES(?,?)').run(account,campus);
      }
      const periods=[['20268804','2026-01-01','2098-01-01'],['20268805','2025-01-01','2026-01-01'],['20268806','2098-01-01',null]];
      for(const [account,from,to] of periods){
        for(const role of ['repair-lead','technician'])db.prepare("INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from,effective_to,revision) VALUES(?,?,?,'{\"campusIds\":[\"campus-nanhu\"],\"departmentIds\":[\"dept-hardware\"]}',?,?,7)").run(`explicit-${role}-${account}`,`member-${account}`,`role-${role}`,from,to);
        db.prepare("INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from,effective_to,revision) VALUES(?,?,'repair',?,?,4)").run(`explicit-profile-${account}`,`member-${account}`,from,to);
        db.prepare("INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,effective_from,effective_to,created_at,revision) VALUES(?,?,?,'primary',1,?,?,?,2)").run(`explicit-department-${account}`,`member-${account}`,account==='20268804' ? 'dept-office' : 'dept-hardware',from,to,from);
      }
      db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('20268808','未来维修资格人员','technician','南湖','preserved-future-hash','2026-01-01')").run();
      db.prepare("DELETE FROM member_department_memberships WHERE member_id='member-20268808'").run();
      db.prepare("UPDATE member_work_profiles SET effective_from='2098-01-01' WHERE member_id='member-20268808'").run();
      // Even a seed ID may have been deliberately edited. Keep mixed conditions,
      // parameters, scope and validity; never replace them with an empty guard.
      db.prepare("UPDATE role_grants SET condition_spec=?,scope_spec=?,validity_spec=?,revision=3 WHERE id='grant-repair-lead-correct'").run(
        '[ { "code": "signedDutyPresence", "version": 1 }, { "code": "activeDepartmentMembership", "version": 1, "parameters": { "departmentId": "dept-hardware" } } ]',
        '{"campusIds":["campus-nanhu"]}','{"effectiveTo":"2098-01-01"}');
      db.prepare("UPDATE role_grants SET condition_spec=? WHERE id='grant-repair-lead-transfer'").run('[ { "code": "signedDutyPresence", "version": 1, "parameters": { "dutyType": "repair" } } ]');
      db.prepare("INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec,validity_spec,revision) VALUES('explicit-old-settings','role-repair-lead','settings.manage','{\"campusIds\":[\"campus-nanhu\"]}','[]','{\"effectiveTo\":\"2026-01-01\"}',5)").run();
      const explicit=table=>db.prepare(`SELECT * FROM ${table} WHERE id LIKE 'explicit-%' OR id IN ('grant-repair-lead-correct','grant-repair-lead-transfer') ORDER BY id`).all();
      const bindings=explicit('member_roles'),profiles=explicit('member_work_profiles'),grants=explicit('role_grants');
      const departments=explicit('member_department_memberships');
      const accounts=db.prepare('SELECT account,password_hash,member_id,home_campus,status FROM staff_accounts ORDER BY account').all();
      const campuses=db.prepare('SELECT * FROM staff_campus_grants ORDER BY account,campus').all();
      db.exec('BEGIN;'+await readFile(directory+'/0033_staff_business_roles.sql','utf8')+'COMMIT;');
      assert.deepEqual(explicit('member_roles'),bindings);
      assert.deepEqual(explicit('member_work_profiles'),profiles);
      assert.deepEqual(explicit('role_grants'),grants);
      assert.deepEqual(explicit('member_department_memberships'),departments);
      assert.deepEqual(db.prepare('SELECT account,password_hash,member_id,home_campus,status FROM staff_accounts ORDER BY account').all(),accounts);
      assert.deepEqual(db.prepare('SELECT * FROM staff_campus_grants ORDER BY account,campus').all(),campuses);
      for(const [account] of periods){
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM member_roles WHERE member_id=?').get(`member-${account}`).n,2);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM member_work_profiles WHERE member_id=?').get(`member-${account}`).n,1);
      }
      for(const account of ['20268805','20268806'])assert.equal(db.prepare('SELECT COUNT(*) AS n FROM member_department_memberships WHERE member_id=?').get(`member-${account}`).n,1,'dated hardware affiliation must not be reopened');
      assert.equal(db.prepare("SELECT COUNT(*) AS n FROM member_department_memberships WHERE member_id='member-20268808'").get().n,0,'a future repair qualification must not create a present hardware affiliation');
      assert.equal(db.prepare("SELECT is_primary FROM member_department_memberships WHERE member_id='member-20268804' AND department_id='dept-hardware'").get().is_primary,0,'explicit office appointment remains primary');
      for(const account of ['20268801','20268807']){
        const scope=account==='20268801' ? ['campus-nanhu'] : [];
        for(const role of ['repair-lead','technician'])assert.deepEqual({...db.prepare('SELECT scope_bindings,effective_from,effective_to FROM member_roles WHERE member_id=? AND role_id=?').get(`member-${account}`,`role-${role}`)},
          {scope_bindings:JSON.stringify({campusIds:scope}),effective_from:today,effective_to:null});
        assert.ok(db.prepare("SELECT id FROM member_work_profiles WHERE member_id=? AND profile_code='repair' AND effective_from=?").get(`member-${account}`,today));
      }
      const repository=staffPlatformRepository(adapter(db)),platform=composeStaffPlatform({repository});
      const staff=staffPlatformService({repository,platform,manifests:platform.manifests});
      for(const account of ['20268801','20268804','20268805','20268806','20268807']){
        const context=await staff.contextFor(await userRepository(adapter(db)).find(account),today);
        const allowed=account==='20268801' || account==='20268804';
        const target={campusId:'campus-nanhu',departmentIds:['dept-hardware']};
        for(const code of ['roles.manage','repair.start']){
          assert.equal(platform.authorizer.evaluate(context.actor,code,target,context,context.grants).allowed,allowed,account+': '+code);
          assert.equal(platform.authorizer.evaluate(context.actor,code,{...target,campusId:'campus-hunnan'},context,context.grants).allowed,false,account+' must not gain a second campus');
        }
        assert.notEqual(context.permissions['settings.manage'],true,'an expired explicit grant stays expired');
      }
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    }finally{db.close();}
  });
  test(`${directory}: disabled and customized shared-role metadata is not silently reset`,async()=>{
    const db=await baseline(directory);
    try{
      db.prepare("UPDATE roles SET name='显式名称',description='保留配置',level=3,enabled=0,revision=8 WHERE code='repair_lead'").run();
      const before=db.prepare("SELECT * FROM roles WHERE code='repair_lead'").get();
      db.exec(await readFile(directory+'/0033_staff_business_roles.sql','utf8'));
      assert.deepEqual(db.prepare("SELECT * FROM roles WHERE code='repair_lead'").get(),before);
    }finally{db.close();}
  });
  test(`${directory}: duplicate logins abort the entire upgrade without merging credentials or campus rights`,async()=>{
    const db=await baseline(directory);
    try {
      db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,member_id) VALUES('20268802','另一个账号','technician','浑南','separate-hash','2026-01-01','member-20268801')").run();
      db.prepare("INSERT INTO staff_campus_grants VALUES('20268802','浑南')").run();
      const before=snapshot(db),sql=await readFile(directory+'/0033_staff_business_roles.sql','utf8');
      db.exec('BEGIN');
      assert.throws(()=>db.exec(sql),/CHECK constraint/);
      db.exec('ROLLBACK');
      assert.deepEqual(snapshot(db),before);
    }finally{db.close();}
  });
  test(`${directory}: failed batches roll back and readiness rejects incomplete or weakened authorization schemas`,async()=>{
    const db=await baseline(directory);
    try {
      const before=snapshot(db),sql=await readFile(directory+'/0033_staff_business_roles.sql','utf8');
      await assert.rejects(verifyStaffSchema(adapter(db)));
      db.exec('BEGIN');
      assert.throws(()=>db.exec(sql+'INSERT INTO missing_upgrade_table VALUES(1);'),/missing_upgrade_table/);
      db.exec('ROLLBACK');
      assert.deepEqual(snapshot(db),before);
      db.exec('BEGIN;'+sql+'COMMIT;');
      for(const file of (await readdir(directory)).filter(name=>name.endsWith('.sql') && name>'0033_staff_business_roles.sql').sort())db.exec(await readFile(directory+'/'+file,'utf8'));
      assert.equal(await verifyStaffSchema(adapter(db)),STAFF_RELEASE);
      for(const [table,column] of [['member_roles','scope_bindings'],['role_grants','scope_spec']])
        assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE json_extract(${column},'$.campuses')='legacy' OR json_extract(${column},'$.campusIds')='legacy'`).get().n,0);
      assert.equal(JSON.parse(db.prepare("SELECT scope_bindings FROM member_roles WHERE member_id='member-20268803'").get().scope_bindings).campuses,'bound');
      const row=db.prepare("SELECT password_hash FROM staff_accounts WHERE account='20268801'").get();
      assert.equal(row.password_hash,'unchanged-hash');
      db.exec('DROP INDEX idx_staff_accounts_member_id; CREATE INDEX idx_staff_accounts_member_id ON staff_accounts(member_id)');
      await assert.rejects(verifyStaffSchema(adapter(db)),/uniqueness/);
      db.exec('DROP INDEX idx_staff_accounts_member_id; CREATE UNIQUE INDEX idx_staff_accounts_member_id ON staff_accounts(account)');
      await assert.rejects(verifyStaffSchema(adapter(db)),/wrong column/);
    }finally{db.close();}
  });
}
