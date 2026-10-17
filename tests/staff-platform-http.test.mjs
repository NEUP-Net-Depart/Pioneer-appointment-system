import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare } from 'miniflare';
import { config, wrangler } from '../scripts/cli.mjs';
import { hashPassword } from '../src/lib/passwords.js';
import { dateKey, addDays } from '../shared/time.js';
import { staffPlatformRepository } from '../src/db/staff-platform.js';
import { userRepository } from '../src/db/users.js';

let mf;
async function applyMigration(database, file) {
  const sql = (await readFile(`migrations/${file}`, 'utf8')).replace(/--[^\n]*/g, '');
  const statements = []; let buffer = '';
  for (const line of sql.split('\n')) {
    buffer = `${buffer}\n${line}`.trim();
    if (buffer && (buffer.startsWith('CREATE TRIGGER') ? line.trim() === 'END;' : line.trim().endsWith(';'))) { statements.push(buffer); buffer = ''; }
  }
  assert.equal(buffer, '', `Incomplete migration: ${file}`);
  await database.batch(statements.map(statement => database.prepare(statement)));
}

before(async () => {
  const cfg = await config();
  wrangler(['pages','functions','build','functions','--outdir','.wrangler/staff-platform-test-build','--compatibility-date',cfg.compatibility_date,'--compatibility-flags',...cfg.compatibility_flags]);
  mf = new Miniflare({ telemetry: { enabled: false }, workers: [{ config: {
    name: 'pioneer-staff-platform-tests', compatibilityDate: cfg.compatibility_date, compatibilityFlags: cfg.compatibility_flags,
    manifest: { mainModule: 'index.js', modules: { 'index.js': { type: 'esm', contents: await readFile('.wrangler/staff-platform-test-build/index.js', 'utf8') } } },
    env: { DB: { type: 'd1', id: 'staff-platform-tests' }, ATTACHMENTS: { type: 'r2', name: 'staff-platform-tests' },
      JWT_SECRET: { type: 'text', value: 'staff-platform-test-secret-012345678901' }, PII_ENCRYPTION_KEY: { type: 'text', value: '0123456789012345678901234567890101234567890123456789012345678901' } }
  } }] });
  const database = await mf.getD1Database('DB');
  for (const file of (await readdir('migrations')).filter(file => file.endsWith('.sql')).sort()) await applyMigration(database, file);
  await database.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES(?,?,?,?,?,?,?)')
    .bind('root001', '系统负责人', 'superadmin', '南湖', 1, hashPassword('staff-platform-password'), dateKey()).run();
  await database.batch(['南湖','浑南'].map(campus => database.prepare('INSERT INTO staff_campus_grants VALUES (?,?)').bind('root001', campus)));
});
after(async () => mf?.dispose());

test('stale member, role, binding and attendance commands leave all related rows unchanged', async () => {
  const db = await mf.getD1Database('DB');
  const repository = staffPlatformRepository(db);
  await db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,?,?,?,?,?)')
    .bind('20268801', '并发测试成员', 'technician', '南湖', hashPassword('cas-test-password'), dateKey()).run();
  const memberId = await repository.ensureMember('20268801');
  const original = await repository.memberRow(memberId);
  const member = await repository.updateMember(memberId, { name: '正确更新' }, original.revision);
  const accountBefore = await repository.accountRow('20268801');
  assert.equal(await repository.updateMember(memberId, { name: '过期覆盖', status: 'inactive' }, original.revision), null);
  assert.deepEqual(await repository.accountRow('20268801'), accountBefore);
  assert.deepEqual(await repository.memberRow(memberId), member);

  const role = await repository.createRole({ code: 'cas-role', name: '并发测试角色', level: 1,
    grants: [{ permissionCode: 'attendance.self', scope: { self: true }, conditions: [], validity: {} }] });
  assert.equal(await repository.bindRoles(memberId, [{ roleId: role.id, scope: { campusIds: ['campus-nanhu'] }, effectiveFrom: '2026-01-01' }], member.revision), true);
  const bindingsBefore = await repository.roleBindings(memberId);
  const boundAccount = await repository.accountRow('20268801');
  assert.equal(await repository.bindRoles(memberId, [], member.revision), false);
  assert.deepEqual(await repository.roleBindings(memberId), bindingsBefore);
  assert.deepEqual(await repository.accountRow('20268801'), boundAccount);

  const updatedRole = await repository.updateRole(role.id, { name: '已更新角色' }, role.revision);
  const roleAccount = await repository.accountRow('20268801');
  assert.equal(await repository.updateRole(role.id, { grants: [] }, role.revision), null);
  assert.deepEqual((await repository.listRoles()).find(item => item.id === role.id), updatedRole);
  assert.deepEqual(await repository.accountRow('20268801'), roleAccount);

  const event = await repository.createEvent({ type: 'meeting', policyCode: 'meeting', policyVersion: 1,
    businessDate: dateKey(), startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 3600000).toISOString() }, memberId);
  await repository.issueToken(event.id, 'cas-token-first', new Date(Date.now() + 300000).toISOString(), memberId, event.revision);
  const tokens = (await db.prepare('SELECT * FROM attendance_tokens WHERE event_id=? ORDER BY id').bind(event.id).all()).results;
  assert.equal(await repository.issueToken(event.id, 'cas-token-stale', new Date(Date.now() + 300000).toISOString(), memberId, event.revision), null);
  assert.deepEqual((await db.prepare('SELECT * FROM attendance_tokens WHERE event_id=? ORDER BY id').bind(event.id).all()).results, tokens);

  await repository.setPresence(memberId, { businessDate: dateKey(), state: 'available', campusId: 'campus-nanhu' }, 0, { memberId, account: '20268801' });
  await repository.setPresence(memberId, { businessDate: dateKey(), state: 'off_duty' }, 0, { memberId, account: '20268801' });
  const presenceEvents = (await db.prepare('SELECT * FROM presence_events WHERE member_id=? ORDER BY id').bind(memberId).all()).results;
  assert.equal(await repository.setPresence(memberId, { businessDate: dateKey(), state: 'available' }, 0, { memberId, account: '20268801' }), null);
  assert.deepEqual((await db.prepare('SELECT * FROM presence_events WHERE member_id=? ORDER BY id').bind(memberId).all()).results, presenceEvents);
});

async function request(path, options = {}) {
  const response = await mf.dispatchFetch(`https://staff.test${path}`, { ...options, headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const body = await response.json();
  return { response, body };
}

test('staff platform auth context, modular permissions and policy attendance are wired end to end', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ account: 'root001', password: 'staff-platform-password' }) });
  assert.equal(login.response.status, 200, JSON.stringify(login.body));
  const headers = { Authorization: `Bearer ${login.body.token}` };
  const context = await request('/api/auth/me', { headers });
  assert.equal(context.response.status, 200, JSON.stringify(context.body));
  assert.equal(context.body.actor.memberId, 'member-root001');
  assert.ok(context.body.grants.some(grant => grant.permissionCode === 'attendance.session.manage'));
  assert.ok(context.body.modules.some(module => module.code === 'meetings' && module.contractVersion === '1'));

  const campuses = await request('/api/organization/campuses', { headers });
  assert.equal(campuses.response.status, 200);
  assert.deepEqual(campuses.body.items.map(item => item.id), ['campus-nanhu', 'campus-hunnan']);
  const detail = await request('/api/members/member-root001', { headers });
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.account.account, 'root001');
  const preview = await request('/api/members/import', { method: 'POST', headers, body: JSON.stringify({ csv: 'studentId,name,homeCampusId\n"900001","张三,成员",campus-nanhu' }) });
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.mode, 'preview');
  const imported = await request('/api/members/import', { method: 'POST', headers, body: JSON.stringify({ confirm: true, csv: 'studentId,name,homeCampusId\n"900001","张三,成员",campus-nanhu' }) });
  assert.equal(imported.response.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.count, 1);

  const permissions = await request('/api/permissions', { headers });
  assert.equal(permissions.response.status, 200);
  assert.ok(permissions.body.items.some(permission => permission.code === 'repair.start'));

  const now = Date.now();
  const event = await request('/api/attendance/events', { method: 'POST', headers, body: JSON.stringify({
    type: 'duty', campusId: 'campus-nanhu', businessDate: dateKey(), startsAt: new Date(now - 60_000).toISOString(), endsAt: new Date(now + 3_600_000).toISOString(), requestId: 'attendance-event-001'
  }) });
  assert.equal(event.response.status, 201, JSON.stringify(event.body));
  const token = await request(`/api/attendance/events/${event.body.id}/token`, { method: 'POST', headers, body: JSON.stringify({ revision: event.body.revision }) });
  assert.equal(token.response.status, 200, JSON.stringify(token.body));
  const attendancePreview = await request('/api/attendance/preview', { method: 'POST', headers, body: JSON.stringify({ token: token.body.token }) });
  assert.equal(attendancePreview.response.status, 200);
  const beforeConfirmation = await request('/api/me/attendance', { headers });
  assert.equal(beforeConfirmation.body.items.length, 0, 'preview must not create attendance');
  const futureEvent = await request('/api/attendance/events', { method: 'POST', headers, body: JSON.stringify({ type: 'duty', campusId: 'campus-hunnan', businessDate: dateKey(), startsAt: new Date(now + 3_600_000).toISOString(), endsAt: new Date(now + 7_200_000).toISOString(), requestId: 'attendance-future-preview' }) });
  const futureToken = await request(`/api/attendance/events/${futureEvent.body.id}/token`, { method: 'POST', headers, body: JSON.stringify({ revision: futureEvent.body.revision }) });
  for (const endpoint of ['preview', 'check-ins']) {
    const invalid = await request(`/api/attendance/${endpoint}`, { method: 'POST', headers, body: JSON.stringify({ token: futureToken.body.token }) });
    assert.equal(invalid.response.status, 409, 'preview and confirmation must share attendance-window validation');
  }
  const first = await request('/api/attendance/check-ins', { method: 'POST', headers, body: JSON.stringify({ token: token.body.token, method: 'qr', requestId: 'attendance-checkin-001' }) });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  const duplicate = await request('/api/attendance/check-ins', { method: 'POST', headers, body: JSON.stringify({ token: token.body.token, method: 'nfc' }) });
  assert.equal(duplicate.response.status, 200, JSON.stringify(duplicate.body));
  assert.equal(duplicate.body.isExisting, true);
  const records = await request('/api/me/attendance', { headers });
  assert.equal(records.response.status, 200);
  assert.equal(records.body.items.length, 1);
  const exportResponse = await mf.dispatchFetch(`https://staff.test/api/attendance/export.csv?month=${dateKey().slice(0, 7)}`, { headers });
  assert.equal(exportResponse.status, 200);
  assert.match(await exportResponse.text(), /校区,人员,学号,签到次数,部门/);
  const presenceEvents = await (await mf.getD1Database('DB')).prepare("SELECT COUNT(*) AS total FROM presence_events WHERE member_id='member-root001'").first();
  assert.equal(presenceEvents.total, 1);
});

test('attendance corrections commit atomically, preserve historical scope and cannot be widened through query fields', async () => {
  const db = await mf.getD1Database('DB'), repository = staffPlatformRepository(db), today = dateKey(), day = addDays(today,-1);
  for (const [account,role,campus] of [['20269710','admin','南湖'],['20269711','technician','南湖'],['20269712','admin','南湖'],['20269713','technician','浑南'],['20269714','admin','浑南']]) {
    await db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,?,?,?,?,?)')
      .bind(account,`考勤范围${account}`,role,campus,hashPassword('attendance-scope-password'),'2026-01-01').run();
    await db.prepare('INSERT INTO staff_campus_grants VALUES(?,?)').bind(account,campus).run();
  }
  await db.prepare("INSERT INTO staff_campus_grants VALUES('20269710','浑南')").run();
  const leadTask = await repository.createRosterTask({weekStart:today,slotStart:'01:02',slotEnd:'01:03',deadline:today,memberIds:['member-20269710'],campusScope:{campusIds:['campus-nanhu','campus-hunnan']}},'member-root001');
  const leadVersion = await repository.createRosterVersion({taskId:leadTask.id,status:'published',assignments:[
    {memberId:'member-20269710',businessDate:today,campusId:'campus-nanhu',dutyType:'repair',startAt:'00:10',endAt:'00:20',roleKind:'repair_lead'},
    {memberId:'member-20269710',businessDate:today,campusId:'campus-hunnan',dutyType:'office',startAt:'00:30',endAt:'00:40',roleKind:'office_lead'}
  ]});
  const roles = [];
  for (const [campusId,departmentId] of [['campus-nanhu','dept-hardware'],['campus-hunnan','dept-office']]) roles.push(await repository.createRole({
    code:`attendance-scope-${campusId}`,name:'考勤范围角色',grants:['attendance.correct','attendance.export'].map(permissionCode => ({
      permissionCode,scope:{campusIds:[campusId],departmentIds:[departmentId]},conditions:permissionCode==='attendance.correct' ? [{code:'activeDutyRole',parameters:{}}] : []
    }))
  }));
  await repository.bindRoles('member-20269710',roles.map(role => ({roleId:role.id,scope:{},effectiveFrom:'2026-01-01'})),0);
  async function login(account,password) {
    const result = await request('/api/auth/login',{method:'POST',body:JSON.stringify({account,password})});
    assert.equal(result.response.status,200,JSON.stringify(result.body));return {Authorization:`Bearer ${result.body.token}`};
  }
  const root = await login('root001','staff-platform-password'), scoped = await login('20269710','attendance-scope-password');
  const events = {};
  for (const campusId of ['campus-nanhu','campus-hunnan']) events[campusId] = await repository.createEvent({type:'duty',policyCode:'duty.v1',policyVersion:'1.0.0',businessDate:day,campusId,startsAt:`${day}T08:00:00+08:00`,endsAt:`${day}T22:00:00+08:00`},'member-root001');
  const input = {memberId:'member-20269711',eventId:events['campus-nanhu'].id,occurredAt:`${day}T10:00:00+08:00`,reason:'核对纸质签到后补录',requestId:crypto.randomUUID()};
  const send = (body,headers=root) => request('/api/attendance/corrections',{method:'POST',headers,body:JSON.stringify(body)});
  for (const failure of ['audit','receipt']) {
    await db.prepare(failure==='audit'
      ? "CREATE TRIGGER reject_attendance_correction BEFORE INSERT ON audit_events WHEN NEW.action='attendance.corrected' BEGIN SELECT RAISE(ABORT,'ATTENDANCE_AUDIT_FAILURE'); END"
      : "CREATE TRIGGER reject_attendance_correction BEFORE UPDATE ON operation_receipts WHEN NEW.action='attendance.correct' AND NEW.result_status='success' BEGIN SELECT RAISE(ABORT,'ATTENDANCE_RECEIPT_FAILURE'); END").run();
    try {
      assert.equal((await send(input)).response.status,500);
      assert.equal(await repository.findAttendanceByDedupe(`duty:${input.memberId}:${day}`),null);
      assert.equal(await repository.receipt('member-root001','attendance.correct',input.requestId),null);
      assert.equal((await repository.listAudit({action:'attendance.corrected'})).length,0);
    } finally { await db.prepare('DROP TRIGGER reject_attendance_correction').run(); }
  }
  const accepted = await Promise.all([send(input),send(input)]);
  assert.ok(accepted.every(row => row.response.status===201),JSON.stringify(accepted.map(row => row.body)));
  assert.equal(accepted[0].body.id,accepted[1].body.id);
  assert.equal(accepted[0].body.nonScheduled,true);
  assert.equal(accepted[0].body.primaryDepartmentIdSnapshot,'dept-hardware');
  assert.equal((await repository.listAudit({action:'attendance.corrected'})).length,1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM staff_presence WHERE member_id=?').bind(input.memberId).first()).total,0,'Historical correction must not make a member available now');
  assert.equal((await send({...input,reason:'同键不同内容'})).response.status,409);
  assert.equal((await send({...input,requestId:crypto.randomUUID()})).response.status,409);
  const original=accepted[0].body;
  const correction={...input,recordId:original.id,revision:original.revision,occurredAt:`${day}T10:15:00+08:00`,reason:'核查实际到岗时间',requestId:crypto.randomUUID()};
  const revised=await send(correction);assert.equal(revised.response.status,201,JSON.stringify(revised.body));
  assert.equal(revised.body.revision,original.revision+1);assert.deepEqual(revised.body.identitySnapshot,original.identitySnapshot);assert.equal(revised.body.primaryDepartmentIdSnapshot,original.primaryDepartmentIdSnapshot);
  assert.equal((await send(correction)).body.idempotent,true);
  assert.equal((await send({...correction,requestId:crypto.randomUUID()})).response.status,409);
  assert.equal((await send({...input,memberId:'member-20269712',requestId:crypto.randomUUID()},scoped)).response.status,403,'Matching campus cannot borrow another grant department');
  assert.equal((await send({...input,memberId:'member-20269713',eventId:events['campus-hunnan'].id,campusId:'campus-nanhu',requestId:crypto.randomUUID()},scoped)).response.status,400,'Body campus cannot spoof the actual event');
  assert.equal((await send({...input,memberId:'member-20269713',eventId:events['campus-hunnan'].id,requestId:crypto.randomUUID()},scoped)).response.status,403);
  assert.equal((await send({...input,memberId:'member-20269712',occurredAt:`${day}T07:59:00+08:00`,requestId:crypto.randomUUID()})).response.status,400);
  for (const [account,campusId] of [['20269712','campus-nanhu'],['20269713','campus-hunnan'],['20269714','campus-hunnan']]) {
    const result = await send({...input,memberId:`member-${account}`,eventId:events[campusId].id,requestId:crypto.randomUUID()});
    assert.equal(result.response.status,201,JSON.stringify(result.body));
  }
  // A later department move must not rewrite the department of the old fact.
  await db.prepare("UPDATE member_department_memberships SET effective_to=? WHERE member_id='member-20269711'").bind(today).run();
  await db.prepare("INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,effective_from,created_at) VALUES('attendance-move','member-20269711','dept-office','primary',1,?,?)").bind(today,today).run();
  const overnight = await repository.createEvent({type:'meeting',policyCode:'meeting.v1',policyVersion:'1.0.0',businessDate:day,campusId:'campus-nanhu',
    startsAt:`${day}T23:30:00+08:00`,endsAt:`${today}T01:00:00+08:00`,ruleSnapshot:{participantMemberIds:[input.memberId]}},'member-root001');
  const overnightCorrection = await send({...input,eventId:overnight.id,occurredAt:`${today}T00:00:00+08:00`,requestId:crypto.randomUUID()});
  assert.equal(overnightCorrection.response.status,201,JSON.stringify(overnightCorrection.body));
  assert.equal(overnightCorrection.body.primaryDepartmentIdSnapshot,'dept-office','Cross-midnight corrections use the department at occurrence time');
  assert.equal(overnightCorrection.body.businessDate,day,'An event keeps its own business-date grouping');
  assert.equal((await send({...input,memberId:'member-20269712',eventId:overnight.id,occurredAt:`${today}T00:00:00+08:00`,requestId:crypto.randomUUID()})).response.status,403,'Correction reuses the event participant policy for the target member');
  const listed = await request(`/api/attendance?all=1&businessDate=${day}`,{headers:scoped});
  assert.equal(listed.response.status,200,JSON.stringify(listed.body));
  assert.deepEqual(listed.body.items.map(row => row.memberId).sort(),['member-20269711','member-20269714']);
  const exported = await mf.dispatchFetch(`https://staff.test/api/attendance/export.csv?month=${day.slice(0,7)}`,{headers:scoped});
  assert.equal(exported.status,200);const csv=await exported.text();
  assert.match(csv,/20269711/);assert.match(csv,/20269714/);assert.doesNotMatch(csv,/20269712|20269713/);
  const own = await request('/api/me/attendance?all=1&memberId=member-20269711',{headers:root});
  assert.ok(own.body.items.every(row => row.memberId==='member-root001'));
  // Validate the command boundary independently: a change after service reads
  // must leave neither a historical fact nor a pending retry receipt.
  const guardedEvent = await repository.createEvent({type:'duty',policyCode:'duty.v1',policyVersion:'1.0.0',businessDate:addDays(day,-1),campusId:'campus-nanhu',startsAt:`${addDays(day,-1)}T08:00:00+08:00`,endsAt:`${addDays(day,-1)}T22:00:00+08:00`},'member-root001');
  const audit = {actorMemberId:'member-20269710',actorAccount:'20269710',authVersion:(await repository.accountRow('20269710')).auth_version,businessDate:today,action:'attendance.corrected',reason:'边界校验'};
  const receipt = {id:crypto.randomUUID(),action:'attendance.correct',hash:'validated-body-hash'};
  const record = {id:crypto.randomUUID(),memberId:input.memberId,eventId:guardedEvent.id,dedupeKey:`duty:${input.memberId}:${guardedEvent.businessDate}`,occurredAt:`${guardedEvent.businessDate}T02:00:00.000Z`,recordedAt:new Date().toISOString(),departmentId:'dept-hardware',identitySnapshot:{name:'历史姓名'},nonScheduled:true};
  for (const change of ['duty','event','authorization']) {
    const snapshot = await repository.attendanceCorrectionFingerprint(record.memberId,record.eventId,audit.actorMemberId,today,record.occurredAt);
    if (change==='duty') await db.prepare("UPDATE roster_versions SET status='superseded' WHERE id=?").bind(leadVersion.id).run();
    if (change==='event') await db.prepare('UPDATE attendance_events SET revision=revision+1 WHERE id=?').bind(guardedEvent.id).run();
    if (change==='authorization') await db.prepare("UPDATE staff_accounts SET auth_version=auth_version+1 WHERE account='20269710'").run();
    assert.equal(await repository.correctAttendance(record,audit,receipt,snapshot),null,change);
    assert.equal(await repository.receipt(audit.actorMemberId,receipt.action,receipt.id),null,change);
    assert.equal(await repository.findAttendanceByDedupe(record.dedupeKey),null,change);
    if (change==='duty') await db.prepare("UPDATE roster_versions SET status='published' WHERE id=?").bind(leadVersion.id).run();
  }
});

test('attendance keyset pagination returns every same-time historical fact without duplicates', async () => {
  const db = await mf.getD1Database('DB'), day = dateKey(), statements=[];
  for (let index=0;index<205;index++) {
    const id=`attendance-page-${String(index).padStart(3,'0')}`,event=`event-${id}`;
    statements.push(db.prepare("INSERT INTO attendance_events(id,type,policy_code,policy_version,campus_id,business_date,starts_at,ends_at,source_ref,created_at) VALUES(?,'meeting','meeting.v1','1.0.0','campus-nanhu',?,?,?,?,?)")
      .bind(event,day,`${day}T00:00:00.000Z`,`${day}T23:59:59.000Z`,'{}',`${day}T10:00:00.000Z`));
    statements.push(db.prepare("INSERT INTO attendance_records(id,member_id,event_id,dedupe_key,occurred_at,recorded_at,method,source_ref,primary_department_id_snapshot,identity_snapshot) VALUES(?,'member-root001',?,?,?,?,'qr','{}','dept-office','{}')")
      .bind(id,event,`meeting:member-root001:${event}`,`${day}T10:00:00.000Z`,`${day}T10:00:00.000Z`));
  }
  for(let index=0;index<statements.length;index+=60) await db.batch(statements.slice(index,index+60));
  const login=await request('/api/auth/login',{method:'POST',body:JSON.stringify({account:'root001',password:'staff-platform-password'})});
  const headers={Authorization:`Bearer ${login.body.token}`},seen=[];let cursor='',pages=0;
  do {
    const page=await request(`/api/me/attendance?${new URLSearchParams({type:'meeting',...(cursor ? {cursor} : {})})}`,{headers});
    assert.equal(page.response.status,200,JSON.stringify(page.body));
    assert.equal(page.body.items.length,pages<2 ? 100 : 5);
    seen.push(...page.body.items.map(row => row.id));cursor=page.body.nextCursor;pages++;
  }while(cursor);
  assert.equal(new Set(seen).size,205);
  assert.deepEqual(seen,[...seen].sort().reverse());
});

test('member reads, searches and writes share complete grants without mixing campus and department scopes', async () => {
  const db = await mf.getD1Database('DB'), repository = staffPlatformRepository(db), today = dateKey();
  async function account(id, campus, role = 'technician') {
    await db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,?,?,?,?,?)')
      .bind(id, `范围测试${id}`, role, campus, hashPassword('scope-test-password'), today).run();
    await db.prepare('INSERT INTO staff_campus_grants VALUES(?,?)').bind(id, campus).run();
    return `member-${id}`;
  }
  const actorId = await account('20269910', '南湖');
  await db.prepare("INSERT INTO staff_campus_grants VALUES('20269910','浑南')").run();
  const nanhuHardware = await account('20269911', '南湖'), hunnanHardware = await account('20269912', '浑南');
  const nanhuOffice = await account('20269913', '南湖', 'admin'), hunnanOffice = await account('20269914', '浑南', 'admin');
  const futureMember = await account('20269915', '南湖');
  await db.prepare('UPDATE member_department_memberships SET effective_from=? WHERE member_id=?').bind(addDays(today, 1), futureMember).run();
  const role = await repository.createRole({ code: 'scoped-member-test', name: '范围测试管理', grants: [
    { permissionCode: 'members.manage', scope: { campusIds: ['campus-nanhu'], departmentIds: ['dept-hardware'] } },
    { permissionCode: 'attendance.export', scope: { campusIds: ['campus-hunnan'], departmentIds: ['dept-office'] } }
  ] });
  const extraRole = await repository.createRole({ code: 'scoped-member-extra', name: '另一完整范围', grants: [
    { permissionCode: 'members.manage', scope: { campusIds: ['campus-hunnan'], departmentIds: ['dept-office'] }, validity: { effectiveTo: '2001-01-01' } }
  ] });
  await repository.bindRoles(actorId, [role, extraRole].map(item => ({ roleId: item.id, scope: {}, effectiveFrom: today })), 0);
  async function loginScope() {
    const result = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ account: '20269910', password: 'scope-test-password' }) });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    return { Authorization: `Bearer ${result.body.token}` };
  }
  let headers = await loginScope();
  let result = await request('/api/members?q=范围测试', { headers });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.items.map(item => item.memberId), [actorId, nanhuHardware]);
  assert.deepEqual((await request('/api/members?q=20269912', { headers })).body.items, []);
  assert.deepEqual((await request('/api/members?homeCampusId=campus-hunnan', { headers })).body.items, []);
  assert.deepEqual((await request(`/api/members/${nanhuHardware}/memberships?businessDate=${today}`, { headers })).body.items.map(item => item.departmentId), ['dept-hardware']);
  for (const memberId of [hunnanHardware, nanhuOffice, hunnanOffice, futureMember]) {
    assert.equal((await request(`/api/members/${memberId}`, { headers })).response.status, 403);
    assert.equal((await request(`/api/members/${memberId}`, { headers, method: 'PATCH', body: JSON.stringify({ name: '禁止覆盖', revision: 0 }) })).response.status, 403);
    assert.notEqual((await repository.memberRow(memberId)).name, '禁止覆盖');
  }
  assert.equal((await request(`/api/members/${nanhuHardware}`, { headers, method: 'PATCH', body: JSON.stringify({ homeCampusId: 'campus-hunnan', revision: 0 }) })).response.status, 403);
  assert.equal((await request(`/api/members/${nanhuHardware}/memberships`, { headers, method: 'POST', body: JSON.stringify({ departmentId: 'dept-office', effectiveFrom: today, revision: 0 }) })).response.status, 403);
  await db.prepare(`INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,effective_from,created_at)
    VALUES('cross-office-membership',?,'dept-office','secondary',0,?,?)`).bind(nanhuHardware, today, today).run();
  assert.equal((await request(`/api/members/${nanhuHardware}/memberships/cross-office-membership`, { headers, method: 'PATCH', body: JSON.stringify({ effectiveTo: addDays(today, 1), revision: 0 }) })).response.status, 403);

  // Explicit aliases reuse an existing person without seeding roles or an orphan member.
  await db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,member_id) VALUES(?,?,?,?,?,?,?)')
    .bind('20269916', '其他登录名称', 'technician', '南湖', hashPassword('scope-test-password'), today, nanhuHardware).run();
  assert.equal(await repository.memberRow('member-20269916'), null);
  await assert.rejects(db.prepare("UPDATE staff_accounts SET member_id=? WHERE account='20269916'").bind(actorId).run(), /MEMBER_MAPPING_IMMUTABLE/);
  const aliasSearch = await request('/api/members?q=20269916&status=active', { headers });
  assert.deepEqual(aliasSearch.body.items.map(item => item.memberId), [nanhuHardware]);

  const grants = [{ permissionCode: 'members.manage', scope: { campusIds: ['campus-hunnan'], departmentIds: ['dept-office'] } }];
  await repository.updateRole(extraRole.id, { grants }, extraRole.revision);
  assert.equal((await request('/api/members', { headers })).response.status, 401);
  headers = await loginScope();
  result = await request('/api/members?q=范围测试', { headers });
  assert.deepEqual(result.body.items.map(item => item.memberId), [actorId, nanhuHardware, hunnanOffice]);
  for (const memberId of [hunnanHardware, nanhuOffice]) assert.equal((await request(`/api/members/${memberId}`, { headers })).response.status, 403);
  assert.equal((await request(`/api/members/${hunnanOffice}`, { headers })).response.status, 200);
});

test('member pagination fills authorized pages, keeps tied names stable and never exposes hidden cursor records', async () => {
  const db = await mf.getD1Database('DB'), repository = staffPlatformRepository(db), today = dateKey();
  await db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,?,?,?,?,?)')
    .bind('20269920', '分页管理员', 'technician', '南湖', hashPassword('pagination-password'), today).run();
  await db.prepare("INSERT INTO staff_campus_grants VALUES('20269920','南湖')").run();
  const role = await repository.createRole({ code: 'pagination-role', name: '分页管理', grants: [{ permissionCode: 'members.manage', scope: { campusIds: ['campus-nanhu'], departmentIds: ['dept-hardware'] } }] });
  await repository.bindRoles('member-20269920', [{ roleId: role.id, scope: {}, effectiveFrom: today }], 0);
  const statements = [], visibleIds = [];
  for (let index = 0; index < 320; index++) {
    const id = `pagination-${String(index).padStart(3, '0')}`, allowed = index >= 110;
    if (allowed) visibleIds.push(id);
    statements.push(db.prepare('INSERT INTO members(id,name,home_campus_id,created_at,updated_at) VALUES(?,?,?,?,?)')
      .bind(id, `分页夹具${allowed ? '同名成员' : '不可见成员'}`, allowed ? 'campus-nanhu' : 'campus-hunnan', today, today));
    statements.push(db.prepare(`INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,effective_from,created_at)
      VALUES(?,?,'dept-hardware','primary',1,?,?)`).bind(`membership-${id}`, id, today, today));
  }
  // D1 batches remain small enough for production query limits.
  for (let offset = 0; offset < statements.length; offset += 80) await db.batch(statements.slice(offset, offset + 80));
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ account: '20269920', password: 'pagination-password' }) });
  assert.equal(login.response.status, 200, JSON.stringify(login.body));
  const headers = { Authorization: `Bearer ${login.body.token}` }, seen = [];
  let cursor = '', pages = 0;
  do {
    const result = await request(`/api/members?${new URLSearchParams({ q: '分页夹具', ...(cursor ? { cursor } : {}) })}`, { headers });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.items.length, pages < 2 ? 100 : 10);
    seen.push(...result.body.items.map(item => item.memberId));
    cursor = result.body.nextCursor;
    if (cursor) {
      const [name, id] = JSON.parse(decodeURIComponent(cursor));
      assert.equal(name, '分页夹具同名成员');
      assert.equal(id, result.body.items.at(-1).memberId);
    }
    assert.ok(++pages < 5, 'pagination must advance');
  } while (cursor);
  assert.deepEqual(seen, visibleIds);
  assert.equal(new Set(seen).size, 210);
  assert.equal((await request('/api/members?cursor=not-json', { headers })).response.status, 400);
});

test('permission catalog exposes registered parameter schemas and rejects unsupported condition configurations', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ account: 'root001', password: 'staff-platform-password' }) });
  const headers = { Authorization: `Bearer ${login.body.token}` };
  const catalog = await request('/api/permissions', { headers });
  assert.equal(catalog.response.status, 200);
  assert.equal(catalog.body.conditionProviders.find(item => item.code === 'activeDutyRole').parameterSchema.properties.kind.type, 'string');
  for (const condition of [{ code: 'unregistered' }, { code: 'activeDutyRole', version: 2 },
    { code: 'activeDutyRole', parameters: { kind: ['repair_lead'] } }, { code: 'activeDutyRole', parameters: { ignoreCampus: true } }]) {
    const result = await request('/api/roles', { headers, method: 'POST', body: JSON.stringify({ code: 'invalid-condition', name: '无效条件',
      grants: [{ permissionCode: 'members.manage', scope: { campusIds: ['campus-nanhu'] }, conditions: [condition] }] }) });
    assert.equal(result.response.status, 400, JSON.stringify(result.body));
  }
  const result = await request('/api/roles', { headers, method: 'POST', body: JSON.stringify({ code: 'valid-condition', name: '指定岗位条件',
    grants: [{ permissionCode: 'members.manage', scope: { campusIds: ['campus-nanhu'] }, conditions: [{ code: 'activeDutyRole', version: 1, parameters: { kind: 'repair_lead' } }] }] }) });
  assert.equal(result.response.status, 201, JSON.stringify(result.body));
});

test('member status, account status and immutable aliases remain separate and never restore revoked default roles', async () => {
  const db = await mf.getD1Database('DB'), repository = staffPlatformRepository(db), users = userRepository(db), today = dateKey();
  const add = (account, memberId = null) => db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,member_id) VALUES(?,?,?,?,?,?,?)')
    .bind(account, '身份测试', 'technician', '南湖', hashPassword('identity-test-password'), today, memberId).run();
  await add('20269801'); await add('20269802', 'member-20269801');
  await db.batch(['20269801', '20269802'].map(account => db.prepare('INSERT INTO staff_campus_grants VALUES(?,?)').bind(account, '南湖')));
  const signIn = account => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ account, password: 'identity-test-password' }) });
  const first = await signIn('20269801'), alias = await signIn('20269802');
  assert.equal(first.response.status, 200); assert.equal(alias.response.status, 200);
  await users.update(await users.find('20269802'), { status: 'disabled' });
  assert.equal((await repository.memberRow('member-20269801')).status, 'active');
  assert.equal((await signIn('20269801')).response.status, 200);
  assert.equal((await signIn('20269802')).response.status, 401);
  await repository.updateMember('member-20269801', { status: 'inactive' }, 0);
  assert.deepEqual(await users.assignees({ campus: '南湖', q: '2026980' }), []);
  assert.equal((await signIn('20269801')).response.status, 401);
  const headers = { Authorization: `Bearer ${first.body.token}` };
  assert.equal((await request('/api/auth/me', { headers })).response.status, 401);
  await repository.updateMember('member-20269801', { status: 'active', name: '统一姓名' }, 1);
  assert.equal((await users.find('20269802')).status, 'disabled', 'reactivating a member must not enable a disabled login');
  assert.equal((await users.find('20269801')).name, '统一姓名');
  assert.equal((await users.find('20269802')).name, '统一姓名');
  const before = await users.find('20269801');
  await users.update(before, { name: '有效更新' });
  assert.equal(await users.update(before, { name: '过期覆盖', homeCampus: '浑南' }), null);
  assert.equal((await repository.memberRow('member-20269801')).name, '有效更新');
  assert.equal((await users.find('20269802')).homeCampus, '南湖');
  assert.equal((await users.find('20269802')).name, '有效更新');

  await repository.bindRoles('member-20269801', [], (await repository.memberRow('member-20269801')).revision);
  await db.prepare("DELETE FROM staff_accounts WHERE account='20269801'").run();
  await add('20269801');
  assert.deepEqual(await repository.roleBindings('member-20269801'), [], 'recreating a login cannot restore revoked roles');
  assert.equal((await users.find('20269801')).memberId, 'member-20269801');
  await assert.rejects(add('20269803', 'unknown-member'), /MEMBER_NOT_FOUND/);
});

test('role writes reject malformed ranges and protect administrator identities from delegated escalation', async () => {
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ account: 'root001', password: 'staff-platform-password' }) });
  const headers = { Authorization: `Bearer ${login.body.token}` };
  for (const scope of [{ campusIds: 'campus-nanhu' }, { departmentIds: [null] }, { all: 'true' }, { self: 1 }]) {
    const result = await request('/api/roles', { headers, method: 'POST', body: JSON.stringify({ code: 'invalid-scope', name: '错误范围', grants: [{ permissionCode: 'members.manage', scope }] }) });
    assert.equal(result.response.status, 400, JSON.stringify(result.body));
  }
  assert.equal((await request('/api/members/member-root001', { headers, method: 'PATCH', body: JSON.stringify({ revision: 0, status: 'inactive' }) })).response.status, 403);
  assert.equal((await request('/api/members/member-root001/roles', { headers, method: 'PUT', body: JSON.stringify({ revision: 0, bindings: [] }) })).response.status, 403);
  assert.equal((await request('/api/roles/role-superadmin', { headers, method: 'PATCH', body: JSON.stringify({ revision: 0, grants: [] }) })).response.status, 403);
  const db = await mf.getD1Database('DB');
  await db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,?,?,?,?,?)')
    .bind('20269810', '办公管理员', 'admin', '南湖', hashPassword('delegation-password'), dateKey()).run();
  await db.prepare("INSERT INTO staff_campus_grants VALUES('20269810','南湖')").run();
  // Reception no longer receives member administration implicitly. Grant this
  // test editor an explicit campus-scoped capability before testing delegation.
  const repository = staffPlatformRepository(db);
  await repository.ensureMember('20269810');
  const editorRole = await request('/api/roles', { headers, method: 'POST', body: JSON.stringify({ code: 'delegated-member-editor', name: '受委派资料管理员', grants: [{ permissionCode: 'members.manage', scope: { campusIds: ['campus-nanhu'] }, conditions: [] }] }) });
  assert.equal(editorRole.response.status, 201);
  const binding = await request('/api/members/member-20269810/roles', { headers, method: 'PUT', body: JSON.stringify({ revision: 0, bindings: [{ roleId: editorRole.body.id, scope: { campusIds: ['campus-nanhu'] }, effectiveFrom: dateKey() }] }) });
  assert.equal(binding.response.status, 200);
  const admin = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ account: '20269810', password: 'delegation-password' }) });
  const adminHeaders = { Authorization: `Bearer ${admin.body.token}` };
  assert.equal((await request('/api/roles/role-superadmin', { headers: adminHeaders, method: 'PATCH', body: JSON.stringify({ revision: 0, grants: [] }) })).response.status, 403);
  assert.equal((await request('/api/members/member-20269810/roles', { headers: adminHeaders, method: 'PUT', body: JSON.stringify({ revision: 0, bindings: [{ roleId: 'role-superadmin', effectiveFrom: dateKey() }] }) })).response.status, 403);
  for (const csv of ['studentId,name,homeCampusId\n20269811,越界成员,campus-hunnan',
    'studentId,name,homeCampusId,roleCodes\n20269812,越权成员,campus-nanhu,superadmin']) {
    assert.equal((await request('/api/members/import', { headers: adminHeaders, method: 'POST', body: JSON.stringify({ csv, confirm: true }) })).response.status, 403);
  }
  assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM members WHERE student_id IN ('20269811','20269812')").first()).total, 0);
  const disabled = await request('/api/members/member-20269810', { headers: adminHeaders, method: 'PATCH', body: JSON.stringify({ revision: 1, status: 'inactive' }) });
  assert.equal(disabled.response.status, 200, 'a committed self-deactivation must return its successful result');
  assert.equal((await request('/api/auth/me', { headers: adminHeaders })).response.status, 401);
  const audit = await db.prepare("SELECT COUNT(*) AS total FROM audit_events WHERE actor_account='20269810' AND action='identity.member.updated'").first();
  assert.equal(audit.total, 1, 'capture the acting identity before deactivation so the successful write is still audited');
});


test('swap acceptance rolls both assignments back when either revision is stale', async () => {
  const db = await mf.getD1Database('DB');
  const repository = staffPlatformRepository(db);
  const root = await repository.ensureMember('root001');
  const other = await repository.ensureMember('20268801');
  await db.prepare(`INSERT INTO roster_tasks(id,week_start,slot_start,slot_end,deadline,created_at) VALUES('swap-test-task','2026-10-19','19:00','21:00','2026-10-18','2026-10-15')`).run();
  await db.prepare(`INSERT INTO roster_versions(id,task_id,status,version,rule_version,algorithm_version,created_at) VALUES('swap-test-version','swap-test-task','published',1,'1','1','2026-10-15')`).run();
  await db.batch([
    db.prepare(`INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at) VALUES('swap-a','swap-test-version',?,'2026-10-19','campus-nanhu','repair','19:00','21:00')`).bind(root),
    db.prepare(`INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at) VALUES('swap-b','swap-test-version',?,'2026-10-20','campus-nanhu','repair','19:00','21:00')`).bind(other)
  ]);
  const source = await repository.assignmentById('swap-a'), target = await repository.assignmentById('swap-b');
  const input = { fromAssignmentId:source.id,toAssignmentId:target.id,toMemberId:other,fromRevision:0,toRevision:0,note:'' };
  const audit = { actorMemberId:root,actorAccount:'root001',action:'rosters.swap.created' };
  const receipt = action => ({ action,id:crypto.randomUUID(),hash:'repository-test' });
  const snapshot = { from:source,to:target,after:[{ ...source,memberId:other },{ ...target,memberId:root }],fingerprint:await repository.swapFingerprint(source.id,target.id) };
  const swap = await repository.createSwap(input,audit,receipt('swap.create'),snapshot);
  assert.ok(swap);
  await db.prepare("UPDATE duty_assignments SET revision=1 WHERE id='swap-b'").run();
  const before = await Promise.all(['swap-a','swap-b'].map(id => repository.assignmentById(id)));
  const responder = { actorMemberId:other,actorAccount:'20268801',action:'rosters.swap.decided' };
  const staleReceipt = receipt('swap.decide');
  assert.equal(await repository.updateSwap(swap,'accepted',0,responder,staleReceipt,snapshot),null);
  assert.equal(await repository.receipt(other,staleReceipt.action,staleReceipt.id),null);
  assert.deepEqual(await Promise.all(['swap-a','swap-b'].map(id => repository.assignmentById(id))),before);
  assert.equal((await repository.swapById(swap.id)).status,'pending');
  assert.equal((await repository.rosterVersionsForTask('swap-test-task')).length,1);
  await repository.updateSwap(swap,'declined',0,responder,receipt('swap.decide'));
  const freshSnapshot = { ...snapshot,to:before[1],fingerprint:await repository.swapFingerprint(source.id,target.id) };
  const fresh = await repository.createSwap({ ...input,toRevision:1 },audit,receipt('swap.create'),freshSnapshot);
  const accepted = await repository.updateSwap(fresh,'accepted',0,responder,receipt('swap.decide'),freshSnapshot);
  assert.equal(accepted.status,'accepted');
  assert.equal((await repository.assignmentById('swap-a')).memberId,root);
  assert.equal((await repository.assignmentById('swap-b')).memberId,other);
  assert.equal((await repository.assignmentById(accepted.applied_from_assignment_id)).memberId,other);
  assert.equal((await repository.assignmentById(accepted.applied_to_assignment_id)).memberId,root);
  assert.equal(await repository.updateSwap(fresh,'accepted',0,responder,receipt('swap.decide'),freshSnapshot),null);
});


test('draft edits are atomic, including role-free drafts and stale replacements', async () => {
  const db = await mf.getD1Database('DB');
  const repository = staffPlatformRepository(db);
  const root = await repository.ensureMember('root001');
  await db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,?,?,?,?,?)')
    .bind('20999801','草稿测试成员','technician','南湖','test-only-unused-password','2026-01-01').run();
  const other = await repository.ensureMember('20999801');
  const task = await repository.createRosterTask({ weekStart:'2026-10-19',slotStart:'17:00',slotEnd:'18:00',deadline:'2026-10-18' },root);
  const original = { memberId: root, businessDate: '2026-10-19', campusId: 'campus-nanhu', startAt: '18:00', endAt: '19:00' };
  const draft = await repository.createRosterVersion({ taskId: task.id, assignments: [original], solverStatus:'optimal', inputSnapshotRef:{ optimization:{complete:true} } });
  const edited = await repository.updateRosterDraft(draft.id, { assignments: [{ ...original, memberId: other }] }, draft.version);
  assert.ok(edited);
  assert.equal(edited.solverStatus,'needs_review');
  assert.equal(edited.inputSnapshotRef.optimization,undefined,'manual editing removes the obsolete optimality claim');
  assert.deepEqual((await repository.versionAssignments(draft.id)).map(item => item.memberId), [other]);
  const before = await repository.versionAssignments(draft.id);
  assert.equal(await repository.updateRosterDraft(draft.id, { assignments: [{ ...original, roleKind: 'repair_lead' }] }, draft.version), null);
  assert.deepEqual(await repository.versionAssignments(draft.id), before);
  await assert.rejects(repository.updateRosterDraft(draft.id, { assignments: [{ ...original, memberId: 'missing-member' }] }, edited.version));
  assert.deepEqual(await repository.versionAssignments(draft.id), before);
  assert.equal((await repository.rosterVersionById(draft.id)).version, edited.version);
});

test('roster generation and publication use server facts and reject forged client validation', async () => {
  const db = await mf.getD1Database('DB');
  const login = await request('/api/auth/login', { method: 'POST', body: JSON.stringify({ account: 'root001', password: 'staff-platform-password' }) });
  const headers = { Authorization: `Bearer ${login.body.token}` };
  const post = (path, body, method = 'POST') => request(path, { method, headers, body: JSON.stringify(body) });
  const ids = [];
  for (let index = 0; index < 8; index += 1) {
    const account = `2099000${index}`;
    await db.prepare('INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,?,?,?,?,?)')
      .bind(account, `排班成员${index}`, 'technician', '南湖', 'test-only-unused-password', '2026-01-01').run();
    await db.prepare('INSERT INTO staff_campus_grants(account,campus) VALUES(?,?)').bind(account, '南湖').run();
    const id = `member-${account}`; ids.push(id);
    if(index<4) await db.prepare("INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from) VALUES(?,?,'role-repair-lead','{\"campusIds\":[\"campus-nanhu\"]}','2026-01-01')").bind(`qualified-${index}`,id).run();
  }
  const task = await post('/api/roster-tasks', { weekStart: '2026-10-19', campusId: 'campus-nanhu', slotStart: '18:00', slotEnd: '19:00', deadline: '2026-10-18T10:00:00+08:00', memberIds: ids });
  assert.equal(task.response.status, 201, JSON.stringify(task.body));
  for (let index = 0; index < 8; index += 1) await db.prepare('INSERT INTO availability(id,task_id,member_id,business_date,start_at,end_at,campus_id) VALUES(?,?,?,?,?,?,?)')
    .bind(`window-${index}`,task.body.id,ids[index],`2026-10-${19+index%4}`,'18:00','19:00','campus-nanhu').run();
  const generated = await post('/api/rosters/generate', { taskId: task.body.id, members: [], slots: [], validation: { valid: true }, campusId: 'campus-hunnan' });
  assert.equal(generated.response.status, 201, JSON.stringify(generated.body));
  assert.equal(generated.body.assignments.length, 8);
  assert.equal(generated.body.validation.valid, true);
  assert.equal(generated.body.solverStatus,'optimal');
  assert.equal(generated.body.version.solverStatus,'optimal');
  assert.equal(generated.body.version.inputSnapshotRef.optimization.complete,true);
  const restored = await request(`/api/roster-tasks/${task.body.id}/roster`,{headers});
  assert.equal(restored.body.draft.solverStatus,'optimal');
  assert.equal(restored.body.draft.sourceChanged,false);
  assert.equal(restored.body.draft.inputSnapshotRef.eligibility.members.length,8);
  assert.deepEqual(restored.body.draft.inputSnapshotRef.optimization,generated.body.inputSnapshotRef.optimization);
  await db.prepare('INSERT INTO availability(id,task_id,member_id,business_date,start_at,end_at,campus_id) VALUES(?,?,?,?,?,?,?)')
    .bind('changed-optimizer-input',task.body.id,ids[0],'2026-10-20','18:00','19:00','campus-nanhu').run();
  const changedInput = await request(`/api/roster-tasks/${task.body.id}/roster`,{headers});
  assert.equal(changedInput.body.draft.validation.valid,true,'the saved assignment can remain feasible after the input expands');
  assert.equal(changedInput.body.draft.sourceChanged,true,'feasibility must not conceal an obsolete optimization input');
  await db.prepare("DELETE FROM availability WHERE id='changed-optimizer-input'").run();
  const version = generated.body.version;
  const published = await post(`/api/rosters/${version.id}/publish`, { version: version.version });
  assert.equal(published.response.status, 200, JSON.stringify(published.body));
  const next = await post('/api/rosters/generate', { taskId: task.body.id });
  assert.equal(next.response.status, 201, JSON.stringify(next.body));
  assert.ok(next.body.version.version > version.version);
  const edited = await post(`/api/rosters/${next.body.version.id}`, { version: next.body.version.version, assignments: [], validation: { valid: true } }, 'PATCH');
  assert.equal(edited.response.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.validation.valid, false);
  assert.equal(edited.body.solverStatus,'needs_review');
  assert.equal(edited.body.inputSnapshotRef.optimization,undefined);
  assert.equal((await post(`/api/rosters/${next.body.version.id}/publish`, { version: edited.body.version })).response.status, 409);
  const finalDraft = await post('/api/rosters/generate', { taskId: task.body.id });
  await db.prepare("DELETE FROM member_roles WHERE id='qualified-0'").run();
  assert.equal((await post(`/api/rosters/${finalDraft.body.version.id}/publish`, { version: finalDraft.body.version.version })).response.status, 409);
});

test('staffing demand is independently scoped, versioned and never rewrites a published roster',async()=>{
  const db=await mf.getD1Database('DB'),repository=staffPlatformRepository(db);
  const call=(path,token,body,method=body?'POST':'GET')=>request(path,{method,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),'CF-Connecting-IP':'192.0.2.188'},...(body?{body:JSON.stringify(body)}:{})});
  const root=(await call('/api/auth/login',null,{account:'root001',password:'staff-platform-password'})).body.token;
  await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('20998501','需求负责人','technician','南湖',?,'2026-01-01')").bind(hashPassword('demand-password')).run();
  await db.prepare("INSERT INTO staff_campus_grants VALUES('20998501','南湖')").run();
  const member=await repository.memberRow('member-20998501');
  await repository.bindRoles(member.id,[{roleId:'role-office-lead',scope:{campusIds:['campus-nanhu']},effectiveFrom:'2026-01-01'}],member.revision);
  const manager=(await call('/api/auth/login',null,{account:'20998501',password:'demand-password'})).body.token;
  const task=(await call('/api/roster-tasks',root,{weekStart:'2027-02-01',campusId:'campus-nanhu',slotStart:'18:00',slotEnd:'19:00',deadline:'2027-01-31T10:00:00Z',memberIds:Array.from({length:8},(_,i)=>`member-2099000${i}`)})).body;
  const path=`/api/roster-tasks/${task.id}/requirements`;
  const context=(await call('/api/auth/me',manager)).body;
  assert.equal(context.permissions['roster.repair.configure'],true);
  assert.notEqual(context.permissions['roster.repair.manage'],true);
  assert.equal((await call(`/api/roster-tasks/${task.id}/roster`,manager)).response.status,403);
  const initial=await call(path,manager);assert.equal(initial.response.status,200,JSON.stringify(initial.body));
  assert.equal(initial.body.requirements.length,4);
  const requirements=initial.body.requirements.map((row,i)=>({...row,ordinaryMinimum:i===0?2:1}));
  const changed=await call(path,manager,{revision:task.revision,requirements},'PUT');assert.equal(changed.response.status,200,JSON.stringify(changed.body));
  assert.equal((await call(path,manager,{revision:task.revision,requirements},'PUT')).response.status,409);
  for(let i=0;i<8;i++) await db.prepare('INSERT INTO availability(id,task_id,member_id,business_date,start_at,end_at,campus_id) VALUES(?,?,?,?,?,?,?)')
    .bind(`demand-${i}`,task.id,`member-2099000${i}`,`2027-02-0${1+i%4}`,'18:00','19:00','campus-nanhu').run();
  // Restore the leader authorization revoked by the preceding regression.
  await db.prepare("INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from) VALUES('demand-lead-0','member-20990000','role-repair-lead','{\"campusIds\":[\"campus-nanhu\"]}','2026-01-01')").run();
  const shortage=(await call('/api/rosters/generate',root,{taskId:task.id})).body;
  assert.equal(shortage.validation.valid,false);
  assert.ok(shortage.validation.errors.some(item=>item.code==='ORDINARY_COVERAGE_MISSING'));
  assert.equal((await call(`/api/rosters/${shortage.version.id}/publish`,root,{version:shortage.version.version})).response.status,409);
  const lowered=await call(path,manager,{revision:changed.body.task.revision,requirements:requirements.map(row=>({...row,ordinaryMinimum:1}))},'PUT');
  assert.equal(lowered.response.status,200,JSON.stringify(lowered.body));
  const ready=(await call('/api/rosters/generate',root,{taskId:task.id})).body;
  assert.equal(ready.validation.valid,true,JSON.stringify(ready.validation));
  const stamp=await repository.rosterFingerprint(task.id);
  await db.prepare("UPDATE member_work_profiles SET revision=revision+1 WHERE member_id='member-20990004'").run();
  assert.equal(await repository.publishRoster(ready.version.id,ready.version.version,undefined,stamp),null,'concurrent qualification changes cannot pass the publication transaction');
  assert.equal((await call(`/api/rosters/${ready.version.id}/publish`,root,{version:ready.version.version})).response.status,200);
  const published=await repository.versionAssignments(ready.version.id);
  const newer=await call(path,manager,{revision:lowered.body.task.revision,requirements},'PUT');assert.equal(newer.response.status,200);
  assert.deepEqual(await repository.versionAssignments(ready.version.id),published,'published history is immutable when demands change');
  assert.equal((await repository.rosterVersionById(ready.version.id)).status,'published');
  const legacy=await repository.createRosterTask({weekStart:'2027-02-08',campusScope:{campusIds:['campus-nanhu']},slotStart:'18:00',slotEnd:'19:00',deadline:'2027-02-07'},'member-root001');
  await db.prepare("UPDATE roster_tasks SET rule_version='legacy' WHERE id=?").bind(legacy.id).run();
  assert.equal((await call('/api/rosters/generate',root,{taskId:legacy.id})).response.status,409);
  const old=await call(`/api/roster-tasks/${legacy.id}/requirements`,manager);assert.equal(old.body.requiresRuleConfirmation,true);
  assert.equal((await call(`/api/roster-tasks/${legacy.id}/requirements`,manager,{revision:legacy.revision,requirements:old.body.requirements},'PUT')).response.status,200);
});

test('long-term managers can schedule off duty while field coordination remains restricted', async () => {
  const call = (path,options = {}) => request(path,{...options,headers:{...options.headers,'CF-Connecting-IP':'192.0.2.165'}});
  const db = await mf.getD1Database('DB'), repository = staffPlatformRepository(db);
  const root = await call('/api/auth/login',{method:'POST',body:JSON.stringify({account:'root001',password:'staff-platform-password'})});
  const rootHeaders = {Authorization:`Bearer ${root.body.token}`};
  for (const [account,roleId,dutyType] of [['20998711','role-repair-lead','repair'],['20998712','role-office-lead','office']]) {
    await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,'非值班日负责人','technician','南湖',?,'2026-01-01')").bind(account,hashPassword('longterm-test-password')).run();
    await db.prepare("INSERT INTO staff_campus_grants(account,campus) VALUES(?,'南湖')").bind(account).run();
    const member = await repository.memberRow(`member-${account}`);
    await repository.bindRoles(member.id,[{roleId,scope:{campusIds:['campus-nanhu']},effectiveFrom:'2026-01-01'}],member.revision);
    const login = await call('/api/auth/login',{method:'POST',body:JSON.stringify({account,password:'longterm-test-password'})});
    const headers = {Authorization:`Bearer ${login.body.token}`};
    const context = await call('/api/auth/me',{headers});
    assert.deepEqual(context.body.todayDuties,[]);
    assert.equal(context.body.permissions[`roster.${dutyType}.manage`],true);
    assert.notEqual(context.body.permissions['repair.transfer'],true);
    if (dutyType === 'office') assert.equal(context.body.permissions['leave.review'],true);
    const input = {dutyType,weekStart:'2027-01-04',campusId:'campus-nanhu',slotStart:'19:00',slotEnd:'21:00',deadline:'2027-01-03T10:00:00Z'};
    const created = await call('/api/roster-tasks',{headers,method:'POST',body:JSON.stringify(input)});
    assert.equal(created.response.status,201,JSON.stringify(created.body));
    const generate = await call('/api/rosters/generate',{headers,method:'POST',body:JSON.stringify({taskId:created.body.id})});
    assert.equal(generate.response.status,201,JSON.stringify(generate.body));
    assert.equal((await call('/api/roster-tasks',{headers,method:'POST',body:JSON.stringify({...input,campusId:'campus-hunnan'})})).response.status,403);
    const role = await call('/api/roles',{headers:rootHeaders,method:'POST',body:JSON.stringify({code:`optional_duty_${dutyType}`,name:'明确保留当日岗位条件',grants:[{permissionCode:`roster.${dutyType}.manage`,scope:{campusIds:['campus-nanhu']},conditions:[{code:'activeDutyRole',version:1}]}]})});
    assert.equal(role.response.status,201,JSON.stringify(role.body));
    const latest = await repository.memberRow(member.id);
    await repository.bindRoles(member.id,[{roleId:role.body.id,scope:{},effectiveFrom:'2026-01-01'}],latest.revision);
    const restricted = await call('/api/auth/login',{method:'POST',body:JSON.stringify({account,password:'longterm-test-password'})});
    assert.equal((await call('/api/roster-tasks/options',{headers:{Authorization:`Bearer ${restricted.body.token}`}})).response.status,403);
  }
});

test('department roster scopes govern creation, task entries, participants, availability and shift-date transfers', async () => {
  const db = await mf.getD1Database('DB'), repository = staffPlatformRepository(db);
  const rootLogin = await request('/api/auth/login',{method:'POST',body:JSON.stringify({account:'root001',password:'staff-platform-password'})});
  const rootHeaders = {Authorization:`Bearer ${rootLogin.body.token}`};
  const command = (path,body,headers = rootHeaders,method = body ? 'POST' : 'GET') => request(path,{method,headers,...(body ? {body:JSON.stringify(body)} : {})});
  for (const [account,name] of [['20998901','部门排班负责人'],['20998902','硬件维修员'],['20998903','办公部门维修员'],['20998904','周中转部门成员']]) {
    await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,?,'technician','南湖',?,'2026-01-01')").bind(account,name,hashPassword('roster-scope-test-password')).run();
    await db.batch(['南湖','浑南'].map(campus => db.prepare('INSERT INTO staff_campus_grants(account,campus) VALUES(?,?)').bind(account,campus)));
  }
  await db.prepare("UPDATE member_department_memberships SET department_id='dept-office' WHERE member_id='member-20998903'").run();
  await db.prepare("UPDATE member_department_memberships SET effective_to='2026-11-04' WHERE member_id='member-20998904'").run();
  await repository.addMembership('member-20998904',{departmentId:'dept-office',assignmentType:'primary',isPrimary:true,effectiveFrom:'2026-11-04'},0);
  const roles = [];
  for (const [code,campusId,departmentId] of [['south_hw','campus-nanhu','dept-hardware'],['north_office','campus-hunnan','dept-office']]) roles.push(await repository.createRole({code:`roster_scope_${code}`,name:code,
    grants:[{permissionCode:'roster.repair.manage',scope:{campusIds:[campusId],departmentIds:[departmentId]}}]}));
  const manager = await repository.memberRow('member-20998901');
  await repository.bindRoles(manager.id,roles.map(role => ({roleId:role.id,scope:{},effectiveFrom:'2026-01-01'})),manager.revision);
  const managerLogin = await command('/api/auth/login',{account:'20998901',password:'roster-scope-test-password'});
  const managerHeaders = {Authorization:`Bearer ${managerLogin.body.token}`};
  const options = await command('/api/roster-tasks/options?dutyType=repair',undefined,managerHeaders);
  assert.equal(options.response.status,200,JSON.stringify(options.body));
  assert.deepEqual(options.body.items.map(item => [item.campusId,item.allDepartments,item.departments.map(value => value.id)]).sort(),[
    ['campus-hunnan',false,['dept-office']],['campus-nanhu',false,['dept-hardware']]
  ]);
  const base = {weekStart:'2026-11-02',slotStart:'19:00',slotEnd:'21:00',deadline:'2026-11-01T18:00:00+08:00',campusId:'campus-nanhu'};
  for (const extra of [{departmentIds:['dept-office']},{departmentIds:['dept-hardware','dept-office']},{departmentIds:[]}]) assert.equal((await command('/api/roster-tasks',{...base,...extra},managerHeaders)).response.status,403);
  const south = await command('/api/roster-tasks',{...base,departmentIds:['dept-hardware']},managerHeaders);
  assert.equal(south.response.status,201,JSON.stringify(south.body));
  assert.equal((await command('/api/roster-tasks',{...base,departmentIds:['dept-hardware']},managerHeaders)).response.status,409);
  const north = await command('/api/roster-tasks',{...base,campusId:'campus-hunnan',departmentIds:['dept-office']},managerHeaders);
  const forbidden = await command('/api/roster-tasks',{...base,departmentIds:['dept-office']});
  const unrestricted = await command('/api/roster-tasks',base);
  for (const created of [north,forbidden,unrestricted]) assert.equal(created.response.status,201,JSON.stringify(created.body));
  const invitation = await command('/api/roster-tasks',{...base,slotStart:'18:00',departmentIds:['dept-hardware'],memberIds:['member-20998903']},managerHeaders);
  assert.equal(invitation.response.status,403,'an out-of-department invitation cannot expand the scope');
  const entries = await command('/api/roster-tasks',undefined,managerHeaders);
  assert.equal(entries.response.status,200);
  assert.ok(entries.body.items.some(item => item.id === south.body.id && item.actions.manage));
  assert.ok(entries.body.items.some(item => item.id === north.body.id && item.actions.manage));
  assert.ok(!entries.body.items.some(item => item.id === forbidden.body.id));
  assert.ok(!entries.body.items.some(item => item.id === unrestricted.body.id),'a department manager cannot manage an unrestricted task');
  for (const path of [`/api/roster-tasks/${forbidden.body.id}/roster`,`/api/roster-tasks/${forbidden.body.id}/availability`]) assert.equal((await command(path,undefined,managerHeaders)).response.status,403);
  for (const [id,memberId,businessDate] of [['scope-good','member-20998902','2026-11-02'],['scope-poison','member-20998903','2026-11-02'],['scope-transfer-before','member-20998904','2026-11-02'],['scope-transfer-after','member-20998904','2026-11-04']]) await db.prepare('INSERT INTO availability(id,task_id,member_id,business_date,start_at,end_at,campus_id) VALUES(?,?,?,?,?,?,?)').bind(id,south.body.id,memberId,businessDate,'19:00','21:00','campus-nanhu').run();
  const available = await command(`/api/roster-tasks/${south.body.id}/availability`,undefined,managerHeaders);
  assert.deepEqual(available.body.items.map(item => item.id).sort(),['scope-good','scope-transfer-before']);
  const state = await command(`/api/roster-tasks/${south.body.id}/roster`,undefined,managerHeaders);
  assert.equal(state.response.status,200,JSON.stringify(state.body));
  assert.ok(!state.body.members.some(item => item.memberId === 'member-20998903'));
  assert.deepEqual(state.body.members.find(item => item.memberId === 'member-20998904').available.map(item => item.businessDate),['2026-11-02']);
  const transferLogin = await command('/api/auth/login',{account:'20998904',password:'roster-scope-test-password'});
  const transferHeaders = {Authorization:`Bearer ${transferLogin.body.token}`};
  const ownEntries = await command('/api/roster-tasks',undefined,transferHeaders);
  assert.ok(ownEntries.body.items.some(item => item.id === south.body.id && item.actions.fill && !item.actions.manage));
  assert.ok(ownEntries.body.items.every(item => item.memberIds === undefined && item.createdByMemberId === undefined));
  const save = (id,businessDate) => command(`/api/roster-tasks/${id}/availability`,{businessDate,campusId:'campus-nanhu',startAt:'19:00',endAt:'21:00'},transferHeaders,'PUT');
  assert.equal((await save(south.body.id,'2026-11-03')).response.status,200);
  assert.equal((await save(south.body.id,'2026-11-04')).response.status,403);
  assert.equal((await save(forbidden.body.id,'2026-11-04')).response.status,200);
  assert.equal((await save(south.body.id,'2026-11-06')).response.status,400);
  const ordinaryOptions = await command('/api/roster-tasks/options',undefined,transferHeaders);
  assert.equal(ordinaryOptions.response.status,403);
  await repository.updateRole(roles[0].id,{grants:[]},roles[0].revision);
  assert.equal((await command(`/api/roster-tasks/${south.body.id}/roster`,undefined,managerHeaders)).response.status,401,'revocation invalidates the old manager session immediately');
});
