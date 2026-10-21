import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {Miniflare} from 'miniflare';

async function statements(path) {
  const source = (await readFile(path,'utf8')).replace(/--[^\n]*/g,'');
  const result = []; let pending = '';
  for (const line of source.split('\n')) {
    pending = `${pending}\n${line}`.trim();
    if (pending && (pending.startsWith('CREATE TRIGGER') ? line.trim() === 'END;' : line.trim().endsWith(';'))) {result.push(pending); pending = '';}
  }
  assert.equal(pending,''); return result;
}
const tables = ['roster_tasks','availability','roster_versions','duty_assignments','duty_roles','leave_requests','swap_requests','audit_events','operation_receipts'];
async function snapshot(db) {
  const rows = await db.batch(tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY 1,2,3`)));
  return Object.fromEntries(rows.map((row,index) => [tables[index],row.results]));
}

test('roster scope upgrades preserve populated tasks, cascading availability and every history reference atomically', async () => {
  const mf = new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'roster-scope-upgrade',compatibilityDate:'2026-10-01',
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:'export default {fetch() {return new Response("ok");}};'}}},
    env:{DEV:{type:'d1',id:'scope-upgrade-dev'}}
  }}]});
  try {
    const binding='DEV',directory='migrations',last='0018_roster_task_scopes.sql';
    const db = await mf.getD1Database(binding);
    for (const file of (await readdir(directory)).filter(file => file.endsWith('.sql') && file < last).sort()) await db.batch((await statements(`${directory}/${file}`)).map(sql => db.prepare(sql)));
    for (const account of ['20998811','20998812']) await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,?,'technician','南湖','test-only','2026-01-01')").bind(account,account).run();
    await db.prepare(`INSERT INTO roster_tasks(id,week_start,campus_scope,slot_start,slot_end,member_ids,deadline,description,revision,created_by_member_id,created_at,duty_type)
      VALUES('old-task','2026-11-02','{"campusIds":["campus-nanhu"]}','19:00','21:00','["member-20998811","member-20998812"]','2026-11-01','保留历史任务',3,'member-20998811','2026-10-16','repair')`).run();
    await db.prepare("INSERT INTO availability(id,task_id,member_id,business_date,start_at,end_at,campus_id,revision) VALUES('old-window','old-task','member-20998811','2026-11-02','18:00','22:00','campus-nanhu',4)").run();
    await db.prepare("INSERT INTO roster_versions(id,task_id,status,version,rule_version,algorithm_version,input_snapshot_ref,solver_status,validation_result,created_at) VALUES('old-version','old-task','published',5,'1','old','{\"retained\":true}','feasible','{\"valid\":true}','2026-10-16')").run();
    for (const [id,memberId,day] of [['old-a','member-20998811','2026-11-02'],['old-b','member-20998812','2026-11-03']]) await db.prepare("INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at,revision) VALUES(?,'old-version',?,?,'campus-nanhu','repair','19:00','21:00',2)").bind(id,memberId,day).run();
    await db.prepare("INSERT INTO duty_roles(id,assignment_id,role_kind) VALUES('old-role','old-a','repair_lead')").run();
    await db.prepare("INSERT INTO leave_requests(id,assignment_id,member_id,reason,status,created_at) VALUES('old-leave','old-a','member-20998811','历史申请','pending','2026-10-16')").run();
    await db.prepare("INSERT INTO swap_requests(id,from_assignment_id,to_assignment_id,from_member_id,to_member_id,from_revision,to_revision,created_at) VALUES('old-swap','old-a','old-b','member-20998811','member-20998812',2,2,'2026-10-16')").run();
    const before = await snapshot(db), migration = await statements(`${directory}/${last}`);
    await assert.rejects(db.batch([...migration.map(sql => db.prepare(sql)),db.prepare('INSERT INTO missing_roster_scope_upgrade VALUES(1)')]));
    assert.deepEqual(await snapshot(db),before,'failed migration restores the dropped parent and cascaded children');
    await db.batch(migration.map(sql => db.prepare(sql)));
    assert.deepEqual(await snapshot(db),before,'successful migration changes only the task uniqueness rule');
    for (const [id,scope,dutyType] of [['north','{"campusIds":["campus-hunnan"]}','repair'],['department','{"campusIds":["campus-nanhu"],"departmentIds":["dept-hardware"]}','repair'],['office','{"campusIds":["campus-nanhu"]}','office']]) {
      await db.prepare("INSERT INTO roster_tasks(id,week_start,campus_scope,slot_start,slot_end,deadline,created_at,duty_type) VALUES(?,'2026-11-02',?,'19:00','21:00','2026-11-01','2026-10-16',?)").bind(id,scope,dutyType).run();
    }
    await assert.rejects(db.prepare(`INSERT INTO roster_tasks(id,week_start,campus_scope,slot_start,slot_end,deadline,created_at,duty_type) VALUES('duplicate','2026-11-02','{"campusIds":["campus-nanhu"]}','19:00','21:00','2026-11-01','2026-10-16','repair')`).run());
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
    assert.deepEqual((await db.prepare("SELECT name FROM sqlite_schema WHERE name LIKE '_roster_%_backup'").all()).results,[]);
  } finally {await mf.dispose();}
});
