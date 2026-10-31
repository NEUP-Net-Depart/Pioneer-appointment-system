import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { config, wrangler } from '../scripts/cli.mjs';
import { hashPassword } from '../src/lib/passwords.js';
import { staffPlatformRepository } from '../src/db/staff-platform.js';
import { userRepository } from '../src/db/users.js';
import { composeStaffPlatform } from '../src/app/compose.js';
import { staffPlatformService } from '../src/services/staff-platform.js';

let cfg, worker;
const password = 'cutover-original-password';
before(async () => {
  cfg = await config();
  wrangler(['pages','functions','build','functions','--outdir','.wrangler/admin-cutover-build','--compatibility-date',cfg.compatibility_date,'--compatibility-flags',...cfg.compatibility_flags]);
  worker = await readFile('.wrangler/admin-cutover-build/index.js','utf8');
});
async function migrate(db, directory, file) {
  const sql = (await readFile(`${directory}/${file}`,'utf8')).replace(/--[^\n]*/g,'');
  const statements = []; let buffer = '';
  for (const line of sql.split('\n')) {
    buffer = `${buffer}\n${line}`.trim();
    if (buffer && (buffer.startsWith('CREATE TRIGGER') ? line.trim() === 'END;' : line.trim().endsWith(';'))) { statements.push(buffer); buffer = ''; }
  }
  assert.equal(buffer,'');
  await db.batch(statements.map(sql => db.prepare(sql)));
}

for (const directory of ['migrations','database/staff-migrations']) test(`${directory}: one-time business role upgrade preserves accounts and permits scoped off-duty management`, async () => {
  const mf = new Miniflare({ telemetry:{enabled:false}, workers:[{config:{
    name:'business-role-cutover-tests',compatibilityDate:cfg.compatibility_date,compatibilityFlags:cfg.compatibility_flags,
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:worker}}},
    env:{DB:{type:'d1',id:directory.replaceAll('/','-')},ATTACHMENTS:{type:'r2',name:'cutover'},
      JWT_SECRET:{type:'text',value:'cutover-original-jwt-secret-0123456789'},PII_ENCRYPTION_KEY:{type:'text',value:'0123456789012345678901234567890101234567890123456789012345678901'}}
  }}]});
  try {
    const db = await mf.getD1Database('DB'), files = (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort();
    for (const file of files.filter(name=>name<'0007')) await migrate(db,directory,file);
    const originalHash = hashPassword(password);
    for (const [account,role,campus,protectedAccount] of [['20268001','admin','南湖',0],['20268002','admin','南湖',0],['root001','superadmin','南湖',1],['root002','superadmin','南湖',1],['20268003','technician','南湖',0],['20268004','technician','浑南',0],['20268005','admin','浑南',0]]) {
      await db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES(?,?,?,?,?,?,?)').bind(account,account,role,campus,protectedAccount,originalHash,'2026-01-01').run();
      await db.prepare('INSERT INTO staff_campus_grants VALUES(?,?)').bind(account,campus).run();
    }
    for (const file of files.filter(name=>name>='0007' && name<'0033')) await migrate(db,directory,file);
    await db.prepare("INSERT INTO staff_campus_grants VALUES('20268002','浑南')").run();
    await db.prepare("INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from) VALUES('explicit-repair','member-20268002','repair','2026-01-01')").run();
    await db.prepare("INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from) VALUES('preview-explicit-lead','member-20268002','role-repair-lead','{\"campusIds\":[\"campus-nanhu\"]}','2026-01-01')").run();
    await db.prepare("INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from,effective_to) VALUES('expired-lead','member-20268005','role-repair-lead','{\"campusIds\":[\"campus-hunnan\"]}','2026-01-01','2026-09-01')").run();
    await db.prepare("INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from,effective_to) VALUES('expired-repair','member-20268005','repair','2026-01-01','2026-09-01')").run();
    await db.batch([
      db.prepare("INSERT INTO roles(id,code,name,description,level,created_at,updated_at) VALUES('role-explicit-reader','explicit_reader','显式历史角色','保留的显式角色配置',1,'2026-01-01','2026-01-01')"),
      db.prepare("INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec) VALUES('grant-explicit-reader','role-explicit-reader','statistics.read','{\"campusIds\":[\"campus-nanhu\"]}','[]')"),
      db.prepare("INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from,effective_to) VALUES('explicit-reader-binding','member-20268001','role-explicit-reader','{\"campusIds\":[\"campus-nanhu\"]}','2026-01-01','2027-01-01')")
    ]);
    await db.prepare("INSERT INTO service_locations(campus,date,location,updated_at,updated_by) VALUES('南湖','2026-01-02','南湖维修点','2026-01-01T00:00:00.000Z','root001')").run();
    await db.prepare("INSERT INTO appointments(id,student_id,name,campus,social,device_type,brand,device_model,warranty,fault_type,date,time_slot,status,outcome,expires_at,access_token_hash,credential_rotated_at,created_at,agreement_at,agreement_version,assigned_to) VALUES('history-appointment','student-history','历史预约','南湖','history-social','laptop','品牌','型号','无','无法开机','2026-01-02','19:00–20:00','completed','repaired','2026-01-03T13:30:00.000Z',?,'2026-01-02T10:00:00.000Z','2026-01-02T10:00:00.000Z','2026-01-02T10:00:00.000Z','v1','20268003')").bind('h'.repeat(64)).run();
    const before = (await db.prepare('SELECT account,name,role,home_campus,protected,password_hash,created_at,member_id FROM staff_accounts ORDER BY account').all()).results;
    const grantsBefore = (await db.prepare('SELECT * FROM staff_campus_grants ORDER BY account,campus').all()).results;
    await db.batch([
      db.prepare("INSERT INTO attachment_storage(id,object_key,size,state,created_at,expires_at) VALUES('history-photo','private/history-photo',123,'complete','2026-01-02','2098-01-01')"),
      db.prepare("INSERT INTO appointment_attachments(id,appointment_id,filename,mime_type,size,object_key,created_at,expires_at,purpose,uploaded_by) VALUES('history-photo','history-appointment','设备正面.png','image/png',123,'private/history-photo','2026-01-02','2098-01-01','intake_front','20268003')"),
      db.prepare("INSERT INTO appointment_corrections VALUES('history-correction','history-appointment','root001','原始修正','{}','{}','2026-01-02')"),
      db.prepare("INSERT INTO credential_recoveries VALUES('history-recovery','history-appointment','root001','原始核验','2026-01-02')"),
      db.prepare("INSERT INTO audit_events(id,actor_member_id,actor_account,action,source_ref,occurred_at) VALUES('history-audit','member-root001','root001','repairs.corrected','{\"id\":\"history-appointment\"}','2026-01-02')")
    ]);
    const historyTables=['appointments','appointment_attachments','attachment_storage','storage_quota','appointment_corrections','credential_recoveries','audit_events','service_locations'];
    const history=()=>Promise.all(historyTables.map(async table=>[table,(await db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results]));
    const historyBefore=await history();
    const call = async (path, {token,method='GET',body,status=200}={}) => {
      const response=await mf.dispatchFetch('https://cutover.test'+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      const result=await response.json();assert.equal(response.status,status,path+': '+JSON.stringify(result));return result;
    };
    const login=async account=>(await call('/api/auth/login',{method:'POST',body:{account,password}})).token;
    const previousToken=await login('20268001');
    await migrate(db,directory,'0033_staff_business_roles.sql');
    assert.deepEqual((await db.prepare('SELECT account,name,role,home_campus,protected,password_hash,created_at,member_id FROM staff_accounts ORDER BY account').all()).results,before);
    assert.deepEqual((await db.prepare('SELECT * FROM staff_campus_grants ORDER BY account,campus').all()).results,grantsBefore);
    assert.deepEqual(await history(),historyBefore,'all historical record fields and links survive the upgrade');
    for(const file of files.filter(name=>name>'0033_staff_business_roles.sql'))await migrate(db,directory,file);
    assert.deepEqual((await db.prepare("SELECT scope_bindings,effective_from,effective_to FROM member_roles WHERE id='preview-explicit-lead'").all()).results,[{scope_bindings:'{"campusIds":["campus-nanhu"]}',effective_from:'2026-01-01',effective_to:null}]);
    assert.deepEqual((await db.prepare("SELECT scope_bindings,effective_from,effective_to FROM member_roles WHERE id='expired-lead'").all()).results,[{scope_bindings:'{"campusIds":["campus-hunnan"]}',effective_from:'2026-01-01',effective_to:'2026-09-01'}]);
    assert.deepEqual((await db.prepare("SELECT scope_bindings FROM member_roles WHERE member_id='member-20268005' AND role_id='role-repair-lead' AND effective_to IS NULL").all()).results,[]);
    assert.deepEqual((await db.prepare("SELECT scope_bindings,effective_from,effective_to FROM member_roles WHERE id='explicit-reader-binding'").all()).results,[{scope_bindings:'{"campusIds":["campus-nanhu"]}',effective_from:'2026-01-01',effective_to:'2027-01-01'}]);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name IN ('legacy_admin_logins','legacy_admin_login_changed')").first()).n,0);
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM roles WHERE code='legacy_admin'").first()).n,0);
    await call('/api/auth/me',{token:previousToken,status:401});
    const token=await login('20268001'), me=await call('/api/auth/me',{token});
    const management=['repair.summary.read','repair.correct','repair.transfer','statistics.read','accounts.manage','settings.manage','members.manage','roles.manage','roster.read','roster.repair.manage','roster.repair.configure','roster.office.manage','attendance.session.manage','attendance.correct','attendance.export','leave.review','customer.identity.read','customer.contact.read'];
    for(const code of management)assert.equal(me.permissions[code],true,code);
    assert.deepEqual(me.todayDuties,[]);
    assert.ok(me.identities.some(item=>item.code==='repair_lead'));
    const leadHome=await call('/api/field/home',{token});
    assert.equal(leadHome.capability['repair.start'],true);
    assert.equal(leadHome.state,'unsigned','receiving work still requires check-in');
    await call('/api/presence/me',{token,method:'PATCH',body:{state:'available',revision:0},status:409});
    assert.ok(await db.prepare("SELECT id FROM member_roles WHERE member_id='member-20268001' AND role_id='role-technician'").first());
    assert.ok(await db.prepare("SELECT id FROM member_work_profiles WHERE member_id='member-20268001' AND profile_code='repair'").first());
    assert.ok(await db.prepare("SELECT id FROM member_department_memberships WHERE member_id='member-20268001' AND department_id='dept-hardware'").first());
    for(const path of ['/api/roles','/api/permissions','/api/users','/api/members','/api/slot-capacities','/api/stats/summary?range=all','/api/attendance','/api/roster-tasks'])await call(path,{token});
    const both=await call('/api/auth/me',{token:await login('20268002')});
    assert.equal(both.permissions['repair.start'],true,'explicit repair qualifications survive manager conversion');
    const technician=await call('/api/field/home',{token:await login('20268003')});
    assert.equal(technician.capability['repair.start'],true);
    assert.equal(technician.state,'unsigned','receiving work still requires check-in');
    await call('/api/users/20268003',{token,method:'PATCH',body:{name:'负责人直接管理普通账号'}});
    await call('/api/users/20268005',{token,method:'PATCH',body:{name:'不能越校区修改管理员'},status:403});
    await call('/api/users/20268003',{token,method:'PATCH',body:{authorizedCampuses:['南湖','浑南']},status:403});
    await call('/api/users/root002',{token,method:'PATCH',body:{name:'不能修改保护账号'},status:403});
    for(const role of ['superadmin'])await call('/api/users/20268003',{token,method:'PATCH',body:{role},status:403});
    const repository=staffPlatformRepository(db);
    const bind=async(account,bindings,status=200)=>call(`/api/members/member-${account}/roles`,{token,method:'PUT',body:{revision:(await repository.memberRow(`member-${account}`)).revision,bindings},status});
    await bind('20268001',[{roleId:'role-technician'}],403);
    await bind('root002',[{roleId:'role-technician'}],403);
    await bind('20268004',[{roleId:'role-technician'}],403);
    await bind('20268003',[{roleId:'role-superadmin'}],403);
    await bind('20268003',[{roleId:'role-technician',scope:{all:true}}],403);
    await bind('20268003',[{roleId:'role-technician',scope:{campusIds:['campus-hunnan']}}],403);
    const role=await call('/api/roles',{token,method:'POST',status:201,body:{code:'business_reader',name:'业务统计人员',grants:[{permissionCode:'statistics.read',scope:{campusIds:['campus-nanhu']}}]}});
    await call(`/api/roles/${role.id}`,{token,method:'PATCH',body:{revision:role.revision,name:'业务统计角色'}});
    await bind('20268003',[{roleId:'role-technician'},{roleId:role.id}]);
    const updated=await call('/api/auth/me',{token:await login('20268003')});
    assert.equal(updated.permissions['statistics.read'],true);
    const boundRole=(await repository.listRoles()).find(item=>item.id===role.id);
    await call(`/api/roles/${role.id}`,{token,method:'PATCH',body:{revision:boundRole.revision,name:'已分配的校区业务角色'}});
    const revision=(await repository.listRoles()).find(item=>item.id===role.id).revision;
    const raceRepository={...repository,updateRole:async(...args)=>{
      await db.prepare("INSERT INTO staff_campus_grants VALUES('20268003','浑南')").run();
      await db.prepare("UPDATE staff_accounts SET auth_version=auth_version+1 WHERE account='20268003'").run();
      return repository.updateRole(...args);
    }};
    const platform=composeStaffPlatform({repository:raceRepository});
    const service=staffPlatformService({repository:raceRepository,platform,manifests:platform.manifests});
    await assert.rejects(service.updateRole(await userRepository(db).find('20268001'),role.id,{revision,name:'不得覆盖并发范围变化'}),error=>error.status===409);
    assert.equal((await repository.listRoles()).find(item=>item.id===role.id).name,'已分配的校区业务角色');
    await db.prepare("DELETE FROM staff_campus_grants WHERE account='20268003' AND campus='浑南'").run();
    const futureRaceRepository={...repository,updateRole:async(...args)=>{
      await db.prepare("INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from) VALUES('concurrent-future-binding','member-20268004',?,'{\"campusIds\":[\"campus-hunnan\"]}','2098-01-01')").bind(role.id).run();
      return repository.updateRole(...args);
    }};
    const futurePlatform=composeStaffPlatform({repository:futureRaceRepository});
    const futureService=staffPlatformService({repository:futureRaceRepository,platform:futurePlatform,manifests:futurePlatform.manifests});
    await assert.rejects(futureService.updateRole(await userRepository(db).find('20268001'),role.id,{revision,name:'不得绕过未来绑定并发校验'}),error=>error.status===409);
    assert.equal((await repository.listRoles()).find(item=>item.id===role.id).name,'已分配的校区业务角色');
    await db.prepare("DELETE FROM member_roles WHERE id='concurrent-future-binding'").run();
    for(const code of ['audit.read','data.delete'])await call('/api/roles',{token,method:'POST',body:{code:'forbidden_'+code.replace('.','_'),name:'系统权限',grants:[{permissionCode:code,scope:{campusIds:['campus-nanhu']}}]},status:403});
    const leadRole=(await call('/api/roles',{token})).items.find(item=>item.code==='repair_lead');
    assert.equal(leadRole.actions.edit,false);
    await call('/api/roles/role-repair-lead',{token,method:'PATCH',body:{revision:leadRole.revision,grants:[]},status:403});
    for(const account of ['20268001','root002','20268004'])await call(`/api/members/member-${account}/work-profiles`,{token,method:'POST',body:{revision:0,profileCode:'repair',effectiveFrom:'2026-10-15'},status:403});
    await call('/api/members/member-20268005/work-profiles',{token:await login('20268005'),method:'POST',body:{revision:0,profileCode:'repair',effectiveFrom:'2026-10-15'},status:403});
    // Scoped managers can authorize another ordinary member's independent work qualification.
    // A login may cover both campuses while its management role covers only one.
    await db.prepare("INSERT INTO staff_campus_grants VALUES('20268001','浑南')").run();
    const member=await repository.memberRow('member-20268003');
    await call('/api/members/member-20268003/work-profiles',{token,method:'POST',body:{revision:member.revision,profileCode:'office',effectiveFrom:'2026-10-15'}});
    await call('/api/members/member-20268004/work-profiles',{token,method:'POST',body:{revision:0,profileCode:'office',effectiveFrom:'2026-10-15'},status:403});
    const beforeImport=await repository.memberRow('member-20268003');
    const raceImportRepository={...repository,importMembers:async(...args)=>{
      await db.prepare("INSERT INTO staff_campus_grants VALUES('20268003','浑南')").run();
      await db.prepare("UPDATE staff_accounts SET auth_version=auth_version+1 WHERE account='20268003'").run();
      return repository.importMembers(...args);
    }};
    const importPlatform=composeStaffPlatform({repository:raceImportRepository});
    const importService=staffPlatformService({repository:raceImportRepository,platform:importPlatform,manifests:importPlatform.manifests});
    const importPreview=await importService.importMembers(await userRepository(db).find('20268001'),{csv:'studentId,name,homeCampusId,workProfiles,effectiveFrom\n20268003,不得覆盖并发账号变化,campus-nanhu,office,2026-10-15'});
    await assert.rejects(importService.importMembers(await userRepository(db).find('20268001'),{
      csv:'studentId,name,homeCampusId,workProfiles,effectiveFrom\n20268003,不得覆盖并发账号变化,campus-nanhu,office,2026-10-15',confirm:true,previewToken:importPreview.previewToken
    }),error=>error.status===409);
    assert.deepEqual(await repository.memberRow('member-20268003'),beforeImport);
    await db.prepare("DELETE FROM staff_campus_grants WHERE account='20268003' AND campus='浑南'").run();
    // Later base admin logins receive neither business grants nor an office post.
    await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('20268009','新基础账号','admin','南湖',?,'2026-01-01')").bind(originalHash).run();
    await db.prepare("INSERT INTO staff_campus_grants VALUES('20268009','南湖')").run();
    for(const table of ['member_work_profiles','member_department_memberships','member_roles'])assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE member_id='member-20268009'`).first()).n,0);
    const newToken=await login('20268009'),ungranted=await call('/api/auth/me',{token:newToken});
    assert.ok(Object.values(ungranted.permissions).every(value=>value!==true));
    assert.equal((await call('/api/field/home',{token:newToken})).capability['repair.start'],false);
    await call('/api/roles',{token:newToken,status:403});
    await assert.rejects(db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,member_id) VALUES('20268010','重复账号','admin','南湖',?,'2026-01-01','member-20268001')").bind(originalHash).run(),/UNIQUE/);
    assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  } finally { await mf.dispose(); }
});
