import { test } from 'node:test';
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
      ['20269004','unit-device','deputy_director',false,true],['20269005','unit-device','director',false,true],['20269006','unit-center','president',false,true],
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
    const binding=(await f.repository.roleBindings(member.id))[0];f.sqlite.prepare('UPDATE member_roles SET effective_to=? WHERE id=?').run(f.today,binding.id);
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

for (const directory of ['migrations','database/staff-migrations']) test(`${directory}: dev upgrade retains exact authorization intervals, credentials, review facts and audit history`,async()=>{
  const f=await setup(directory,'0042');
  try {
    f.account('20269061');
    f.sqlite.prepare("UPDATE member_work_profiles SET effective_to=? WHERE member_id='member-20269061'").run(f.today);
    const accounts=f.sqlite.prepare('SELECT account,password_hash,member_id FROM staff_accounts').all();
    const campuses=f.sqlite.prepare('SELECT * FROM staff_campus_grants').all();
    f.sqlite.exec(await readFile(`${directory}/0042_organization_permissions.sql`,'utf8'));
    assert.deepEqual(f.sqlite.prepare('SELECT account,password_hash,member_id FROM staff_accounts').all(),accounts);
    assert.deepEqual(f.sqlite.prepare('SELECT * FROM staff_campus_grants').all(),campuses);
    assert.equal(f.sqlite.prepare("SELECT name FROM sqlite_schema WHERE name='member_work_profiles'").get(),undefined);
    assert.ok(f.sqlite.prepare("SELECT id FROM audit_events WHERE action='identity.qualification.archived'").get());
    assert.equal((await f.repository.listMemberships('member-20269061'))[0].needsReview,true);
    assert.equal(f.can(await f.context('20269061'),'repair.start'),false);
    f.sqlite.prepare("DELETE FROM staff_accounts WHERE account='20269061'").run();
    f.sqlite.prepare("DELETE FROM member_roles WHERE member_id='member-20269061'").run();
    f.account('20269061');assert.equal((await f.repository.grants('member-20269061')).length,0,'recreated login never restores revoked authorization');
    assert.deepEqual(f.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally { f.sqlite.close(); }
});
