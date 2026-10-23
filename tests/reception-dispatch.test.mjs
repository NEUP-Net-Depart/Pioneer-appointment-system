import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { config, wrangler } from '../scripts/cli.mjs';
import { hashPassword } from '../src/lib/passwords.js';
import { fieldSeed } from './fixtures/field-seed.mjs';

const day='2026-10-15',now=Date.parse(`${day}T10:00:00+08:00`);
let mf,db;
const tokens={},office='20261001',tech='20261002',other='20261003',lead='20261004';
let phase=1;
const checked={brand:'联想',model:'ThinkPad 已现场核对',warranty:'expired',liquidMetal:'no',note:'外观及设备信息已核实'};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Hf8AAAAASUVORK5CYII=';
async function request(path,account,body,method=body?'POST':'GET') {
  const response=await mf.dispatchFetch(`https://dispatch.test${path}`,{method,headers:{'CF-Connecting-IP':`198.18.69.${phase}`,...(account?{Authorization:`Bearer ${tokens[account]}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,body:await response.json()};
}
function expect(result,status=200){assert.equal(result.status,status,JSON.stringify(result.body));return result.body;}
async function sql(text){
  let buffer='';const statements=[];
  for(const line of text.replace(/--[^\n]*/g,'').split('\n')) {
    buffer=`${buffer}\n${line}`.trim();
    if (buffer && (buffer.startsWith('CREATE TRIGGER') ? line.trim()==='END;' : line.trim().endsWith(';'))) {statements.push(buffer);buffer='';}
  }
  assert.equal(buffer,'');
  for(const statement of statements) {
    if(statement.startsWith('CREATE TRIGGER'))await db.prepare(statement).run();
    else for(const piece of statement.split(';').map(value=>value.trim()).filter(Boolean))await db.prepare(piece).run();
  }
}
before(async()=>{
  const cfg=await config();
  wrangler(['pages','functions','build','functions','--outdir','.wrangler/dispatch-test-build','--compatibility-date',cfg.compatibility_date,'--compatibility-flags',...cfg.compatibility_flags]);
  const bundle=await readFile('.wrangler/dispatch-test-build/index.js','utf8');
  const clock=`const RealDate=Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[${now}]));}static now(){return ${now};}};\n`;
  mf=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'dispatch-tests',compatibilityDate:cfg.compatibility_date,compatibilityFlags:cfg.compatibility_flags,manifest:{mainModule:'index.js',modules:{'index.js':{type:'esm',contents:clock+bundle}}},env:{DB:{type:'d1',id:'dispatch-tests'},ATTACHMENTS:{type:'r2',name:'dispatch-tests'},JWT_SECRET:{type:'text',value:'dispatch-test-secret-01234567890123456789'},PII_ENCRYPTION_KEY:{type:'text',value:'0123456789012345678901234567890101234567890123456789012345678901'}}}}]});
  db=await mf.getD1Database('DB');
  for(const file of (await readdir('migrations')).filter(file=>file.endsWith('.sql')).sort()) await sql(await readFile(`migrations/${file}`,'utf8'));
  await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES('root001','测试管理员','superadmin','南湖',1,?,'2026-01-01')").bind(hashPassword('StaffTest!2026')).run();
  await db.prepare("INSERT INTO staff_campus_grants VALUES('root001','南湖')").run();
  await sql(fieldSeed(day));
  for(const account of ['root001',office,tech,other,lead])tokens[account]=expect(await request('/api/auth/login',null,{account,password:'StaffTest!2026'})).token;
  const credential=expect(await request('/api/attendance/events/field-event/token',office,{revision:0}));
  for(const account of [tech,other,lead])expect(await request('/api/attendance/check-ins',account,{token:credential.token,requestId:crypto.randomUUID()}));
});
after(()=>mf?.dispose());

async function create(number){
  return expect(await request('/api/scan/onsite',office,{requestId:crypto.randomUUID(),registrationFlow:'frontdesk',campus:'南湖',name:'接待测试客户',studentId:`2030690${number}`,social:'dispatch-test-contact',deviceType:'笔记本电脑',brand:'联想',deviceModel:`ThinkPad ${number}`,warranty:'否',faultType:'系统问题',signature:[Array.from({length:10},(_,i)=>[.1+i*.05,.2+i*.03])]}),201);
}
async function photo(id,account,side){return expect(await request(`/api/appointments/${id}/attachments`,account,{filename:`${side}.png`,mimeType:'image/png',data:png,purpose:`intake_${side}`}),201).id;}
async function receive(item){
  const frontPhotoId=await photo(item.id,office,'front'),backPhotoId=await photo(item.id,office,'back');
  return command(item,office,'receive',{verification:checked,frontPhotoId,backPhotoId});
}
async function command(item,account,action,extra={}){return request(`/api/appointments/${item.id}/reception`,account,{action,revision:item.revision,requestId:crypto.randomUUID(),...extra});}
async function detail(id,account=office){return expect(await request(`/api/field/appointments/${id}`,account));}

test('reception dispatch reserves capacity, supports returns, verifies shared photos and completes atomically',async()=>{
  const first=await create(1),second=await create(2),third=await create(3);
  assert.equal((await detail(first.id,tech)).canReceive,false);
  expect(await command(first,tech,'receive',{verification:checked}),403);
  let a=expect(await receive(first)),b=expect(await receive(second)),c=expect(await receive(third));
  assert.equal(a.status,'booked');assert.equal(a.reception.state,'queued');
  const suggestion=expect(await request('/api/scan/search',tech,{q:a.id.split('-').at(-1)})).items.find(item=>item.id===a.id);
  assert.deepEqual(suggestion.reception,{state:'queued'});
  const candidates=expect(await request(`/api/field/appointments/${a.id}/dispatch-candidates`,office));
  assert.ok(candidates.items.some(person=>person.account===tech && person.workload.started===0));
  expect(await command(b,office,'assign',{assignedTo:tech}),400);
  // Failed audit must roll back the appointment revision and reservation too.
  await db.prepare("CREATE TRIGGER dispatch_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='receptions.assign' BEGIN SELECT RAISE(ABORT,'TEST_DISPATCH_AUDIT_FAILURE'); END").run();
  expect(await command(a,office,'assign',{assignedTo:tech}),500);
  await db.prepare('DROP TRIGGER dispatch_audit_failure').run();
  assert.equal((await detail(a.id)).revision,a.revision);assert.equal((await detail(a.id)).reception.state,'queued');
  const assign={action:'assign',assignedTo:tech,revision:a.revision,requestId:crypto.randomUUID()};
  const duplicateAssign=await Promise.all([1,2].map(()=>request(`/api/appointments/${a.id}/reception`,office,assign)));
  assert.ok(duplicateAssign.every(result=>result.status===200),JSON.stringify(duplicateAssign));
  a=duplicateAssign[0].body;
  assert.equal(a.reception.state,'assigned');assert.equal(a.startedAt,null);
  expect(await request(`/api/appointments/${a.id}/reception`,office,assign));
  assert.equal(expect(await request('/api/field/home',tech)).state,'pending');
  assert.equal(expect(await request('/api/field/home',tech)).pendingRepair.id,a.id);
  assert.equal((await detail(a.id,other)).canStart,false);
  const theft=await request(`/api/appointments/${a.id}/status`,other,{status:'in_progress',revision:a.revision,verification:checked,frontPhotoId:a.frontPhotoId,backPhotoId:a.backPhotoId,requestId:crypto.randomUUID()},'PATCH');
  expect(theft,409);
  expect(await command(b,office,'assign',{assignedTo:tech}),409);
  expect(await request('/api/presence/me',tech,{state:'away',revision:0},'PATCH'),409);
  expect(await command(a,tech,'return'),400);
  a=expect(await command(a,tech,'return',{reason:'需要其他人员处理'}));
  assert.equal(a.reception.state,'queued');assert.equal(expect(await request('/api/field/home',tech)).state,'available');
  // Parallel assignments to different orders still reserve only one slot.
  const race=await Promise.all([a,b].map(item=>command(item,office,'assign',{assignedTo:tech,reason:'现场协调调整顺序'})));
  assert.equal(race.filter(result=>result.status===200).length,1,JSON.stringify(race));
  assert.equal(race.filter(result=>result.status===409).length,1,JSON.stringify(race));
  let assigned=await detail(race.find(result=>result.status===200).body.id,tech);
  const replaced=await photo(assigned.id,tech,'front');
  const start={status:'in_progress',revision:assigned.revision,verification:{...checked,note:'接手人员复核并更换正面照片'},frontPhotoId:replaced,backPhotoId:assigned.backPhotoId,requestId:crypto.randomUUID()};
  assigned=expect(await request(`/api/appointments/${assigned.id}/status`,tech,start,'PATCH'));
  assert.equal(assigned.status,'in_progress');assert.equal(assigned.reception.state,'started');
  assert.equal(assigned.intake.note,start.verification.note);
  expect(await request(`/api/appointments/${assigned.id}/status`,tech,start,'PATCH'));
  const workload=expect(await request('/api/field/board',office)).staffPresence.find(person=>person.account===tech).workload;
  assert.equal(workload.started,1);assert.equal(workload.completed,0);
  assigned=expect(await request(`/api/appointments/${assigned.id}/status`,tech,{status:'completed',revision:assigned.revision,outcome:'repaired',repairNote:'完成现场维修',requestId:crypto.randomUUID()},'PATCH'));
  assert.equal(assigned.reception.state,'closed');assert.equal(expect(await request('/api/field/home',tech)).state,'available');
  const completeWorkload=expect(await request('/api/field/board',office)).staffPresence.find(person=>person.account===tech).workload;
  assert.deepEqual(completeWorkload,{started:1,completed:1});
  assert.ok((await detail(assigned.id)).receptionHistory.some(event=>event.action==='receptions.assign'));
  // Old arrival timestamps and appointment dates remain actionable across days.
  c=await detail(c.id);
  await db.prepare("UPDATE appointments SET date='2026-10-14',expires_at='2026-10-14T12:45:00.000Z' WHERE id=?").bind(c.id).run();
  await db.prepare("UPDATE repair_receptions SET received_at='2026-10-14T02:00:00Z' WHERE appointment_id=?").bind(c.id).run();
  c=await detail(c.id);assert.equal(c.status,'booked');
  assert.ok(expect(await request('/api/field/board',office)).appointments.some(item=>item.id===c.id));
  c=expect(await command(c,office,'assign',{assignedTo:other}));
  assert.equal((await detail(c.id,other)).canStart,true);
  c=expect(await command(c,office,'cancel',{reason:'已联系客户，客户取消维修'}));
  assert.equal(c.status,'cancelled');assert.equal(c.reception.state,'closed');
  assert.equal(expect(await request('/api/field/home',other)).state,'available');
  const queued=await detail([a,b].find(item=>item.id!==assigned.id).id);
  const options=expect(await request(`/api/appointments/${queued.id}/reception-options`,office));
  const option=options.items.find(item=>item.timeSlot!==queued.timeSlot || item.date!==queued.date);assert.ok(option);
  const moved=expect(await command(queued,office,'reschedule',{...option,reason:'与客户确认新的到场时间'}));
  assert.equal(moved.date,option.date);assert.equal(moved.timeSlot,option.timeSlot);assert.equal(moved.reception.state,'closed');
  assert.ok(moved.receptionHistory.some(event=>event.action==='receptions.reschedule'));
  // Losing reception authorization invalidates both entry projection and command.
  phase=2; // A second operational scenario has its own real rate-limit bucket.
  const fresh=expect(await receive(await create(4)));
  await db.prepare("UPDATE member_work_profiles SET profile_code='exchange' WHERE member_id='member-20261003' AND profile_code='repair'").run();
  const exchange=expect(await request(`/api/field/appointments/${fresh.id}/dispatch-candidates`,office)).items.find(person=>person.account===other);
  assert.ok(exchange.identities.some(identity=>identity.code==='exchange'));
  let pendingExchange=expect(await command(fresh,office,'assign',{assignedTo:other}));
  await db.prepare("UPDATE member_work_profiles SET effective_to='2026-10-15' WHERE member_id='member-20261003' AND profile_code='exchange'").run();
  const revoked=await request(`/api/appointments/${fresh.id}/status`,other,{status:'in_progress',revision:pendingExchange.revision,verification:checked,frontPhotoId:pendingExchange.frontPhotoId,backPhotoId:pendingExchange.backPhotoId,requestId:crypto.randomUUID()},'PATCH');
  assert.ok([403,409].includes(revoked.status),JSON.stringify(revoked));
  pendingExchange=expect(await command(pendingExchange,office,'withdraw',{reason:'资格已撤销，重新安排'}));
  pendingExchange=expect(await command(pendingExchange,office,'assign',{assignedTo:tech}));
  await db.prepare("INSERT INTO service_day_overrides(business_date,campus_id,paused,reason,updated_at) VALUES('2026-10-15','campus-nanhu',1,'现场暂停','2026-10-15T02:00:00.000Z')").run();
  // Pausing prevents new work, but must still allow resolving existing arrivals.
  pendingExchange=expect(await command(pendingExchange,tech,'return',{reason:'暂停维修，交接待联系客户'}));
  assert.deepEqual(expect(await request(`/api/field/appointments/${fresh.id}/dispatch-candidates`,office)).items,[]);
  expect(await command(pendingExchange,office,'assign',{assignedTo:tech}),409);
  const pausedOptions=expect(await request(`/api/appointments/${fresh.id}/reception-options`,office));
  assert.equal(pausedOptions.items.length,0); // Thursday is paused; the remaining window is Fri–Sun.
  const cancelledQueuedDuringPause=expect(await command(pendingExchange,office,'cancel',{reason:'暂停后客户决定取消'}));
  assert.equal(cancelledQueuedDuringPause.status,'cancelled');
  await db.prepare("DELETE FROM service_day_overrides WHERE business_date='2026-10-15'").run();
  pendingExchange=expect(await receive(await create(5)));
  pendingExchange=expect(await command(pendingExchange,office,'assign',{assignedTo:tech}));
  await db.prepare("INSERT INTO service_day_overrides(business_date,campus_id,paused,reason,updated_at) VALUES('2026-10-15','campus-nanhu',1,'现场暂停','2026-10-15T02:00:00.000Z')").run();
  pendingExchange=expect(await command(pendingExchange,office,'withdraw',{reason:'暂停期间先撤回分派'}));
  const cancelledDuringPause=expect(await command(pendingExchange,office,'cancel',{reason:'暂停后客户决定取消'}));
  assert.equal(cancelledDuringPause.status,'cancelled');
  await db.prepare("DELETE FROM service_day_overrides WHERE business_date='2026-10-15'").run();
  pendingExchange=expect(await receive(await create(6)));
  await db.prepare("DELETE FROM member_roles WHERE id='field-office-role'").run();
  expect(await command(pendingExchange,office,'assign',{assignedTo:tech}),403);
  expect(await request(`/api/field/appointments/${pendingExchange.id}/dispatch-candidates`,office),403);
});
