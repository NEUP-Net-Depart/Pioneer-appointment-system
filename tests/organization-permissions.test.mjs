import { test } from 'node:test';
import { stageFixture } from './fixtures/staff-cutover.mjs';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, readdir } from 'node:fs/promises';
import { staffPlatformRepository } from '../src/db/staff-platform.js';
import { userRepository } from '../src/db/users.js';
import { composeStaffPlatform } from '../src/app/compose.js';
import { staffPlatformService } from '../src/services/staff-platform.js';
import { authService } from '../src/services/auth.js';
import { hashPassword } from '../src/lib/passwords.js';
import { repairRosterPool } from '../src/modules/rosters/qualification.js';
import { dateKey, addDays } from '../shared/time.js';

function adapter(sqlite) {
  return { prepare(sql) {
    const query = sqlite.prepare(sql);
    const statement = args => ({ bind: (...values) => statement(values), first: async () => query.get(...args) || null,
      all: async () => ({ results: query.all(...args) }), run: async () => ({ meta: { changes: Number(query.run(...args).changes) } }) });
    return statement([]);
  }, async batch(statements) {
    sqlite.exec('BEGIN');
    try { const result = []; for (const statement of statements) { const value = await statement.all(); value.meta = { changes: Number(sqlite.prepare('SELECT changes() AS n').get().n) }; result.push(value); } sqlite.exec('COMMIT'); return result; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  } };
}
async function setup(directory = 'migrations', before = '') {
  const sqlite = new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
  for (const file of (await readdir(directory)).filter(file => file.endsWith('.sql') && (!before || file < before)).sort()) sqlite.exec(await readFile(`${directory}/${file}`, 'utf8'));
  const db = adapter(sqlite), repository = staffPlatformRepository(db), users = userRepository(db);
  const platform = composeStaffPlatform({ repository }), staff = staffPlatformService({ repository, platform, manifests: platform.manifests });
  const today = dateKey(), password = 'test-organization-password';
  const account = (id, campuses = ['南湖'], root = false) => {
    sqlite.prepare(`INSERT INTO staff_accounts(account,name,role,protected,home_campus,password_hash,created_at) VALUES(?,?,?,?,'南湖',?,?)`)
      .run(id,id,root ? 'superadmin' : 'technician',root ? 1 : 0,hashPassword(password),'2026-01-01');
    for (const campus of campuses) sqlite.prepare('INSERT INTO staff_campus_grants VALUES(?,?)').run(id,campus);
    return 'member-'+id;
  };
  const post = (id, department = 'dept-hardware', position = 'member', type = 'primary', from = '2026-01-01', to = null) => {
    const key = crypto.randomUUID();
    sqlite.prepare(`INSERT INTO member_department_memberships(id,member_id,department_id,position_code,assignment_type,is_primary,effective_from,effective_to,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(key,'member-'+id,department,position,type,type === 'primary' ? 1 : 0,from,to,from);
    return key;
  };
  const context = async id => staff.contextFor(await users.find(id));
  const can = (ctx, code, campus = 'campus-nanhu') => platform.authorizer.evaluate(ctx.actor,code,{campusId:campus,memberId:ctx.actor.memberId},ctx,ctx.grants).allowed;
  return { sqlite, db, repository, platform, staff, users, today, password, account, post, context, can };
}

test('real organization positions and exchange participation derive existing templates without stored ordinary roles', async () => {
  const f = await setup();
  try {
    for (const [id, unit, position, repair, manage] of [
      ['20269001','dept-hardware','member',true,false],['20269002','dept-hardware','deputy_head',true,true],['20269003','dept-hardware','head',true,true],
      ['20269004','unit-device','deputy_director',false,true],['20269005','unit-device','director',false,true],['20269006','unit-center','president',false,true],['20269013','unit-center','vice_president',false,true],
      ['20269007','dept-network','head',false,false],['20269008','unit-network','director',false,false],['20269009','dept-art','member',false,false],['20269010','dept-publicity','member',false,false],['20269011','dept-office','member',false,false]
    ]) {
      f.account(id); f.post(id,unit,position);
      const ctx = await f.context(id);
      assert.equal(f.can(ctx,'repair.start'),repair,id);
      assert.equal(f.can(ctx,'repair.transfer'),manage,id);
      assert.equal(f.can(ctx,'audit.read'),false,id);
      assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM member_roles WHERE member_id=?').get('member-'+id).n,0);
    }
    const id='20269012'; f.account(id); f.post(id,'dept-network'); f.post(id,'dept-hardware','member','exchange');
    const ctx = await f.context(id);
    assert.equal(f.can(ctx,'repair.start'),true); assert.equal(f.can(ctx,'repair.transfer'),false);
    const fact = (await f.repository.rosterMemberFacts(['member-'+id],f.today))[0];
    assert.equal(repairRosterPool(fact,f.platform.authorizer,f.today,{campusId:'campus-nanhu'}),'');
    assert.equal(f.can(ctx,'roster.read'),false);
    assert.equal(ctx.memberships.filter(item => item.isPrimary).length,1);
  } finally { f.sqlite.close(); }
});

test('promotion preserves history, enforces one primary post, and revokes old sessions at organization and campus changes', async () => {
  const f=await setup();
  try {
    f.account('root001',['南湖','浑南'],true);f.account('20269021');const old=f.post('20269021');
    const auth=authService(f.users,'organization-secret'), login=await auth.login({account:'20269021',password:f.password});
    const root=await f.users.find('root001'), member=await f.repository.memberRow('member-20269021');
    await assert.rejects(f.staff.addMembership(root,member.id,{departmentId:'dept-network',positionCode:'head',assignmentType:'primary',effectiveFrom:f.today,revision:member.revision}),error=>error.status===409);
    await f.staff.addMembership(root,member.id,{departmentId:'dept-hardware',positionCode:'head',assignmentType:'primary',effectiveFrom:f.today,replacesMembershipId:old,revision:member.revision});
    const history=await f.repository.listMemberships(member.id);assert.equal(history.length,2);assert.equal(history.find(item=>item.id===old).effectiveTo,f.today);
    assert.equal(f.can(await f.context('20269021'),'repair.transfer'),true);
    await assert.rejects(auth.authenticate('Bearer '+login.token),error=>error.status===401);
    const current=await auth.login({account:'20269021',password:f.password});
    f.sqlite.prepare("DELETE FROM staff_campus_grants WHERE account='20269021'").run();
    await assert.rejects(auth.authenticate('Bearer '+current.token),error=>error.status===401);
    const ctx=await f.context('20269021');assert.equal(f.can(ctx,'repair.start'),false);assert.equal(f.can(ctx,'repair.summary.read'),false);
  } finally { f.sqlite.close(); }
});

test('special retention is scoped and dated; historical dates cannot recover revoked management', async () => {
  const f=await setup();
  try {
    f.account('root001',['南湖','浑南'],true);f.account('20269031',['南湖','浑南']);f.post('20269031','dept-hardware','head','primary','2026-01-01',f.today);
    let ctx=await f.context('20269031');assert.equal(f.can(ctx,'repair.transfer'),false);
    const member=await f.repository.memberRow(ctx.actor.memberId),root=await f.users.find('root001');
    await f.staff.bindMemberRoles(root,member.id,{revision:member.revision,bindings:[{roleId:'role-repair-lead',scope:{campusIds:['campus-nanhu']},effectiveFrom:f.today,effectiveTo:addDays(f.today,1),reason:'离任留任'}]});
    ctx=await f.context('20269031');assert.equal(f.can(ctx,'repair.transfer'),true);assert.equal(f.can(ctx,'repair.start'),false);assert.equal(f.can(ctx,'repair.transfer','campus-hunnan'),false);
    const expired={...ctx,authorizationDate:addDays(f.today,1)};assert.equal(f.can(expired,'repair.transfer'),false);
    const binding=(await f.repository.roleBindings(member.id))[0];f.sqlite.prepare('UPDATE member_roles SET effective_from=?,effective_to=? WHERE id=?').run(addDays(f.today,-1),f.today,binding.id);
    const historic=await f.staff.contextFor(await f.users.find('20269031'),addDays(f.today,-1));assert.equal(f.can(historic,'repair.transfer'),false);
  } finally { f.sqlite.close(); }
});

test('scope.all and split grants cannot cross account campuses, and campus-local role changes preserve other campuses', async () => {
  const f=await setup();
  try {
    f.account('root001',['南湖'],true); const rootCtx=await f.context('root001');
    assert.equal(f.can(rootCtx,'repair.transfer','campus-hunnan'),false);
    assert.equal(f.platform.authorizer.evaluate(rootCtx.actor,'settings.manage',{},rootCtx,rootCtx.grants).allowed,true);
    f.account('20269041',['南湖','浑南']);
    f.sqlite.prepare(`INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from,reason) VALUES('other-campus','member-20269041','role-repair-lead','{"campusIds":["campus-hunnan"]}','2026-01-01','另一校区留任')`).run();
    f.sqlite.prepare("UPDATE member_roles SET revision=3 WHERE id='other-campus'").run();
    const hiddenBefore=f.sqlite.prepare("SELECT * FROM member_roles WHERE id='other-campus'").get();
    f.account('20269042');f.post('20269042','dept-hardware','head');
    const local=await f.users.find('20269042'),target=await f.repository.memberRow('member-20269041');
    await assert.rejects(f.staff.bindMemberRoles(await f.users.find('root001'),target.id,{revision:target.revision,bindings:[{roleId:'role-technician',scope:{campusIds:['campus-hunnan']},effectiveFrom:f.today,reason:'越权留任'}]}),error=>error.status===403);
    const saved=await f.staff.bindMemberRoles(local,target.id,{revision:target.revision,bindings:[{roleId:'role-technician',scope:{campusIds:['campus-nanhu']},effectiveFrom:f.today,reason:'本校区留任'}]});
    assert.deepEqual(f.sqlite.prepare("SELECT * FROM member_roles WHERE id='other-campus'").get(),hiddenBefore);
    assert.equal(saved.bindings.some(binding=>binding.id==='other-campus'),false);
    assert.equal((await f.repository.roleBindings(target.id)).length,2);
    const detail=await f.staff.memberDetail(local,target.id);
    assert.equal(detail.actions.readAudit,false);
    assert.equal(detail.bindings.some(binding=>binding.id==='other-campus'),false);
    await assert.rejects(f.staff.memberAudit(local,target.id),error=>error.status===403);
    const shared=(await f.repository.listRoles()).find(role=>role.id==='role-repair-lead');
    const root=await f.users.find('root001');
    await assert.rejects(f.staff.updateRole(root,shared.id,{revision:shared.revision,name:shared.name}),error=>error.status===403);
    f.account('20269044',['南湖','浑南']);
    const scoped=await f.staff.createRole(root,{code:'local_personnel',name:'本校区人员管理',grants:['members.manage','roles.manage'].map(permissionCode=>({permissionCode,scope:{campusIds:['campus-nanhu']}}))});
    const scopedMember=await f.repository.memberRow('member-20269044');
    await f.staff.bindMemberRoles(root,scopedMember.id,{revision:scopedMember.revision,bindings:[{roleId:scoped.id,scope:{campusIds:['campus-nanhu']},effectiveFrom:f.today,reason:'仅管理南湖人员授权'}]});
    const scopedDetail=await f.staff.memberDetail(await f.users.find('20269044'),target.id);
    assert.equal(scopedDetail.bindings.some(binding=>binding.id==='other-campus'),false,'account campuses never widen a scoped management grant');
    const localContext=await f.context('20269042');
    assert.equal(f.platform.authorizer.evaluate(localContext.actor,'repair.transfer',{campusIds:['campus-nanhu','campus-hunnan']},localContext,localContext.grants).allowed,false);
    await assert.rejects(f.staff.updateMember(local,target.id,{revision:(await f.repository.memberRow(target.id)).revision,status:'inactive'}),error=>error.status===403);
    await assert.rejects(f.staff.bindMemberRoles(local,target.id,{revision:(await f.repository.memberRow(target.id)).revision,bindings:[{id:'other-campus',roleId:'role-technician',scope:{campusIds:['campus-hunnan']},effectiveFrom:f.today,reason:'越权'}]}),error=>error.status===403);
  } finally { f.sqlite.close(); }
});

test('home campus never supplies business authorization and automatic roles remain read-only', async () => {
  const f=await setup();
  try {
    f.account('root001',['南湖','浑南'],true);f.account('20269043');f.post('20269043');
    f.sqlite.prepare("UPDATE staff_accounts SET home_campus='浑南' WHERE account='20269043'").run();
    f.sqlite.prepare("UPDATE members SET home_campus_id='campus-hunnan' WHERE id='member-20269043'").run();
    const ctx=await f.context('20269043');assert.equal(f.can(ctx,'repair.start'),true);assert.equal(f.can(ctx,'repair.start','campus-hunnan'),false);
    const root=await f.users.find('root001'),detail=await f.staff.memberDetail(root,ctx.actor.memberId);
    assert.deepEqual(detail.automaticRoleIds,['role-technician']);assert.equal(detail.bindings.length,0);
    await assert.rejects(f.staff.bindMemberRoles(root,ctx.actor.memberId,{revision:detail.member.revision,bindings:[{roleId:'role-technician',scope:{campusIds:['campus-nanhu']},effectiveFrom:f.today,effectiveTo:addDays(f.today,1),reason:'重复维修授权'}]}),error=>error.status===400);
  } finally { f.sqlite.close(); }
});

test('single creation and import share compact facts, skip exact repeats and surface real conflicts', async () => {
  const f=await setup();
  try {
    f.account('root001',['南湖','浑南'],true);const actor=await f.users.find('root001');
    const fields={studentId:'20269051',name:'交流成员',homeCampusId:'campus-hunnan',departmentId:'dept-network',positionCode:'member',exchangeParticipation:true,authorizedCampuses:['campus-nanhu'],configureActivation:true};
    const created=await f.staff.createMember(actor,fields);assert.equal((await f.repository.listMemberships(created.member.memberId)).length,2);
    assert.equal(await f.users.find(fields.studentId),null);assert.equal((await f.repository.roleBindings(created.member.memberId)).length,0);
    const csv=Object.keys(fields).join(',')+'\n'+Object.values(fields).map(value=>Array.isArray(value)?value.join('|'):String(value)).join(',');
    const preview=await f.staff.importMembers(actor,{csv});assert.equal(preview.summary.skipped,1);
    const conflict=await f.staff.importMembers(actor,{csv:csv.replace('dept-network','dept-art')});assert.equal(conflict.summary.conflict,1);
    await assert.rejects(f.staff.importMembers(actor,{csv,confirm:true,previewToken:conflict.previewToken}),error=>error.status===409);
    const result=await f.staff.importMembers(actor,{csv,confirm:true,previewToken:preview.previewToken});assert.equal(result.count,0);
    await assert.rejects(f.staff.createMember(actor,{...fields,studentId:'20269052',roleCodes:['superadmin']}),error=>error.status===400);
  } finally { f.sqlite.close(); }
});

for (const directory of ['migrations','database/staff-migrations']) test(`${directory}: one-time upgrade archives uncertain posts and narrows work grants to real qualification intervals`,async()=>{
  const f=await setup(directory,'0042');
  try {
    f.account('20269061');
    f.sqlite.prepare("UPDATE member_work_profiles SET effective_to=? WHERE member_id='member-20269061'").run(f.today);
    const accounts=f.sqlite.prepare('SELECT account,password_hash,member_id FROM staff_accounts').all();
    const campuses=f.sqlite.prepare('SELECT * FROM staff_campus_grants').all();
    await stageFixture(f.sqlite,{},directory);
    f.sqlite.exec(await readFile(`${directory}/0042_organization_permissions.sql`,'utf8'));
    assert.deepEqual(f.sqlite.prepare('SELECT account,password_hash,member_id FROM staff_accounts').all(),accounts);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM staff_campus_grants').all(),campuses);
    assert.equal(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='member_work_profiles'").get(),undefined);
    assert.ok(f.sqlite.prepare("SELECT id FROM audit_events WHERE action='identity.qualification.archived'").get());
    assert.deepEqual(await f.repository.listMemberships('member-20269061'),[]);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM audit_events WHERE action='organization.membership.archived'").get().n,1);
    assert.equal(f.can(await f.context('20269061'),'repair.start'),false);
    f.sqlite.prepare("DELETE FROM staff_accounts WHERE account='20269061'").run();
    f.sqlite.prepare("DELETE FROM member_roles WHERE member_id='member-20269061'").run();
    f.account('20269061');assert.equal((await f.repository.grants('member-20269061')).length,0,'recreated login never restores revoked authorization');
    assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { f.sqlite.close(); }
});

for (const directory of ['migrations','database/staff-migrations']) test(`${directory}: old defaults never survive as managers, imports are idempotent, and ending a confirmed post revokes management`,async()=>{
  const f=await setup(directory,'0042');
  try {
    f.account('root001',['南湖','浑南'],true);f.account('20269071',['南湖','浑南']);
    f.sqlite.exec(`UPDATE staff_accounts SET role='admin' WHERE account='20269071';
      INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from)
      VALUES('business-lead-20269071','member-20269071','role-repair-lead','{"campusIds":["campus-nanhu"]}','2026-01-01');`);
    const oldBindings=f.sqlite.prepare("SELECT * FROM member_roles WHERE member_id='member-20269071'").all();
    const login=await authService(f.users,'cutover-secret').login({account:'20269071',password:f.password});
    await stageFixture(f.sqlite,{'member-20269071':{decision:'migrate',authorizations:[{roleCode:'technician',scope:{campusIds:['campus-nanhu','campus-hunnan']},effectiveFrom:'2026-01-01',effectiveTo:null,reason:'已核对继续维修，保留原资格有效期'}]}},directory);
    f.sqlite.exec(await readFile(`${directory}/0042_organization_permissions.sql`,'utf8'));
    const root=await f.users.find('root001');
    assert.equal(f.can(await f.context('20269071'),'roles.manage'),false);
    await assert.rejects(authService(f.users,'cutover-secret').authenticate('Bearer '+login.token),error=>error.status===401);
    const archived=f.sqlite.prepare("SELECT before_json FROM audit_events WHERE action='authorization.binding.archived' AND json_extract(source_ref,'$.id')='member-20269071'").all().map(row=>JSON.parse(row.before_json));
    assert.deepEqual(archived.map(row=>row.id).sort(),oldBindings.map(row=>row.id).sort());
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM member_roles WHERE role_id='role-repair-lead'").get().n,0);
    const csv='studentId,name,homeCampusId,departmentId,positionCode,effectiveFrom\n20269071,20269071,campus-nanhu,dept-hardware,head,2026-01-01';
    const preview=await f.staff.importMembers(root,{csv});assert.equal(preview.summary.conflict,0);assert.equal(preview.summary.updated,1);
    await f.staff.importMembers(root,{csv,confirm:true,previewToken:preview.previewToken});
    assert.equal(f.can(await f.context('20269071'),'roles.manage'),true);
    const repeated=await f.staff.importMembers(root,{csv});assert.equal(repeated.summary.skipped,1);
    assert.equal((await f.staff.importMembers(root,{csv,confirm:true,previewToken:repeated.previewToken})).count,0);
    const [post]=await f.repository.listMemberships('member-20269071');
    await f.staff.endMembership(root,'member-20269071',post.id,{revision:post.revision,effectiveTo:f.today});
    for(const campus of ['campus-nanhu','campus-hunnan'])assert.equal(f.can(await f.context('20269071'),'roles.manage',campus),false);
    assert.equal(f.can(await f.context('20269071'),'repair.start'),true,'dated work authorization remains independent of a manager post');
    const member=await f.repository.memberRow('member-20269071');
    await f.staff.bindMemberRoles(root,member.id,{revision:member.revision,bindings:[...await f.repository.roleBindings(member.id),{roleId:'role-repair-lead',scope:{campusIds:['campus-nanhu']},effectiveFrom:f.today,reason:'已确认离任后继续负责南湖维修管理'}]});
    assert.equal(f.can(await f.context('20269071'),'roles.manage'),true);
    assert.equal(f.can(await f.context('20269071'),'roles.manage','campus-hunnan'),false);
    for(const table of ['member_department_memberships','member_roles','effective_member_roles']) {
      const columns=f.sqlite.prepare(`PRAGMA table_info(${table})`).all().map(row=>row.name);
      assert.equal(columns.some(name=>['needs_review','participation_spec'].includes(name)),false);
    }
    assert.equal(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name LIKE '_organization_%'").all().length,0);
    assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.sqlite.close();}
});

for (const directory of ['migrations','database/staff-migrations']) test(`${directory}: disjoint work periods, fixed scopes and exchange relations cannot widen authorization`,async()=>{
  const f=await setup(directory,'0042');
  try {
    for(const id of ['20269081','20269082','20269083','20269084','20269085'])f.account(id,['南湖','浑南']);
    f.sqlite.exec(`DELETE FROM member_work_profiles WHERE member_id='member-20269081';
      UPDATE member_roles SET scope_bindings='{"campusIds":["campus-nanhu"],"departmentIds":["dept-hardware"]}',effective_from='2026-01-01',effective_to='2098-01-01' WHERE member_id='member-20269081';
      INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from,effective_to) VALUES
      ('old-period','member-20269081','repair','2025-12-01','2026-02-01'),
      ('later-period','member-20269081','repair','2026-03-01','2099-01-01');
      UPDATE member_roles SET role_id='role-exchange' WHERE member_id IN ('member-20269082','member-20269083');
      UPDATE member_work_profiles SET profile_code='exchange' WHERE member_id IN ('member-20269082','member-20269083');
      UPDATE member_roles SET scope_bindings='{"campusIds":["campus-hunnan"]}' WHERE member_id='member-20269083';
      DELETE FROM member_work_profiles WHERE member_id='member-20269084';
      INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from) VALUES('unconfirmed-manager','member-20269085','role-repair-lead','{"all":true}','2026-01-01');`);
    await stageFixture(f.sqlite,{
      'member-20269081':{decision:'migrate',authorizations:[['2026-01-01','2026-02-01'],['2026-03-01','2098-01-01']].map(([effectiveFrom,effectiveTo])=>({roleCode:'technician',scope:{campusIds:['campus-nanhu'],departmentIds:['dept-hardware']},effectiveFrom,effectiveTo,reason:'核对原工作授权及资格交集'}))},
      'member-20269082':{decision:'migrate',exchange:{effectiveFrom:'2026-01-01',effectiveTo:null}},
      'member-20269083':{decision:'migrate',authorizations:[{roleCode:'exchange',scope:{campusIds:['campus-hunnan']},effectiveFrom:'2026-01-01',effectiveTo:null,reason:'核对固定校区交流维修'}]}
    },directory);
    f.sqlite.exec(await readFile(`${directory}/0042_organization_permissions.sql`,'utf8'));
    const periods=await f.repository.roleBindings('member-20269081');
    assert.deepEqual(periods.map(row=>[row.effectiveFrom,row.effectiveTo]),[['2026-01-01','2026-02-01'],['2026-03-01','2098-01-01']]);
    assert.ok(periods.every(row=>row.scope.campusIds.join()==='campus-nanhu' && row.scope.departmentIds.join()==='dept-hardware' && row.reason));
    for(const [day,allowed] of [['2026-01-01',true],['2026-02-01',false],['2026-03-01',true],['2098-01-01',false]]){
      const context=await f.context('20269081');context.authorizationDate=day;
      const grants=await f.repository.grants('member-20269081',day);
      assert.equal(f.platform.authorizer.evaluate(context.actor,'repair.start',{campusId:'campus-nanhu',departmentId:'dept-hardware'},context,grants).allowed,allowed);
      assert.equal(f.platform.authorizer.evaluate(context.actor,'repair.start',{campusId:'campus-hunnan',departmentId:'dept-hardware'},context,grants).allowed,false);
    }
    assert.equal((await f.repository.listMemberships('member-20269082'))[0].assignmentType,'exchange');
    assert.equal((await f.repository.roleBindings('member-20269082')).length,0);
    assert.equal((await f.repository.listMemberships('member-20269083')).length,0);
    assert.equal(f.can(await f.context('20269083'),'repair.start'),false);
    assert.equal(f.can(await f.context('20269083'),'repair.start','campus-hunnan'),true);
    assert.equal(f.can(await f.context('20269083'),'roster.read','campus-hunnan'),false);
    assert.equal(f.can(await f.context('20269084'),'repair.start'),false);
    assert.equal(f.can(await f.context('20269085'),'roles.manage'),false);
  }finally{f.sqlite.close();}
});

for (const directory of ['migrations','database/staff-migrations']) test(`${directory}: customized worker templates with management permissions are archived without granting authority`,async()=>{
  const f=await setup(directory,'0042');
  try {
    f.account('20269086');
    f.sqlite.exec(`INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec)
      VALUES('customized-worker-management','role-technician','roles.manage','{"campuses":"bound"}','[]');`);
    const bindings=f.sqlite.prepare("SELECT * FROM member_roles WHERE member_id='member-20269086'").all();
    assert.ok(bindings.length);
    await stageFixture(f.sqlite,{},directory);
    f.sqlite.exec(await readFile(`${directory}/0042_organization_permissions.sql`,'utf8'));
    assert.deepEqual(await f.repository.roleBindings('member-20269086'),[]);
    assert.equal(f.can(await f.context('20269086'),'repair.start'),false);
    assert.equal(f.can(await f.context('20269086'),'roles.manage'),false);
    const archived=f.sqlite.prepare("SELECT before_json FROM audit_events WHERE action='authorization.binding.archived' AND json_extract(source_ref,'$.id')='member-20269086'").all().map(row=>JSON.parse(row.before_json));
    assert.deepEqual(archived.map(row=>row.id).sort(),bindings.map(row=>row.id).sort());
    assert.ok(f.sqlite.prepare("SELECT id FROM audit_events WHERE action='identity.qualification.archived' AND json_extract(source_ref,'$.id')='member-20269086'").get());
  }finally{f.sqlite.close();}
});

for (const directory of ['migrations','database/staff-migrations']) test(`${directory}: confirmed roster replaces defaults, preserves stable members and campuses, and retains retired repair workers without management`,async()=>{
  const f=await setup(directory,'0042');
  try {
    const cases=[
      ['99100001','虚构样例1','head',true,true,['南湖']],
      ['99100010','虚构样例10','vice_president',false,true,['浑南']],
      ['99100013','虚构样例13','director',false,true,['浑南']],
      ['99100016','虚构样例16','director',false,false,['南湖','浑南']],
      ['99100068','虚构样例68','member',true,false,['浑南']],
      ['99100017','虚构样例17','member',true,false,['南湖']],
      ['99100107','虚构样例107',null,true,false,['浑南']],
      ['99100108','虚构样例108',null,true,false,['南湖','浑南']]
    ];
    f.account('root001',['南湖','浑南'],true);
    for(const [id,name,,,,campuses] of cases){
      f.account(id,campuses);
      f.sqlite.prepare('UPDATE members SET name=? WHERE student_id=?').run(name,id);
      f.sqlite.prepare('UPDATE staff_accounts SET name=? WHERE account=?').run(name,id);
      f.sqlite.prepare("INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from) VALUES(?,?,'role-repair-lead','{\"campuses\":\"bound\"}','2026-01-01')").run('business-lead-'+id,'member-'+id);
    }
    const people=f.sqlite.prepare('SELECT * FROM members ORDER BY id').all();
    const credentials=f.sqlite.prepare('SELECT account,password_hash,member_id FROM staff_accounts ORDER BY account').all();
    const campuses=f.sqlite.prepare('SELECT * FROM staff_campus_grants ORDER BY account,campus').all();
    const units={'99100001':'hardware','99100010':'center','99100013':'device_station','99100016':'affairs_station','99100068':'hardware','99100017':'hardware'};
    await stageFixture(f.sqlite,Object.fromEntries(cases.map(([id,,position,,,campuses])=>['member-'+id,{decision:'migrate',...(position?{post:{departmentCode:units[id],positionCode:position,effectiveFrom:'2026-10-10',effectiveTo:'2027-07-16'}}:{authorizations:[{roleCode:'technician',scope:{campusIds:campuses.map(campus=>campus==='南湖'?'campus-nanhu':'campus-hunnan')},effectiveFrom:'2026-10-10',effectiveTo:'2027-07-16',reason:'已确认退休后继续维修'}]})}])),directory);
    f.sqlite.exec(await readFile(`${directory}/0042_organization_permissions.sql`,'utf8'));
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM members ORDER BY id').all(),people);
    assert.deepEqual(f.sqlite.prepare('SELECT account,password_hash,member_id FROM staff_accounts ORDER BY account').all(),credentials);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM staff_campus_grants ORDER BY account,campus').all(),campuses);
    for(const [id,,position,repair,manage,authorized] of cases){
      const ctx={actor:{memberId:'member-'+id,authorizedCampuses:authorized},businessDate:'2026-11-01',authorizationDate:'2026-11-01',grants:await f.repository.grants('member-'+id,'2026-11-01')};
      const target=authorized.includes('南湖')?'campus-nanhu':'campus-hunnan';
      assert.equal(f.can(ctx,'repair.start',target),repair,id);
      assert.equal(f.can(ctx,'roles.manage',target),manage,id);
      const posts=await f.repository.listMemberships('member-'+id),bindings=await f.repository.roleBindings('member-'+id);
      if(position){
        assert.equal(posts.length,1);assert.equal(posts[0].positionCode,position);assert.equal(posts[0].effectiveFrom,'2026-10-10');assert.equal(posts[0].effectiveTo,'2027-07-16');
        assert.equal(bindings.length,0,'confirmed posts must not leave old default or special roles');
      }else{
        assert.equal(posts.length,0);assert.equal(bindings.length,1);assert.match(bindings[0].reason,/退休后继续维修/);
        assert.equal(bindings[0].effectiveTo,'2027-07-16');
      }
      const expired={...ctx,authorizationDate:'2027-07-16'};
      assert.equal(f.can(expired,'repair.start',target),false);assert.equal(f.can(expired,'roles.manage',target),false);
      if(manage){
        f.sqlite.prepare('UPDATE member_department_memberships SET effective_to=? WHERE member_id=?').run('2026-11-01','member-'+id);
        assert.equal(f.can({...ctx,grants:await f.repository.grants('member-'+id,'2026-11-01')},'roles.manage',target),false,'ending confirmed appointments revokes authority without residual defaults');
      }
    }
    assert.equal(f.sqlite.prepare("SELECT department_id FROM member_department_memberships WHERE member_id='member-99100068'").get().department_id,'dept-hardware','the unrelated publicity head with the same name is never bound');
    const root=await f.users.find('root001');
    const csv='studentId,name,homeCampusId,departmentId,positionCode,effectiveFrom\n99100017,虚构样例17,campus-nanhu,dept-hardware,member,2026-10-10';
    const preview=await f.staff.importMembers(root,{csv});assert.equal(preview.summary.skipped,1,'a confirmed dated appointment must be recognized on repeated import');
    assert.equal((await f.staff.importMembers(root,{csv,confirm:true,previewToken:preview.previewToken})).count,0);
    assert.equal((await f.repository.listMemberships('member-99100017')).length,1);
    assert.equal((await f.repository.listMemberships('member-99100017'))[0].effectiveTo,'2027-07-16','reimport cannot extend a confirmed term');
    assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{f.sqlite.close();}
});

for (const directory of ['migrations','database/staff-migrations']) test(`${directory}: roster identity drift aborts and rolls back the entire cutover`,async()=>{
  const f=await setup(directory,'0042');
  try {
    f.account('99100001');
    const before=f.sqlite.prepare('SELECT * FROM member_department_memberships').all();
    const sql=await readFile(`${directory}/0042_organization_permissions.sql`,'utf8');
    f.sqlite.exec('BEGIN');
    assert.throws(()=>f.sqlite.exec(sql),/CHECK constraint/);
    f.sqlite.exec('ROLLBACK');
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM member_department_memberships').all(),before);
    assert.equal(f.sqlite.prepare("SELECT name FROM pragma_table_info('departments') WHERE name='kind'").get(),undefined);
    assert.equal(f.sqlite.prepare('SELECT count(*) AS n FROM audit_events').get().n,0);
  }finally{f.sqlite.close();}
});

for (const directory of ['migrations','database/staff-migrations']) test(`${directory}: verified exchange members keep real departments and exchange relationships without reopening disabled accounts`,async()=>{
  const f=await setup(directory,'0042');
  try {
    for(const [id,name,campus] of [['99100036','虚构样例36','南湖'],['99100095','虚构样例95','浑南']]){
      f.account(id,[campus]);f.sqlite.prepare('UPDATE members SET name=? WHERE student_id=?').run(name,id);
    }
    f.sqlite.exec("UPDATE staff_accounts SET status='disabled' WHERE account='99100095'");
    const campuses=f.sqlite.prepare('SELECT * FROM staff_campus_grants ORDER BY account').all();
    await stageFixture(f.sqlite,Object.fromEntries([['99100036','network'],['99100095','art']].map(([id,departmentCode])=>['member-'+id,{decision:'migrate',post:{departmentCode,positionCode:'member',effectiveFrom:'2026-10-10',effectiveTo:'2027-07-16'},exchange:{effectiveFrom:'2026-10-10',effectiveTo:'2027-07-16'}}])),directory);
    f.sqlite.exec(await readFile(`${directory}/0042_organization_permissions.sql`,'utf8'));
    assert.equal((await f.users.find('99100095')).status,'disabled');
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM staff_campus_grants ORDER BY account').all(),campuses);
    for(const [id,department] of [['99100036','dept-network'],['99100095','dept-art']]){
      const posts=await f.repository.listMemberships('member-'+id);
      assert.equal(posts.length,2);assert.equal(posts.find(post=>post.isPrimary).departmentId,department);
      assert.equal(posts.find(post=>post.assignmentType==='exchange').departmentId,'dept-hardware');
      assert.equal((await f.repository.roleBindings('member-'+id)).length,0);
      const grants=await f.repository.grants('member-'+id,'2026-11-01');assert.ok(grants.every(grant=>grant.roleCode==='exchange'));
      assert.equal(repairRosterPool({active:true,memberId:'member-'+id,campuses:[id==='99100036'?'南湖':'浑南'],grants},f.platform.authorizer,'2026-11-01'), '');
    }
  }finally{f.sqlite.close();}
});
