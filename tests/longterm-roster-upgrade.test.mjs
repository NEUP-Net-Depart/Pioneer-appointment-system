import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';

async function statements(path) {
  const result = []; let buffer = '';
  for (const line of (await readFile(path,'utf8')).replace(/--[^\n]*/g,'').split('\n')) {
    buffer = `${buffer}\n${line}`.trim();
    if (buffer && (buffer.startsWith('CREATE TRIGGER') ? line.trim() === 'END;' : line.trim().endsWith(';'))) {result.push(buffer); buffer = '';}
  }
  assert.equal(buffer,''); return result;
}
test('both upgrades separate long-term defaults from daily duties without weakening customized grants', async () => {
  const mf = new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'longterm-roster-upgrade',compatibilityDate:'2026-10-01',
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch() {return new Response("ok");}};'}}},
    env:{DEV:{type:'d1',id:'longterm-dev'},STAFF:{type:'d1',id:'longterm-staff'}}}}]});
  try {
    for (const [binding,directory,last] of [['DEV','migrations','0019_longterm_roster_permissions.sql'],['STAFF','database/staff-migrations','0017_longterm_roster_permissions.sql']]) {
      const db = await mf.getD1Database(binding);
      for (const file of (await readdir(directory)).filter(file => file.endsWith('.sql') && file < last).sort()) await db.batch((await statements(`${directory}/${file}`)).map(sql => db.prepare(sql)));
      for (const account of ['20998701','20998702']) await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,'升级测试','technician','南湖','test-only','2026-01-01')").bind(account).run();
      await db.prepare("INSERT INTO member_roles(id,member_id,role_id,effective_from) VALUES('upgrade-lead','member-20998701','role-repair-lead','2026-01-01')").run();
      await db.prepare("INSERT INTO roles(id,code,name,created_at,updated_at) VALUES('custom-longterm','custom-longterm','自定义岗位限制','2026-01-01','2026-01-01')").run();
      await db.prepare("INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec) VALUES('custom-longterm-grant','custom-longterm','roster.repair.manage','{\"campusIds\":[\"campus-nanhu\"]}','[{\"code\":\"activeDutyRole\",\"version\":1}]')").run();
      if (binding === 'STAFF') await db.prepare("UPDATE role_grants SET condition_spec='[{\"code\":\"activeDutyRole\",\"version\":1,\"parameters\":{\"kind\":\"office_lead\"}}]' WHERE id='grant-office-lead-leave'").run();
      const snapshot = async () => (await db.batch(['role_grants','roles','staff_accounts','permission_definitions'].map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1`)))).map(result => result.results);
      const before = await snapshot(), migration = await statements(`${directory}/${last}`);
      await assert.rejects(db.batch([...migration.map(sql => db.prepare(sql)),db.prepare('INSERT INTO missing_longterm_upgrade VALUES(1)')]));
      assert.deepEqual(await snapshot(),before);
      await db.batch(migration.map(sql => db.prepare(sql)));
      const [afterGrants,afterRoles,afterAccounts,definitions] = await snapshot();
      const grants = new Map(afterGrants.map(item => [item.id,item]));
      for (const id of ['grant-repair-lead-roster','grant-office-lead-roster']) assert.equal(grants.get(id).condition_spec,'[]');
      assert.equal(grants.get('grant-office-lead-leave').condition_spec,binding === 'DEV' ? '[]' : before[0].find(item => item.id === 'grant-office-lead-leave').condition_spec);
      for (const original of before[0].filter(item => !['grant-repair-lead-roster','grant-office-lead-roster','grant-office-lead-leave'].includes(item.id))) assert.deepEqual(grants.get(original.id),original,'field grants and custom restrictions remain intact');
      for (const code of ['roster.repair.manage','roster.office.manage','leave.review']) assert.equal(definitions.find(item => item.code === code).condition_kinds,'[]');
      for (const original of before[2]) {
        const after = afterAccounts.find(item => item.account === original.account), delta = original.account === '20998701' ? 1 : 0;
        assert.equal(after.auth_version,original.auth_version+delta); assert.equal(after.token_version,original.token_version+delta);
      }
      assert.equal(afterRoles.find(item => item.id === 'role-repair-lead').revision,before[1].find(item => item.id === 'role-repair-lead').revision+1);
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
    }
  } finally {await mf.dispose();}
});

test('office attendance export upgrades both histories, preserves bound scopes and invalidates only affected sessions',async()=>{
  const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'office-export-upgrade',compatibilityDate:'2026-10-01',
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("ok");}}'}}},
    env:{DEV:{type:'d1',id:'export-dev'},STAFF:{type:'d1',id:'export-staff'}}}}]});
  try{for(const [binding,directory]of [['DEV','migrations'],['STAFF','database/staff-migrations']]){
    const db=await mf.getD1Database(binding),last='0023_office_attendance_export.sql';
    for(const file of (await readdir(directory)).filter(file=>file.endsWith('.sql')&&file<last).sort())await db.batch((await statements(`${directory}/${file}`)).map(sql=>db.prepare(sql)));
    for(const account of ['20998711','20998712'])await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,'月度考勤核查','technician','南湖','test-only','2026-01-01')").bind(account).run();
    await db.prepare("INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from) VALUES('export-bound-lead','member-20998711','role-office-lead','{\"campusIds\":[\"campus-nanhu\"],\"departmentIds\":[\"dept-office\"]}','2026-01-01')").run();
    const bindingBefore=await db.prepare("SELECT * FROM member_roles WHERE id='export-bound-lead'").first();
    const before=(await db.prepare("SELECT account,auth_version,token_version FROM staff_accounts ORDER BY account").all()).results;
    const migration=await statements(`${directory}/${last}`);
    await db.batch(migration.map(sql=>db.prepare(sql)));
    const grant=await db.prepare("SELECT * FROM role_grants WHERE id='grant-office-lead-export'").first();
    assert.equal(grant.permission_code,'attendance.export');assert.deepEqual(JSON.parse(grant.scope_spec),{campuses:'bound'});assert.deepEqual(JSON.parse(grant.condition_spec),[]);
    assert.deepEqual(await db.prepare("SELECT * FROM member_roles WHERE id='export-bound-lead'").first(),bindingBefore);
    const after=(await db.prepare("SELECT account,auth_version,token_version FROM staff_accounts ORDER BY account").all()).results;
    for(const row of before){const updated=after.find(item=>item.account===row.account),delta=row.account==='20998711'?1:0;assert.equal(updated.auth_version,row.auth_version+delta);assert.equal(updated.token_version,row.token_version+delta);}
    await db.batch(migration.map(sql=>db.prepare(sql)));
    assert.deepEqual((await db.prepare("SELECT account,auth_version,token_version FROM staff_accounts ORDER BY account").all()).results,after,'reapplying the permission migration is a no-op');
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  }}finally{await mf.dispose();}
});
