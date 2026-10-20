import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Miniflare } from 'miniflare';
import { config, wrangler } from '../scripts/cli.mjs';
import { hashPassword } from '../src/lib/passwords.js';
import { AGREEMENT_VERSION } from '../shared/student-booking.js';

let cfg, worker;
const password = 'cutover-original-password', day = '2026-10-15';
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

for (const directory of ['migrations','database/staff-migrations']) test(`${directory}: old administrators keep original campus management without inferred office work or elevation`, async () => {
  const clock = `const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[1792029600000]));}static now(){return 1792029600000;}};`;
  const mf = new Miniflare({ telemetry:{enabled:false}, workers:[{config:{
    name:'admin-cutover-tests',compatibilityDate:cfg.compatibility_date,compatibilityFlags:cfg.compatibility_flags,
    manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:clock+'\n'+worker}}},
    env:{DB:{type:'d1',id:directory.replaceAll('/','-')},ATTACHMENTS:{type:'r2',name:'cutover'},
      JWT_SECRET:{type:'text',value:'cutover-original-jwt-secret-0123456789'},PII_ENCRYPTION_KEY:{type:'text',value:'0123456789012345678901234567890101234567890123456789012345678901'}}
  }}]});
  try {
    const db = await mf.getD1Database('DB'), files = (await readdir(directory)).filter(name=>name.endsWith('.sql')).sort();
    for (const file of files.filter(name=>name<'0010')) await migrate(db,directory,file);
    const originalHash = hashPassword(password);
    for (const [account,role,campus,protectedAccount] of [['20268001','admin','南湖',0],['20268002','admin','南湖',0],['root001','superadmin','南湖',1],['20268003','technician','南湖',0],['20268004','technician','浑南',0]]) {
      await db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES(?,?,?,?,?,?,?)').bind(account,account,role,campus,protectedAccount,originalHash,'2026-01-01').run();
      await db.prepare('INSERT INTO staff_campus_grants VALUES(?,?)').bind(account,campus).run();
    }
    for (const file of files.filter(name=>name>='0010' && name<'0030')) await migrate(db,directory,file);
    // Explicitly revised assignments are independent facts; the cutover must retain them.
    for (const table of ['member_roles','member_work_profiles','member_department_memberships']) await db.prepare(`UPDATE ${table} SET revision=1 WHERE member_id='member-20268002'`).run();
    // Login aliases share a person, while their authorized campus sets remain
    // separate. Technician aliases must not broaden a migrated admin grant.
    for (const [account,role,memberId,campus] of [['20268006','technician','member-20268001','浑南'],['20268007','admin','member-20268001','南湖'],['20268008','admin','member-20268002','浑南']]) {
      await db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,member_id) VALUES(?,?,?,?,?,?,?)').bind(account,account,role,campus,originalHash,'2026-01-01',memberId).run();
      await db.prepare('INSERT INTO staff_campus_grants VALUES(?,?)').bind(account,campus).run();
    }
    const call = async (path, {token,method='GET',body,status=200}={}) => {
      const response=await mf.dispatchFetch('https://cutover.test'+path,{method,headers:{...(path==='/api/appointments'&&method==='POST'?{'Idempotency-Key':randomBytes(32).toString('base64url')}:{}),...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
      const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));return result;
    };
    const login=account=>call('/api/auth/login',{method:'POST',body:{account,password}});
    const oldToken=(await login('20268001')).token;
    await migrate(db,directory,'0030_react_cutover_access.sql');
    await call('/api/auth/me',{token:oldToken,status:401});
    const admin=await login('20268001'), token=admin.token, me=await call('/api/auth/me',{token});
    assert.equal(me.role,'admin');assert.deepEqual(me.authorizedCampuses,['南湖']);
    for (const permission of ['accounts.manage','settings.manage','statistics.read','repair.correct','customer.identity.read','customer.contact.read']) assert.equal(me.permissions[permission],true,permission);
    assert.notEqual(me.permissions['roles.manage'],true);assert.notEqual(me.permissions['onsite.frontdesk.create'],true);assert.notEqual(me.permissions['repair.start'],true);
    for (const table of ['member_work_profiles','member_department_memberships']) assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE member_id='member-20268001'`).first()).n,0);
    assert.deepEqual((await db.prepare("SELECT r.code FROM member_roles mr JOIN roles r ON r.id=mr.role_id WHERE member_id='member-20268001'").all()).results.map(row=>row.code),['legacy_admin']);
    for (const table of ['member_roles','member_work_profiles','member_department_memberships']) assert.ok((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE member_id='member-20268002' AND revision=1`).first()).n>0);
    const accounts=await call('/api/users',{token});
    assert.ok(accounts.items.some(row=>row.account==='20268003' && row.actions.edit));assert.ok(!accounts.items.some(row=>row.account==='20268004'));
    await call('/api/users/20268003',{token,method:'PATCH',body:{name:'原校区管理员直接修改'}});
    await call('/api/users/20268004',{token,method:'PATCH',body:{name:'越界修改'},status:403});
    await call('/api/roles',{token,status:403});
    const technicianAlias=(await login('20268006')).token;
    for (const path of ['/api/users','/api/slot-capacities','/api/stats/summary?range=all']) await call(path,{token:technicianAlias,status:403});
    const adminAlias=(await login('20268008')).token;
    assert.ok((await call('/api/slot-capacities',{token:adminAlias})).items.every(row=>row.campus==='浑南'),'All original admin aliases retain their own campus without borrowing another login scope');
    const capacities=await call('/api/slot-capacities',{token});assert.ok(capacities.items.every(row=>row.campus==='南湖'));
    const cell=capacities.items[0];await call('/api/slot-capacities',{token,method:'PATCH',body:{...cell,capacity:7}});
    await call('/api/slot-capacities',{token,method:'PATCH',body:{...cell,campus:'浑南',capacity:7},status:403});
    for (const campus of ['南湖','浑南']) await db.prepare('INSERT INTO service_locations(campus,date,location,updated_at) VALUES(?,?,?,?)').bind(campus,day,'测试点',day).run();
    const booked=[];
    for (const [index,campus] of ['南湖','浑南'].entries()) booked.push(await call('/api/appointments',{method:'POST',status:201,body:{
      studentId:String(20308001+index),name:'历史客户',campus,email:'student@example.test',contactType:'wechat',contactValue:'private-contact',social:'private-contact',phone:'13800138000',college:'计算机科学与工程学院',
      agreementAccepted:true,agreementVersion:AGREEMENT_VERSION,agreementAt:day+'T02:00:00Z',signature:[Array.from({length:10},(_,i)=>[.1+i*.05,.2+i*.03])],
      deviceType:'笔记本',brand:'联想',deviceModel:'ThinkPad',warranty:'否',liquidMetal:'不清楚',faultType:'蓝屏',issue:'',date:day,timeSlot:'19:00–19:30'
    }}));
    const stats=await call('/api/stats/summary?range=all',{token});assert.equal(stats.total,1);assert.deepEqual(Object.keys(stats.campuses),['南湖']);
    const detail=await call('/api/field/appointments/'+booked[0].id,{token});assert.equal(detail.name,'历史客户');assert.equal(detail.canCorrect,true);
    await call('/api/field/appointments/'+booked[1].id,{token,status:403});
    await call('/api/appointments/'+booked[0].id+'/correction',{token,method:'PATCH',body:{revision:0,status:'cancelled',correctionReason:'核验历史记录后由原管理员取消'}});
    await call('/api/appointments/'+booked[1].id+'/correction',{token,method:'PATCH',body:{revision:0,status:'cancelled',correctionReason:'不得越权修改其他校区记录'},status:403});
    await call('/api/appointments/'+booked[0].id+'/credential',{token,method:'POST',body:{identityVerified:true,reason:'现场核验本人学生证和登记资料'}});
    await call('/api/appointments/'+booked[1].id+'/credential',{token,method:'POST',body:{identityVerified:true,reason:'不得越权重发其他校区凭证'},status:403});
    assert.equal((await db.prepare("SELECT password_hash FROM staff_accounts WHERE account='20268001'").first()).password_hash,originalHash);
    // A future admin login label must assign neither a work post nor a management role.
    await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('20268005','新账号','admin','南湖',?,'2026-01-01')").bind(originalHash).run();
    for (const table of ['member_roles','member_work_profiles','member_department_memberships']) assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE member_id='member-20268005'`).first()).n,0);
    await db.prepare("DELETE FROM member_roles WHERE member_id='member-20268003'").run();
    await db.prepare("DELETE FROM staff_accounts WHERE account='20268003'").run();
    await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('20268003','重建登录','technician','南湖',?,'2026-01-01')").bind(originalHash).run();
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM member_roles WHERE member_id='member-20268003'").first()).n,0);
  } finally { await mf.dispose(); }
});
