import { present } from '../helpers/present.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { database, seedStaff } from '../helpers/database.ts';
import { staffServices } from '../fixtures/staff-services.ts';
import { userRepository } from '../../src/db/users.ts';
for(const directory of ['migrations','database/staff-migrations'])test(`${directory}: roster cutover retains every shift and raw workflow fact, preserves pending leave and exchange`,async(t)=>{
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-11-01T12:00:00Z')});
 const db=database(directory,'0048_');try{
 seedStaff(db,'20261001');seedStaff(db,'20261002');
 db.sqlite.exec("INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES('post-one','member-20261001','dept-hardware','member','primary',1,'2026-01-01','2026-01-01'),('post-two','member-20261002','dept-hardware','member','primary',1,'2026-01-01','2026-01-01')");
 db.sqlite.exec(`INSERT INTO roster_tasks(id,week_start,campus_scope,slot_start,slot_end,deadline,created_at) VALUES('task','2026-11-02','{"campusIds":["campus-nanhu"]}','19:00','21:00','2026-11-01','2026-10-30');
 INSERT INTO roster_versions(id,task_id,status,version,rule_version,algorithm_version,published_at,created_at) VALUES('past','task','superseded',1,'1','old','2026-11-01','2026-10-30'),('live','task','published',2,'1','old','2026-11-01','2026-10-30'),('draft','task','draft',3,'1','old',NULL,'2026-11-02');
 INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at,origin_assignment_id,previous_assignment_id) VALUES
 ('old','past','member-20261001','2026-11-02','campus-nanhu','repair','19:00','21:00','old',NULL),
 ('one','live','member-20261001','2026-11-02','campus-nanhu','repair','19:00','21:00','old','old'),
 ('two','live','member-20261002','2026-11-03','campus-nanhu','repair','19:00','21:00','two',NULL),
 ('draft-one','draft','member-20261001','2026-11-04','campus-nanhu','repair','19:00','21:00','draft-one',NULL);
 INSERT INTO leave_requests(id,assignment_id,member_id,reason,status,created_at) VALUES('leave','old','member-20261001','原请假原因','pending','2026-11-01');
 INSERT INTO swap_requests(id,from_assignment_id,to_assignment_id,from_member_id,to_member_id,from_revision,to_revision,note,created_at) VALUES('swap','one','two','member-20261001','member-20261002',0,0,'互换约定','2026-11-01');
 INSERT INTO roster_submissions(task_id,member_id,submitted_at,source) VALUES('task','member-20261001','2026-11-01','manual'),('task','member-20261002','2026-11-01','carried');
 INSERT INTO availability(id,task_id,member_id,business_date,start_at,end_at,campus_id) VALUES('availability','task','member-20261001','2026-11-08','19:00','21:00','campus-nanhu');
 INSERT INTO roster_availability_preferences(member_id,duty_type,windows,source_task_id,updated_at) VALUES('member-20261002','repair','[{"weekday":1,"campusId":"campus-nanhu","startAt":"19:00","endAt":"21:00"}]','task','2026-11-01');`);
 const assignments=db.sqlite.prepare('SELECT * FROM duty_assignments ORDER BY id').all();
 db.sqlite.exec(readFileSync(`${directory}/0048_weekly_schedule.sql`,'utf8'));
 assert.deepEqual(db.sqlite.prepare('SELECT id FROM duty_assignments ORDER BY id').all().map(row=>row.id),assignments.map(row=>row.id));
 for(const original of assignments){const archived=db.sqlite.prepare("SELECT before_json FROM audit_events WHERE action='rosters.model.migrated' AND json_extract(source_ref,'$.type')='duty_assignments' AND json_extract(before_json,'$.id')=?").get(original.id);assert.deepEqual(JSON.parse(String(present(archived).before_json)),{...original});}
 assert.deepEqual(db.sqlite.prepare('SELECT id FROM duty_assignments WHERE active=1 ORDER BY id').all().map(row=>row.id),['one','two']);
 assert.equal(present(db.sqlite.prepare('SELECT assignment_id FROM roster_leaves').get()).assignment_id,'one');
 assert.equal(present(db.sqlite.prepare('SELECT exchange_assignment_id FROM roster_covers').get()).exchange_assignment_id,'two');
 const availability=db.sqlite.prepare('SELECT * FROM member_availability ORDER BY member_id').all();assert.equal(availability.length,2);assert.equal(JSON.parse(String(availability[0].windows))[0].weekday,7);assert.equal(availability[1].week_start,'');
 assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 db.sqlite.exec(`INSERT INTO audit_events(id,action,source_ref,occurred_at) VALUES('leave-audit','rosters.leave.recorded','{}','2026-11-01');
 INSERT INTO operation_receipts(actor_member_id,action,request_id,payload_hash,result_json,created_at) VALUES('member-20261001','rosters.leave.recorded','leave-request','hash','{}','2026-11-01');`);
 // Current services run against the complete schema after validating the cutover itself.
 for(const file of readdirSync(directory).filter(file=>file.endsWith('.sql') && file>'0048_weekly_schedule.sql').sort())db.sqlite.exec(readFileSync(`${directory}/${file}`,'utf8'));
 assert.equal(present(db.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_schema WHERE name='roster_leaves' OR name='idx_roster_leave_assignment'").get()).n,0);
 assert.equal(present(db.sqlite.prepare("SELECT COUNT(*) n FROM audit_events WHERE action IN ('rosters.leave.recorded','rosters.leave.withdrawn') OR (action='rosters.model.migrated' AND json_extract(source_ref,'$.type')='leave_requests')").get()).n,0);
 assert.equal(present(db.sqlite.prepare("SELECT COUNT(*) n FROM operation_receipts WHERE action IN ('rosters.leave.recorded','rosters.leave.withdrawn')").get()).n,0);
 const staff=staffServices(db,'00'.repeat(32)),two=present(await userRepository(db).find('20261002'));await staff.respondCover(two,'swap',{revision:0,decision:'accepted',requestId:request()});
 assert.equal(present(db.sqlite.prepare("SELECT member_id FROM duty_assignments WHERE id='one'").get()).member_id,two.memberId);
 assert.equal(present(db.sqlite.prepare("SELECT member_id FROM duty_assignments WHERE id='two'").get()).member_id,'member-20261001');
 }finally{db.sqlite.close();}
});

const request=()=>crypto.randomUUID();
