import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {database,seedStaff} from './helpers/database.mjs';
import {staffServices} from './fixtures/staff-services.mjs';
import {userRepository} from '../src/db/users.js';
import {weeklyAttendanceRows} from '../src/modules/attendance/weekly-export.js';

function post(db,account,department,position='member'){
 db.sqlite.prepare("INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES(?,?,?,?,'primary',1,'2026-01-01','2026-01-01')").run('post-'+account,'member-'+account,department,position);
}
function setup(){
 const db=database();for(const id of ['20261001','20261002','20261003','20261004','20261005'])seedStaff(db,id);
 seedStaff(db,'20261006','浑南');post(db,'20261001','dept-network','head');post(db,'20261002','unit-network','director');post(db,'20261003','unit-center','president');post(db,'20261004','dept-office');
 post(db,'20261005','dept-hardware');post(db,'20261006','dept-art');
 return {db,users:userRepository(db),staff:staffServices(db,'00'.repeat(32))};
}
test('ministers manage every department in their campus; directors and presidents manage all campuses without gaining system configuration',async()=>{
 const {db,users,staff}=setup();
 try{
  const head=await users.find('20261001'),director=await users.find('20261002'),president=await users.find('20261003');
  assert.deepEqual(director.authorizedCampuses.sort(),['南湖','浑南'].sort());
  const ctx=await staff.contextFor(head);
  for(const permission of ['members.manage','roster.repair.manage','roster.office.manage','attendance.correct','attendance.session.manage']){
   assert.equal(staff.evaluate(ctx,permission,{campusId:'campus-nanhu',departmentId:'dept-office'}).allowed,true);
   assert.equal(staff.evaluate(ctx,permission,{campusId:'campus-hunnan',departmentId:'dept-network'}).allowed,false);
   assert.equal(staff.evaluate(await staff.contextFor(director),permission,{campusId:'campus-hunnan'}).allowed,true);
   assert.equal(staff.evaluate(await staff.contextFor(president),permission,{campusId:'campus-hunnan'}).allowed,true);
  }
  for(const permission of ['roles.manage','settings.manage','accounts.manage'])assert.ok(!ctx.permissions[permission]);
  const office=await staff.memberDetail(head,'member-20261004');
  await staff.updateMember(head,'member-20261004',{revision:office.member.revision,name:'办公室成员新姓名'});
  await assert.rejects(staff.memberDetail(head,'member-20261006'),{status:403});
  const other=await staff.memberDetail(director,'member-20261006');
  await staff.updateMember(director,'member-20261006',{revision:other.member.revision,college:'软件学院'});
  db.sqlite.exec("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,protected) VALUES('root001','系统管理员','superadmin','南湖','test','2026-01-01',1)");
  await assert.rejects(staff.updateMember(director,'member-root001',{revision:0,name:'不可改'}),{status:403});
  // A grant cannot manufacture leadership or a repair qualification.
  assert.ok(db.sqlite.prepare("SELECT code FROM roles WHERE code IN ('technician','repair_lead','office_lead','exchange','office')").all().length===0);
  assert.equal((await staff.contextFor(await users.find('20261004'))).permissions['repair.start'],true);
 }finally{db.sqlite.close();}
});

test('correction uses the same campus scope and stores actual recording time separately from arrival',async()=>{
 const {db,users,staff}=setup();
 try{
  const head=await users.find('20261001'),director=await users.find('20261002');
  const event=await staff.createAttendanceEvent(head,{campusId:'campus-nanhu',businessDate:'2026-11-02',requestId:crypto.randomUUID()});
  const record=await staff.correctAttendance(head,{memberId:'member-20261004',eventId:event.id,occurredAt:'2026-11-02T11:00:00.000Z',reason:'已核实现场到岗，补记漏签',requestId:crypto.randomUUID()});
  assert.ok(record);
  const stored=db.sqlite.prepare('SELECT occurred_at,recorded_at FROM attendance_records').get();
  assert.equal(stored.occurred_at,'2026-11-02T11:00:00.000Z');assert.ok(stored.recorded_at>stored.occurred_at);
  const elsewhere=await staff.createAttendanceEvent(director,{campusId:'campus-hunnan',businessDate:'2026-11-02',requestId:crypto.randomUUID()});
  const input={memberId:'member-20261006',eventId:elsewhere.id,occurredAt:'2026-11-02T11:00:00.000Z',reason:'核实到岗后补记',requestId:crypto.randomUUID()};
  await assert.rejects(staff.correctAttendance(head,input),{status:403});
  await staff.correctAttendance(director,input);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get().n,2);
 }finally{db.sqlite.close();}
});

test('weekly counting remains actual / first-only / leader-once using real posts, without inventing attendance',()=>{
 const base={week:'2026-11-02',paused:[],canExport:()=>true,facts:[{memberId:'leader',name:'负责人',campuses:['南湖'],memberships:[{isPrimary:true,departmentCode:'network',departmentName:'网络部',positionCode:'head',effectiveFrom:'2026-01-01'}]}],records:[1,2].map(i=>({memberId:'worker',memberName:'维修员',campusId:'campus-nanhu',businessDate:`2026-11-0${i+1}`,identitySnapshot:{},id:String(i)}))};
 assert.equal(weeklyAttendanceRows(base)[0].creditedCount,2);
 assert.equal(weeklyAttendanceRows({...base,firstOnly:true})[0].creditedCount,1);
 const leader=weeklyAttendanceRows({...base,leadersOnce:true}).find(row=>row.memberId==='leader');
 assert.equal(leader.creditedCount,1);assert.equal(leader.actualCount,0);
});
for(const directory of ['migrations','database/staff-migrations'])test(`${directory}: membership cutover preserves personnel and archives all retired grants`,()=>{
 const db=database(directory,'0047_');
 try{
  seedStaff(db,'20261001');post(db,'20261001','dept-network','head');
  db.sqlite.exec("INSERT INTO member_roles(id,member_id,role_id,effective_from,reason) VALUES('old-qualification','member-20261001','role-technician','2026-01-01','historical authorization')");
  const before=db.sqlite.prepare('SELECT * FROM member_department_memberships').all();
  db.sqlite.exec(readFileSync(`${directory}/0047_membership_identity.sql`,'utf8'));
  assert.deepEqual(db.sqlite.prepare('SELECT * FROM member_department_memberships').all(),before);
  const archived=db.sqlite.prepare("SELECT before_json FROM audit_events WHERE id='v12-identity-member_roles-old-qualification'").get();
  assert.equal(JSON.parse(archived.before_json).reason,'historical authorization');
  assert.equal(db.sqlite.prepare("SELECT name FROM sqlite_master WHERE name='effective_member_roles'").get(),undefined);
  assert.deepEqual(db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{db.sqlite.close();}
});
