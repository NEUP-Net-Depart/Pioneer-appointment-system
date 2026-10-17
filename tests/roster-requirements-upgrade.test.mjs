import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';

async function statements(path){
  const result=[];let buffer='';
  for(const line of (await readFile(path,'utf8')).replace(/--[^\n]*/g,'').split('\n')){
    buffer=`${buffer}\n${line}`.trim();
    if(buffer && (buffer.startsWith('CREATE TRIGGER')?line.trim()==='END;':line.trim().endsWith(';'))){result.push(buffer);buffer='';}
  }
  assert.equal(buffer,'');return result;
}
test('both staffing upgrades preserve published history, flag old tasks and roll back interrupted changes',async()=>{
  const mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'staffing-upgrade',compatibilityDate:'2026-10-01',manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch(){return new Response("ok");}}'}}},env:{DEV:{type:'d1',id:'staffing-dev'},STAFF:{type:'d1',id:'staffing-staff'}}}}]});
  try{for(const [binding,directory,last] of [['DEV','migrations','0021_roster_staffing_requirements.sql'],['STAFF','database/staff-migrations','0019_roster_staffing_requirements.sql']]){
    const db=await mf.getD1Database(binding);
    for(const file of (await readdir(directory)).filter(file=>file.endsWith('.sql') && file<last).sort())await db.batch((await statements(`${directory}/${file}`)).map(sql=>db.prepare(sql)));
    await db.prepare("INSERT INTO roster_tasks(id,week_start,campus_scope,slot_start,slot_end,deadline,created_at) VALUES('old-task','2026-10-12','{\"campusIds\":[\"campus-nanhu\"]}','19:00','21:00','2026-10-11','2026-10-10')").run();
    await db.prepare("INSERT INTO roster_versions(id,task_id,status,version,rule_version,algorithm_version,created_at) VALUES('old-published','old-task','published',1,'1.0.0','old','2026-10-10')").run();
    const before=await db.prepare("SELECT * FROM roster_versions WHERE id='old-published'").first();
    const sql=await statements(`${directory}/${last}`);
    await assert.rejects(db.batch([...sql.map(item=>db.prepare(item)),db.prepare('INSERT INTO missing_staffing_table VALUES(1)')]));
    assert.equal((await db.prepare('PRAGMA table_info(roster_tasks)').all()).results.some(row=>row.name==='rule_version'),false);
    await db.batch(sql.map(item=>db.prepare(item)));
    assert.deepEqual(await db.prepare("SELECT * FROM roster_versions WHERE id='old-published'").first(),before);
    assert.equal((await db.prepare("SELECT rule_version FROM roster_tasks WHERE id='old-task'").first()).rule_version,'legacy');
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM roster_staffing_requirements').first()).n,0);
    const office=(await db.prepare("SELECT * FROM role_grants WHERE role_id='role-office-lead' AND permission_code='roster.repair.configure'").first());
    assert.equal(office.scope_spec,'{"campuses":"bound"}');
    assert.equal(await db.prepare("SELECT id FROM role_grants WHERE role_id='role-office-lead' AND permission_code='roster.repair.manage'").first(),null);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  }}finally{await mf.dispose();}
});
