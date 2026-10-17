import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';

async function statements(path) {
  const result=[];let buffer='';
  for(const line of (await readFile(path,'utf8')).replace(/--[^\n]*/g,'').split('\n')) {
    buffer=`${buffer}\n${line}`.trim();
    if(buffer && (buffer.startsWith('CREATE TRIGGER') ? line.trim()==='END;' : line.trim().endsWith(';'))) {result.push(buffer);buffer='';}
  }
  assert.equal(buffer,'');return result;
}
test('both signed-lead upgrades preserve scoped custom restrictions and roll back interrupted migration batches',async()=>{
  const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'signed-lead-upgrade',compatibilityDate:'2026-10-01',
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("ok");}}'}}},env:{DEV:{type:'d1',id:'lead-upgrade-dev'},STAFF:{type:'d1',id:'lead-upgrade-staff'}}}}]});
  try {
    for(const [binding,directory,last] of [['DEV','migrations','0020_signed_repair_leads.sql'],['STAFF','database/staff-migrations','0018_signed_repair_leads.sql']]) {
      const db=await mf.getD1Database(binding);
      for(const file of (await readdir(directory)).filter(file=>file.endsWith('.sql') && file<last).sort()) await db.batch((await statements(`${directory}/${file}`)).map(sql=>db.prepare(sql)));
      await db.prepare("INSERT INTO roles(id,code,name,created_at,updated_at) VALUES('custom-lead','custom-lead','自定义负责人','2026-01-01','2026-01-01')").run();
      const scope='{"campusIds":["campus-nanhu"],"departmentIds":["dept-hardware"]}',validity='{"effectiveTo":"2026-11-01"}';
      await db.prepare("INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec,validity_spec) VALUES('custom-lead-transfer','custom-lead','repair.transfer',?,?,?)").bind(scope,'[{"code":"activeDutyRole","version":1},{"code":"activeDepartmentMembership","version":1,"parameters":{"departmentId":"dept-hardware"}}]',validity).run();
      const before=(await db.prepare('SELECT * FROM role_grants ORDER BY id').all()).results;
      const sql=await statements(`${directory}/${last}`);
      await assert.rejects(db.batch([...sql.map(item=>db.prepare(item)),db.prepare('INSERT INTO missing_signed_lead_upgrade VALUES(1)')]));
      assert.deepEqual((await db.prepare('SELECT * FROM role_grants ORDER BY id').all()).results,before);
      await db.batch(sql.map(item=>db.prepare(item)));
      const grant=await db.prepare("SELECT * FROM role_grants WHERE id='custom-lead-transfer'").first();
      assert.equal(grant.scope_spec,scope);assert.equal(grant.validity_spec,validity);
      assert.deepEqual(JSON.parse(grant.condition_spec),[{code:'signedDutyPresence',version:1},{code:'activeDepartmentMembership',version:1,parameters:{departmentId:'dept-hardware'}}]);
      for(const id of ['grant-office-summary','grant-office-lead-summary','grant-office-attendance']) assert.deepEqual(await db.prepare('SELECT * FROM role_grants WHERE id=?').bind(id).first(),before.find(item=>item.id===id));
      assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
    }
  } finally {await mf.dispose();}
});
