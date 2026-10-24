import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { config, wrangler } from '../scripts/cli.mjs';
import { hashPassword } from '../src/lib/passwords.js';
import { fieldSeed } from './fixtures/field-seed.mjs';
import { appointmentRepository } from '../src/db/appointments.js';
import { staffPlatformRepository } from '../src/db/staff-platform.js';
import { activeRepairFollowup } from '../shared/repair-followups.js';

const day='2026-10-15',now=Date.parse(`${day}T10:00:00+08:00`);
let mf,db;
const tokens={},office='20261001',tech='20261002',other='20261003',lead='20261004';
let phase=1;
const checked={brand:'联想',model:'ThinkPad 已现场核对',warranty:'expired',liquidMetal:'no',note:'外观及设备信息已核实'};
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Hf8AAAAASUVORK5CYII=';
async function request(path,account,body,method=body?'POST':'GET',accessToken) {
  const response=await mf.dispatchFetch(`https://dispatch.test${path}`,{method,headers:{'CF-Connecting-IP':`198.18.69.${phase}`,...(accessToken?{'X-Appointment-Token':accessToken}:{}),...(account?{Authorization:`Bearer ${tokens[account]}`} : {}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
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
  const startedDetail=await detail(assigned.id);
  assert.ok(startedDetail.receptionHistory.some(event=>['repairs.claimed','repairs.started'].includes(event.action)));
  assert.equal(startedDetail.assigneeIdentitySnapshot.memberId,'member-'+tech);
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


test('arrival tickets, queue ranks, departure/rejoin and self-service FIFO stay consistent across real roles',async()=>{
  phase=3;
  await db.prepare(`INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from) VALUES('field-office-role','member-20261001','role-office','{"campuses":"bound"}','2026-01-01')`).run();
  for(const item of expect(await request('/api/field/board',lead)).appointments.filter(item=>item.status==='booked' && ['queued','assigned'].includes(item.reception?.state)))
    expect(await command(item,lead,'leave',{reason:'客户已离开，清理上一轮验收队列'}));
  const first=await create(21),second=await create(22),third=await create(23);
  const arrivals=await Promise.all([first,second].map(receive));arrivals.forEach(value=>expect(value));
  const rows=arrivals.map(value=>value.body).sort((a,b)=>a.reception.ticket.number-b.reception.ticket.number);
  let head=rows[0],tail=rows[1];
  assert.equal(tail.reception.ticket.number,head.reception.ticket.number+1);
  assert.equal(head.reception.ticket.date,day);assert.equal(head.reception.ticket.campus,'南湖');
  assert.equal((await detail(head.id)).queuePosition.position,1);
  assert.equal((await detail(tail.id)).queuePosition.position,2);
  assert.equal(expect(await request('/api/field/home',tech)).nextInQueue.id,head.id);
  assert.equal((await detail(tail.id,tech)).canStart,false);
  expect(await request(`/api/appointments/${tail.id}/status`,tech,{status:'in_progress',revision:tail.revision,verification:checked,frontPhotoId:tail.frontPhotoId,backPhotoId:tail.backPhotoId,requestId:crypto.randomUUID()},'PATCH'),409);
  // A new booking is not an onsite arrival and has no pretend queue rank.
  const thirdToken=third.accessToken;assert.ok(thirdToken);
  const noQueue=expect(await request(`/api/live/summary?appointmentId=${third.id}`,null,undefined,'GET',thirdToken));
  assert.equal(noQueue.position,null);assert.equal(noQueue.queueTotal,0);
  const board=expect(await request('/api/field/board',office));
  const actual=(await db.prepare("SELECT COUNT(*) total FROM appointments WHERE date=? AND campus='南湖' AND status<>'cancelled'").bind(day).first()).total;
  assert.equal(board.overview.total,actual);assert.equal(board.overview.queued,2);
  assert.equal(board.overview.notArrived,board.appointments.filter(item=>item.date===day && item.status==='booked' && !['queued','assigned'].includes(item.reception?.state) && !item.reception?.leftAt).length);
  // Skipping a missing customer requires a reason; their original position remains unchanged.
  expect(await command(tail,office,'assign',{assignedTo:tech}),400);
  tail=expect(await command(tail,office,'assign',{assignedTo:tech,reason:'队首客户暂时未到，先处理后续客户'}));
  assert.equal((await detail(head.id)).queuePosition.position,1);
  assert.equal(expect(await request('/api/field/board',office)).overview.queued,2);
  const original=[first,second].find(item=>item.id===tail.id),token=original.accessToken;
  const guest=expect(await request(`/api/appointments/${tail.id}`,null,undefined,'GET',token));
  assert.equal(guest.reception.ticket.number,tail.reception.ticket.number);
  for(const key of ['assignedTo','assignedMemberId','assignedToName','receivedBy','ticketId'])assert.equal(guest.reception[key],undefined);
  const position=expect(await request(`/api/live/summary?appointmentId=${tail.id}`,null,undefined,'GET',token));
  assert.equal(position.position,2);assert.equal(position.queueTotal,2);
  const exit={revision:tail.revision,requestId:crypto.randomUUID()};
  expect(await request(`/api/appointments/${tail.id}/queue-exit`,null,exit,'POST',thirdToken),404);
  const count=(await db.prepare('SELECT COUNT(*) total FROM repair_queue_tickets').first()).total;
  // Audit failure rolls back both departure and reserved worker capacity.
  await db.prepare("CREATE TRIGGER reject_queue_leave BEFORE INSERT ON audit_events WHEN NEW.action='receptions.guest_leave' BEGIN SELECT RAISE(ABORT,'TEST_LEAVE_FAILURE'); END").run();
  expect(await request(`/api/appointments/${tail.id}/queue-exit`,null,exit,'POST',token),500);
  await db.prepare('DROP TRIGGER reject_queue_leave').run();
  assert.equal((await detail(tail.id)).reception.state,'assigned');
  const departed=await Promise.all([1,2].map(()=>request(`/api/appointments/${tail.id}/queue-exit`,null,exit,'POST',token)));
  departed.forEach(value=>expect(value));
  assert.ok(departed[0].body.reception.leftAt);assert.equal(departed[0].body.status,'booked');
  assert.equal(expect(await request('/api/field/home',tech)).state,'available');
  expect(await request(`/api/appointments/${tail.id}/queue-exit`,null,{...exit,revision:exit.revision+1},'POST',token),409);
  tail=expect(await receive(await detail(tail.id)));
  assert.ok(tail.reception.ticket.number>guest.reception.ticket.number);
  assert.equal(tail.queuePosition.position,2);assert.equal(tail.reception.leftAt,null);
  assert.equal((await db.prepare('SELECT COUNT(*) total FROM repair_queue_tickets').first()).total,count+1);
  // Replay of the old leave must never remove a freshly rejoined ticket.
  expect(await request(`/api/appointments/${tail.id}/queue-exit`,null,exit,'POST',token));
  assert.equal((await detail(tail.id)).reception.state,'queued');
  // Without reception, a signed-in repair lead can do the same work; technicians take the head.
  head=await detail(head.id,tech);
  head=expect(await request(`/api/appointments/${head.id}/status`,tech,{status:'in_progress',revision:head.revision,verification:checked,frontPhotoId:head.frontPhotoId,backPhotoId:head.backPhotoId,requestId:crypto.randomUUID()},'PATCH'));
  assert.equal((await detail(tail.id)).queuePosition.position,1);
  assert.equal(expect(await request('/api/field/board',lead)).overview.queued,1);
  expect(await request(`/api/appointments/${head.id}/status`,tech,{status:'completed',revision:head.revision,outcome:'repaired',repairNote:'队列验收完成',requestId:crypto.randomUUID()},'PATCH'));
  tail=expect(await command(await detail(tail.id),lead,'leave',{reason:'客户暂时离队，预约保留'}));
  assert.equal(tail.status,'booked');assert.ok(tail.reception.leftAt);
  const queueBefore=(await db.prepare("SELECT last_number FROM repair_queue_counters WHERE campus='南湖' AND queue_date=?").bind(day).first()).last_number;
  await db.prepare("CREATE TRIGGER reject_queue_intake BEFORE INSERT ON repair_intake_records WHEN NEW.appointment_id='"+third.id+"' BEGIN SELECT RAISE(ABORT,'TEST_INTAKE_FAILURE'); END").run();
  expect(await receive(third),500);
  await db.prepare('DROP TRIGGER reject_queue_intake').run();
  assert.equal((await db.prepare("SELECT last_number FROM repair_queue_counters WHERE campus='南湖' AND queue_date=?").bind(day).first()).last_number,queueBefore);
  let receivedThird=expect(await receive(third));assert.equal(receivedThird.reception.ticket.number,queueBefore+1);
  receivedThird=expect(await command(receivedThird,lead,'assign',{assignedTo:tech}));
  const startBody={status:'in_progress',revision:receivedThird.revision,verification:checked,frontPhotoId:receivedThird.frontPhotoId,backPhotoId:receivedThird.backPhotoId,requestId:crypto.randomUUID()};
  const exitBody={revision:receivedThird.revision,requestId:crypto.randomUUID()};
  const race=await Promise.all([
    request(`/api/appointments/${third.id}/status`,tech,startBody,'PATCH'),
    request(`/api/appointments/${third.id}/queue-exit`,null,exitBody,'POST',thirdToken)
  ]);
  assert.equal(race.filter(value=>value.status===200).length,1,JSON.stringify(race));
  assert.equal(race.filter(value=>value.status===409).length,1,JSON.stringify(race));
  const actualThird=await detail(third.id);
  if(actualThird.status==='in_progress')assert.equal(actualThird.reception.state,'started');
  else {assert.ok(actualThird.reception.leftAt);assert.equal(expect(await request('/api/field/home',tech)).state,'available');}
  // Removing a finished/departed customer cannot reuse their daily arrival number.
  await db.prepare('DELETE FROM booking_requests WHERE appointment_id=?').bind(third.id).run();
  await db.prepare('DELETE FROM attachment_storage WHERE id IN (SELECT id FROM appointment_attachments WHERE appointment_id=?)').bind(third.id).run();
  await db.prepare('DELETE FROM appointment_attachments WHERE appointment_id=?').bind(third.id).run();
  await db.prepare('DELETE FROM appointments WHERE id=?').bind(third.id).run();
  const afterDeletion=expect(await receive(await create(24)));
  assert.equal(afterDeletion.reception.ticket.number,queueBefore+2);
  // Reprinting the creator's receipt is stable, and revoked private credentials stay revoked.
  const form={requestId:crypto.randomUUID(),registrationFlow:'frontdesk',campus:'南湖',name:'凭证验收客户',studentId:'20306925',social:'receipt-check',deviceType:'笔记本电脑',brand:'联想',deviceModel:'凭证验收',warranty:'否',faultType:'系统问题',signature:[Array.from({length:10},(_,i)=>[.1+i*.05,.2+i*.03])]};
  const created=expect(await request('/api/scan/onsite',office,form),201);
  assert.equal(expect(await request('/api/scan/onsite',office,form),201).accessToken,created.accessToken);
  await db.prepare('UPDATE appointments SET access_token_hash=? WHERE id=?').bind('f'.repeat(64),created.id).run();
  assert.equal(expect(await request('/api/scan/onsite',office,form),201).accessToken,null);
  assert.ok((await detail(tail.id)).receptionHistory.some(event=>event.action==='receptions.guest_leave' && event.actorName==='客户本人'));
});

test('repair history, identity snapshots and workload retain both start event names after transfers',async()=>{
  const current='projection-current',legacy='projection-legacy',eventDay='2026-10-16';
  const identity=account=>({memberId:'member-'+account,name:account,identities:[{code:'repair',label:'维修工作人员'}]});
  async function event(id,action,account,assignee){
    await db.prepare('INSERT INTO audit_events(id,actor_member_id,actor_account,action,source_ref,after_json,reason,occurred_at) VALUES(?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(),'member-'+account,account,action,JSON.stringify({module:'repairs',type:'appointment',id}),JSON.stringify({assigneeIdentity:identity(assignee)}),'',eventDay+'T02:00:00.000Z').run();
  }
  const fields=staffPlatformRepository(db),appointments=appointmentRepository(db);
  await event(current,'repairs.started',tech,tech);
  await event(legacy,'repairs.claimed',tech,tech);
  assert.equal((await fields.repairIdentitySnapshot(current)).memberId,'member-'+tech);
  assert.equal((await fields.repairIdentitySnapshot(legacy)).memberId,'member-'+tech);
  await event(current,'repairs.transferred',lead,other);
  assert.deepEqual((await fields.receptionHistory(current)).map(row=>row.action),['repairs.started','repairs.transferred']);
  assert.equal((await fields.repairIdentitySnapshot(current)).memberId,'member-'+other);
  const workloads=await appointments.dailyWorkloads(eventDay);
  assert.deepEqual(workloads['member-'+tech],{started:2,completed:0});
  assert.deepEqual(workloads['member-'+other],{started:1,completed:0});
});


test('historical reception records do not grant today’s office access to customer details',async()=>{
  phase=8;
  for(const status of ['completed','cancelled','expired']) {
    let item=expect(await receive(await create(80+['completed','cancelled','expired'].indexOf(status))));
    await db.prepare("UPDATE appointments SET date='2026-10-14',status=?,outcome=CASE WHEN ?='completed' THEN 'repaired' ELSE NULL END WHERE id=?").bind(status,status,item.id).run();
    await db.prepare('UPDATE appointments SET name=? WHERE id=?').bind('历史专属客户'+status,item.id).run();
    const search=expect(await request('/api/appointments?status=all&q='+encodeURIComponent('历史专属客户'+status),office));
    assert.equal(search.filteredCounts.all,0);
    expect(await request(`/api/field/appointments/${item.id}`,office),403);
    expect(await request(`/api/appointments/${item.id}/attachments`,office),403);
    assert.ok(!expect(await request('/api/scan/search',office,{q:item.id})).items.some(row=>row.id===item.id));
    assert.ok(!expect(await request('/api/appointments?status=all',office)).items.some(row=>row.id===item.id));
    assert.equal((await detail(item.id,'root001')).name,'历史专属客户'+status);
  }
  const queued=expect(await receive(await create(84)));
  await db.prepare("UPDATE appointments SET date='2026-10-14' WHERE id=?").bind(queued.id).run();
  const carryover=await detail(queued.id);
  assert.equal(carryover.canDispatch,true);
  for(const key of ['name','studentId','social','frontPhotoId','backPhotoId'])assert.equal(carryover[key],undefined,key);
  const body={action:'cancel',revision:carryover.revision,requestId:crypto.randomUUID(),reason:'已联系客户取消历史在场工单'};
  for(let attempt=0;attempt<2;attempt++) {
    const result=expect(await request(`/api/appointments/${queued.id}/reception`,office,body));
    assert.equal(result.resolutionOnly,true);assert.equal(result.status,'cancelled');assert.equal(result.name,undefined);
  }
  expect(await request(`/api/field/appointments/${queued.id}`,office),403);
});

test('followup arrivals retain their capacity exemption and parent credentials can query and leave the child queue',async()=>{
  phase=9;
  const parent=await create(90);
  await db.prepare("UPDATE appointments SET status='completed',outcome='repaired' WHERE id=?").bind(parent.id).run();
  const pending=expect(await request(`/api/appointments/${parent.id}/repair-followups`,null,{reason:'原故障复现，需要返修',requestId:crypto.randomUUID()},'POST',parent.accessToken),201);
  const slots=expect(await request(`/api/repair-followups/slots?campus=${encodeURIComponent('南湖')}&date=${day}`,office)).items;
  assert.ok(slots.length>=3);
  const scheduled=expect(await request(`/api/repair-followups/${pending.id}/decision`,office,{action:'schedule',date:day,timeSlot:slots[0],revision:pending.revision,requestId:crypto.randomUUID()}));
  let child=expect(await receive(await detail(scheduled.appointmentId)));
  const filler=await create(91);
  const occupied=(await db.prepare("SELECT COUNT(*) n FROM appointments WHERE source='booking' AND date=? AND time_slot=? AND status<>'cancelled'").bind(day,slots[1]).first()).n;
  await db.prepare('UPDATE booking_day_slots SET capacity=? WHERE campus=? AND date=? AND time_slot=?').bind(occupied+1,'南湖',day,slots[1]).run();
  await db.prepare("UPDATE appointments SET source='booking',time_slot=? WHERE id=?").bind(slots[1],filler.id).run();
  const regular=expect(await receive(await create(92)));
  await db.prepare("INSERT OR IGNORE INTO booking_day_slots VALUES('南湖',?,'19:00–20:00',10)").bind(day).run();
  const regularOptions=expect(await request(`/api/appointments/${regular.id}/reception-options`,office)).items;
  assert.ok(!regularOptions.some(option=>option.timeSlot===slots[1]));
  assert.ok(!regularOptions.some(option=>option.timeSlot==='19:00–20:00'));
  assert.ok(!regularOptions.some(option=>option.timeSlot===regular.timeSlot && option.date===regular.date));
  expect(await command(regular,office,'reschedule',{date:day,timeSlot:slots[1],reason:'测试已满时段'}),409);
  const options=expect(await request(`/api/appointments/${child.id}/reception-options`,office)).items;
  assert.ok(options.some(option=>option.timeSlot===slots[1]));
  await db.prepare("UPDATE service_locations SET location='新维修地点',revision=revision+1 WHERE campus='南湖' AND date=?").bind(day).run();
  child=expect(await command(child,office,'reschedule',{date:day,timeSlot:slots[1],reason:'客户确认改到稍后时段'}));
  assert.equal(child.source,'onsite');assert.equal(child.registrationFlow,'repair_followup');
  const stored=await appointmentRepository(db).find(child.id);
  assert.equal(stored.locationSnapshot,'新维修地点');
  assert.equal(stored.locationRevision,(await appointmentRepository(db).location(day,'南湖')).revision);
  assert.equal((await db.prepare("SELECT COUNT(*) n FROM appointments WHERE source='booking' AND date=? AND time_slot=? AND status<>'cancelled'").bind(day,slots[1]).first()).n,occupied+1);
  const moved=expect(await command(regular,office,'reschedule',{date:day,timeSlot:slots[2],reason:'普通改约到开放时段'}));
  assert.equal(moved.source,'booking');
  const normal=await appointmentRepository(db).find(moved.id);
  assert.equal(normal.locationSnapshot,'新维修地点');
  assert.equal(normal.locationRevision,stored.locationRevision);
  child=expect(await receive(child));
  const publicParent=expect(await request(`/api/appointments/${parent.id}`,null,undefined,'GET',parent.accessToken));
  const publicChild=publicParent.repairHistory.items.find(item=>item.id===child.id);
  assert.equal(publicChild.queuePosition.position,child.queuePosition.position);
  assert.equal(publicChild.location,'新维修地点');
  assert.equal(publicChild.locationSnapshot,'新维修地点');
  assert.equal(activeRepairFollowup(publicParent.repairHistory,'2026-10-16T10:00:00+08:00')?.scheduledAppointmentId,child.id,'arrived followups remain current across the original deadline');
  const board=expect(await request('/api/field/board',office));
  assert.equal(board.appointments.find(row=>row.id===child.id).registrationFlow,'repair_followup');
  assert.equal(publicChild.reception.ticket.number,child.reception.ticket.number);
  for(const key of ['receivedBy','assignedTo','assignedMemberId','ticketId'])assert.equal(publicChild.reception[key],undefined,key);
  const path=`/api/appointments/${parent.id}/repair-followups/${pending.id}/queue-exit`;
  const body={revision:child.revision,requestId:crypto.randomUUID()};
  expect(await request(path,null,body,'POST',filler.accessToken),404);
  expect(await request(`/api/appointments/${filler.id}/repair-followups/${pending.id}/queue-exit`,null,body,'POST',filler.accessToken),404);
  expect(await request(`/api/appointments/${child.id}/queue-exit`,null,body,'POST',parent.accessToken),404);
  for(let attempt=0;attempt<2;attempt++)expect(await request(path,null,body,'POST',parent.accessToken));
  child=await detail(child.id);assert.equal(child.reception.state,'closed');assert.ok(child.reception.leftAt);
  child=expect(await receive(child));
  expect(await request(path,null,body,'POST',parent.accessToken));
  assert.equal((await detail(child.id)).reception.state,'queued','old receipt must not leave a new arrival');
  const originalHash=(await db.prepare('SELECT access_token_hash FROM appointments WHERE id=?').bind(parent.id).first()).access_token_hash;
  await db.prepare("UPDATE appointments SET access_token_hash=? WHERE id=?").bind('a'.repeat(64),parent.id).run();
  expect(await request(path,null,{revision:child.revision,requestId:crypto.randomUUID()},'POST',parent.accessToken),404);
  const repository=appointmentRepository(db),before=await repository.find(child.id);
  const raced=await repository.update(before,{status:'booked'},undefined,{actor:{memberId:null,account:null},action:'receptions.guest_leave',auditId:crypto.randomUUID(),requestId:crypto.randomUUID(),guestCredentialHash:originalHash,guestParentId:parent.id,guestFollowupId:pending.id,at:new Date(now).toISOString(),reason:'轮换竞争测试',reception:{state:'closed',leftAt:new Date(now).toISOString()}});
  assert.equal(raced,null);assert.equal((await repository.find(child.id)).reception.state,'queued');
  await db.prepare('UPDATE appointments SET access_token_hash=? WHERE id=?').bind(originalHash,parent.id).run();
  await db.prepare("UPDATE appointments SET status='completed',outcome='repaired' WHERE id=?").bind(child.id).run();
  const next=expect(await request(`/api/appointments/${child.id}/repair-followups/staff`,'root001',{reason:'再次返修验证多轮私人链接',requestId:crypto.randomUUID()}),201);
  const grandchild=expect(await request(`/api/repair-followups/${next.id}/decision`,office,{action:'schedule',date:day,timeSlot:slots[2],revision:next.revision,requestId:crypto.randomUUID()}));
  const arrived=expect(await receive(await detail(grandchild.appointmentId)));
  assert.equal(expect(await request(`/api/appointments/${parent.id}/repair-followups/${next.id}/scan-code`,null,undefined,'GET',parent.accessToken)).id,arrived.id);
  const grandchildPath=`/api/appointments/${parent.id}/repair-followups/${next.id}/queue-exit`;
  expect(await request(grandchildPath,null,{revision:arrived.revision,requestId:crypto.randomUUID()},'POST',parent.accessToken));
  await db.prepare("UPDATE appointments SET expires_at='2026-10-15T01:59:00.000Z' WHERE id=?").bind(arrived.id).run();
  const expired=expect(await request(`/api/appointments/${parent.id}`,null,undefined,'GET',parent.accessToken));
  assert.equal(expired.repairHistory.items.find(row=>row.id===arrived.id).status,'expired');
  await db.prepare('UPDATE booking_day_slots SET capacity=10 WHERE campus=? AND date=? AND time_slot=?').bind('南湖',day,slots[1]).run();
});
