import type { PolicyActor, PolicyResource } from '../src/modules/authorization/types.ts';
import type { Membership } from '../shared/staff-types.ts';
import { present } from './helpers/present.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';

import { database, seedStaff } from './helpers/database.ts';
import {staffServices} from './fixtures/staff-services.ts';
import {userRepository} from '../src/db/users.ts';
import {weeklyAttendanceRows} from '../src/modules/attendance/weekly-export.ts';
import {createAuthorizer} from '../src/modules/authorization/public.ts';

function post(db: import('./helpers/database.ts').TestDatabase,account: string,department: string,position='member'){
 db.sqlite.prepare("INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,created_at) VALUES(?,?,?,?,'primary',1,'2026-01-01','2026-01-01')").run('post-'+account,'member-'+account,department,position);
}
function setup(){
 const db=database();for(const id of ['20261001','20261002','20261003','20261004','20261005'])seedStaff(db,id);
 seedStaff(db,'20261006','浑南');post(db,'20261001','dept-network','head');post(db,'20261002','unit-network','director');post(db,'20261003','unit-center','president');post(db,'20261004','dept-office');
 post(db,'20261005','dept-hardware');post(db,'20261006','dept-art');
 return {db,users:userRepository(db),staff:staffServices(db,'00'.repeat(32))};
}
test('early supplementation explains its default time and retains the time guards',async(context)=>{
 context.mock.timers.enable({apis:['Date'],now:new Date('2026-11-11T02:00:00.000Z')});
 const {db,users,staff}=setup();
 try{
  const head=present(await users.find('20261001'));
  const input={memberId:'member-20261004',campusId:'campus-nanhu',businessDate:'2026-11-11',occurredAt:'2026-11-11T11:00:00.000Z',reason:'核实补录',requestId:crypto.randomUUID()};
  await assert.rejects(staff.correctAttendance(head,input),{status:400,message:'补录默认记为当天 19:00，目前尚未到该时间，请在 19:00 后补录'});
  await assert.rejects(staff.correctAttendance(head,{...input,occurredAt:'2026-11-11T01:00:00.000Z'}),{status:400,message:'补录时间不在当天允许的签到时段内'});
  assert.equal(present(db.sqlite.prepare('SELECT count(*) n FROM attendance_records').get()).n,0);
  context.mock.timers.tick(10*60*60*1000);
  await staff.correctAttendance(head,input);
  assert.equal(present(db.sqlite.prepare('SELECT occurred_at FROM attendance_records').get()).occurred_at,input.occurredAt);
 }finally{db.sqlite.close();}
});
test('ministers manage every department in their campus; directors and presidents manage all campuses without gaining system configuration',async()=>{
 const {db,users,staff}=setup();
 try{
  const head=present(await users.find('20261001')),director=present(await users.find('20261002')),president=present(await users.find('20261003'));
  assert.deepEqual(director.authorizedCampuses.sort(),['南湖','浑南'].sort());
  const ctx=await staff.contextFor(head);
  for(const permission of ['members.manage','accounts.manage','booking.manage','roster.manage','attendance.correct','attendance.session.manage']){
   assert.equal(staff.evaluate(ctx,permission,{campusId:'campus-nanhu',departmentId:'dept-office'}).allowed,true);
   assert.equal(staff.evaluate(ctx,permission,{campusId:'campus-hunnan',departmentId:'dept-network'}).allowed,false);
   assert.equal(staff.evaluate(await staff.contextFor(director),permission,{campusId:'campus-hunnan'}).allowed,true);
   assert.equal(staff.evaluate(await staff.contextFor(president),permission,{campusId:'campus-hunnan'}).allowed,true);
  }
  for(const permission of ['roles.manage','settings.manage'])assert.ok(!ctx.permissions[permission]);
  const office=await staff.memberDetail(head,'member-20261004');
  await staff.updateMember(head,'member-20261004',{revision:office.member.revision,name:'办公室成员新姓名'});
  await assert.rejects(staff.memberDetail(head,'member-20261006'),{status:403});
  const other=await staff.memberDetail(director,'member-20261006');
  await staff.updateMember(director,'member-20261006',{revision:other.member.revision,college:'软件学院'});
  db.sqlite.exec("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,protected) VALUES('root001','系统管理员','superadmin','南湖','test','2026-01-01',1)");
  await assert.rejects(staff.updateMember(director,'member-root001',{revision:0,name:'不可改'}),{status:403});
  // A grant cannot manufacture leadership or a repair qualification.
  assert.ok(db.sqlite.prepare("SELECT code FROM roles WHERE code IN ('technician','repair_lead','office_lead','exchange','office')").all().length===0);
 }finally{db.sqlite.close();}
});

test('booking management follows active leadership and intersects its campus scope with account access',()=>{
 const authorizer=createAuthorizer();
 const actor: PolicyActor={memberId:'leader',status:'enabled',role:'technician',homeCampus:'南湖',authorizedCampuses:['南湖','浑南']};
 const post: Membership={assignmentType:'primary',isPrimary:true,positionCode:'deputy_head',effectiveFrom:'2026-11-01',effectiveTo:'2026-12-01'};
 const context={authorizationDate:'2026-11-10',memberships:[post]};
 const grants=['settings.manage','booking.manage'].map(permissionCode=>({permissionCode,scope:{all:true}}));
 const allowed=(user: PolicyActor,posts: Membership[],target: PolicyResource={})=>authorizer.evaluate(user,'booking.manage',target,{...context,memberships:posts},grants).allowed;
 for(const positionCode of ['member','deputy_head','head','deputy_director','director','vice_president','president'] as const){
  const posts=[{...post,positionCode}];
  assert.equal(allowed(actor,posts,{campusId:'campus-nanhu'}),positionCode!=='member',positionCode);
  assert.equal(allowed(actor,posts,{campusId:'campus-hunnan'}),!['member','deputy_head','head'].includes(positionCode),positionCode);
  assert.equal(allowed({...actor,authorizedCampuses:['南湖']},posts,{campusId:'campus-hunnan'}),false,positionCode);
 }
 assert.equal(allowed({...actor,homeCampus:'浑南'},[post],{campusId:'campus-hunnan'}),true);
 assert.equal(allowed({...actor,homeCampus:'浑南'},[post],{campusId:'campus-nanhu'}),false);
 assert.equal(allowed({...actor,authorizedCampuses:['浑南']},[post]),false);
 const superadmin: PolicyActor={...actor,role:'superadmin'};
 assert.equal(allowed(superadmin,[],{campusIds:['campus-nanhu','campus-hunnan']}),true);
 assert.equal(allowed({...superadmin,authorizedCampuses:['南湖']},[],{campusId:'浑南'}),false);
 assert.equal(allowed({...superadmin,status:'disabled'},[]),false);
 assert.equal(allowed({...superadmin,memberStatus:'inactive'},[]),false);
 for(const change of [{effectiveFrom:'2026-11-11'},{effectiveTo:'2026-11-10'},{enabled:false},{isPrimary:false}])
  assert.equal(allowed(actor,[{...post,...change}]),false);
 assert.equal(allowed(actor,[]),false);
});

test('correction uses the same campus scope and stores actual recording time separately from arrival',async()=>{
 const {db,users,staff}=setup();
 try{
  const head=present(await users.find('20261001')),director=present(await users.find('20261002'));
  const event=await staff.createAttendanceEvent(head,{campusId:'campus-nanhu',businessDate:'2026-11-02',requestId:crypto.randomUUID()});
  const record=await staff.correctAttendance(head,{memberId:'member-20261004',eventId:event.id,occurredAt:'2026-11-02T11:00:00.000Z',reason:'已核实现场到岗，补记漏签',requestId:crypto.randomUUID()});
  assert.ok(record);
  const stored=db.sqlite.prepare('SELECT occurred_at,recorded_at FROM attendance_records').get();
  assert.equal(present(stored).occurred_at,'2026-11-02T11:00:00.000Z');assert.ok(String(present(stored).recorded_at)>String(present(stored).occurred_at));
  const elsewhere=await staff.createAttendanceEvent(director,{campusId:'campus-hunnan',businessDate:'2026-11-02',requestId:crypto.randomUUID()});
  const input={memberId:'member-20261006',eventId:elsewhere.id,occurredAt:'2026-11-02T11:00:00.000Z',reason:'核实到岗后补记',requestId:crypto.randomUUID()};
  await assert.rejects(staff.correctAttendance(head,input),{status:403});
  await staff.correctAttendance(director,input);
  assert.equal(present(db.sqlite.prepare('SELECT COUNT(*) n FROM attendance_records').get()).n,2);
 }finally{db.sqlite.close();}
});

test('weekly counting remains actual / first-only / leader-once using real posts, without inventing attendance',()=>{
 const base: Parameters<typeof weeklyAttendanceRows>[0]={week:'2026-11-02',paused:[],homeCampuses:new Map([['leader','campus-nanhu'],['worker','campus-nanhu']]),canExport:()=>true,facts:[{memberId:'leader',name:'负责人',campuses:['南湖','浑南'],memberships:[{assignmentType:'primary',isPrimary:true,departmentCode:'network',departmentName:'网络部',positionCode:'head',effectiveFrom:'2026-01-01'}]}],records:[1,2].map(i=>({memberId:'worker',memberName:'维修员',campusId:i===1?'campus-nanhu':'campus-hunnan',businessDate:`2026-11-0${i+1}`,identitySnapshot:{},id:String(i)}))};
 assert.equal(weeklyAttendanceRows(base)[0].creditedCount,2);
 assert.equal(weeklyAttendanceRows({...base,firstOnly:true})[0].creditedCount,1);
 const leader=weeklyAttendanceRows({...base,leadersOnce:true}).find(row=>row.memberId==='leader');
 assert.equal(present(leader).creditedCount,1);assert.equal(present(leader).actualCount,0);
 assert.equal(present(leader).campuses, '南湖');
 assert.deepEqual(weeklyAttendanceRows({...base, canExport: target => target.campusId === 'campus-hunnan'}), []);
});
