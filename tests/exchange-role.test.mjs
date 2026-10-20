import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';

async function apply(db,path) {
  const statements=[];let buffer='';
  for(const line of (await readFile(path,'utf8')).replace(/--[^\n]*/g,'').split('\n')) {
    buffer=`${buffer}\n${line}`.trim();
    if(buffer&&(buffer.startsWith('CREATE TRIGGER')?line.trim()==='END;':line.trim().endsWith(';'))) { statements.push(buffer);buffer=''; }
  }
  assert.equal(buffer,'',path);
  await db.batch(statements.map(sql=>db.prepare(sql)));
}

test('both migration chains separate active exchange roles without changing departments, scopes or historical bindings',async()=>{
  const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'exchange-upgrade',compatibilityDate:'2026-10-01',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("ok");}}'}}},env:{DEV:{type:'d1',id:'exchange-dev'},STAFF:{type:'d1',id:'exchange-staff'}}}}]});
  try {
    for(const [binding,directory] of [['DEV','migrations'],['STAFF','database/staff-migrations']]) {
      const db=await mf.getD1Database(binding);
      for(const file of (await readdir(directory)).filter(name=>name.endsWith('.sql')&&name<'0025').sort()) await apply(db,`${directory}/${file}`);
      for(const account of ['20268101','20268102','20268103']) {
        await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,?,'technician','南湖','fixture','2026-01-01')").bind(account,account).run();
      }
      await db.prepare("UPDATE member_work_profiles SET profile_code='exchange' WHERE member_id IN ('member-20268101','member-20268103')").run();
      await db.prepare("UPDATE member_department_memberships SET department_id='dept-network' WHERE member_id IN ('member-20268101','member-20268103')").run();
      const scope=JSON.stringify({campusIds:['campus-nanhu'],departmentIds:['dept-network']});
      await db.prepare("UPDATE member_roles SET scope_bindings=?,effective_to='2099-01-01',revision=3 WHERE member_id='member-20268101'").bind(scope).run();
      await db.prepare("UPDATE member_roles SET effective_to='2026-02-01' WHERE member_id='member-20268103'").run();
      const oldToken=await db.prepare("SELECT token_version,auth_version FROM staff_accounts WHERE account='20268101'").first();
      const ordinary=await db.prepare("SELECT * FROM staff_accounts WHERE account='20268102'").first();
      const originalGrants=(await db.prepare("SELECT permission_code,scope_spec,condition_spec,validity_spec FROM role_grants WHERE role_id='role-technician' AND permission_code<>'roster.read' ORDER BY permission_code").all()).results;
      await apply(db,`${directory}/0025_exchange_role.sql`);
      assert.equal((await db.prepare("SELECT name FROM roles WHERE code='exchange'").first()).name,'交流人员');
      const migrated=await db.prepare("SELECT * FROM member_roles WHERE member_id='member-20268101'").first();
      assert.equal(migrated.role_id,'role-exchange');assert.equal(migrated.scope_bindings,scope);
      assert.equal(migrated.effective_from,'2026-01-01');assert.equal(migrated.effective_to,'2099-01-01');assert.equal(migrated.revision,4);
      assert.equal((await db.prepare("SELECT department_id FROM member_department_memberships WHERE member_id='member-20268101'").first()).department_id,'dept-network');
      assert.equal((await db.prepare("SELECT role_id FROM member_roles WHERE member_id='member-20268102'").first()).role_id,'role-technician');
      assert.equal((await db.prepare("SELECT role_id FROM member_roles WHERE member_id='member-20268103'").first()).role_id,'role-technician','ended history is unchanged');
      assert.deepEqual(await db.prepare("SELECT * FROM staff_accounts WHERE account='20268102'").first(),ordinary);
      const renewed=await db.prepare("SELECT token_version,auth_version FROM staff_accounts WHERE account='20268101'").first();
      assert.equal(renewed.token_version,oldToken.token_version+1);assert.equal(renewed.auth_version,oldToken.auth_version+1);
      const grants=(await db.prepare("SELECT permission_code,scope_spec,condition_spec,validity_spec FROM role_grants WHERE role_id='role-exchange' ORDER BY permission_code").all()).results;
      assert.deepEqual(grants,originalGrants);
      assert.equal(grants.some(row=>row.permission_code.startsWith('roster.')),false);
      await db.prepare("DELETE FROM role_grants WHERE role_id='role-exchange' AND permission_code='repair.start'").run();
      assert.ok(await db.prepare("SELECT id FROM role_grants WHERE role_id='role-technician' AND permission_code='repair.start'").first(),'editing exchange grants leaves technician grants independent');
      assert.equal((await db.prepare('PRAGMA foreign_key_check').all()).results.length,0);
      assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name='_exchange_role_bindings'").first(),null);
    }
  } finally { await mf.dispose(); }
});
