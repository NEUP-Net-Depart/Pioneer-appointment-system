import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { config, wrangler } from "../scripts/cli.mjs";
import { hashPassword } from "../src/lib/passwords.js";
import { dateKey } from "../shared/time.js";
import { fieldSeed } from "./fixtures/field-seed.mjs";
import { staffPlatformRepository } from '../src/db/staff-platform.js';

// Only the disposable Worker uses this clock; late-night test runs must still exercise a live duty day.
const testNow = Date.parse('2026-10-15T10:00:00+08:00');
const workerClock = `const RealDate = Date; globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [${testNow}])); }
  static now() { return ${testNow}; }
};\n`;
let mf, db;
const tokens = {};

test('mutual swaps publish immutable linked revisions and roll back failed audits and receipts', async () => {
  const repository = staffPlatformRepository(db), people = ['20261201','20261202','20261203','20261204'];
  for (const [index,account] of people.entries()) {
    await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,?,'technician','南湖',?,'2026-01-01')").bind(account,`换班成员${index + 1}`,hashPassword('StaffTest!2026')).run();
    await db.prepare("INSERT INTO staff_campus_grants VALUES(?,'南湖')").bind(account).run();
    if (index !== 1) await db.prepare("INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from) VALUES(?,?,'repair_lead','2026-01-01')").bind(`swap-lead-${index}`,`member-${account}`).run();
    const login = await request('/api/auth/login',null,{ account,password:'StaffTest!2026' });
    assert.equal(login.status,200,JSON.stringify(login.body)); tokens[account] = login.body.token;
  }
  async function fixture(prefix,week,crossTask = false) {
    const days = [week,week,week.slice(0,8) + String(Number(week.slice(8)) + 1).padStart(2,'0'),week.slice(0,8) + String(Number(week.slice(8)) + 1).padStart(2,'0')];
    const order = [people[0],people[2],people[1],people[3]], result = [];
    for (const side of crossTask ? [0,1] : [0]) {
      const task = `${prefix}-task-${side}`,version = `${prefix}-v-${side}`;
      await db.prepare("INSERT INTO roster_tasks(id,week_start,slot_start,slot_end,deadline,created_at) VALUES(?,?,?,?,'2026-10-14','2026-10-14')").bind(task,week,side ? '20:00' : '19:00',side ? '22:00' : '21:00').run();
      await db.prepare("INSERT INTO roster_versions(id,task_id,status,version,rule_version,algorithm_version,created_at) VALUES(?,?,'published',1,'1','fixture','2026-10-14')").bind(version,task).run();
      for (let index = 0; index < 4; index++) {
        if (crossTask && Math.floor(index / 2) !== side) continue;
        const shift = `${prefix}-shift-${index}`;
        await db.prepare("INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at) VALUES(?,?,?,?,'campus-nanhu','repair',?,?)").bind(shift,version,`member-${order[index]}`,days[index],side ? '20:00' : '19:00',side ? '22:00' : '21:00').run();
        if (order[index] !== people[1]) await db.prepare("INSERT INTO duty_roles(id,assignment_id,role_kind) VALUES(?,?,'repair_lead')").bind(`role-${shift}`,shift).run();
        result[index] = await repository.assignmentById(shift);
      }
    }
    return result;
  }
  const shifts = await fixture('swap-immutable','2026-12-07');
  const input = { fromAssignmentId:shifts[0].id,toAssignmentId:shifts[2].id,toMemberId:shifts[2].memberId,fromRevision:0,toRevision:0,note:'期末考试调整',requestId:crypto.randomUUID() };
  const preview = await request('/api/swaps/preview',people[0],input);
  assert.equal(preview.status,200,JSON.stringify(preview.body)); assert.equal(preview.body.allowed,true,JSON.stringify(preview.body));
  assert.deepEqual(preview.body.after.map(row => [row.memberName,row.roleKind]),[['换班成员2',''],['换班成员1','repair_lead']]);
  assert.equal((await request('/api/swaps/preview',people[3],input)).status,403);
  await db.prepare("CREATE TRIGGER reject_swap_create_audit BEFORE INSERT ON audit_events WHEN NEW.action='rosters.swap.created' BEGIN SELECT RAISE(ABORT,'SWAP_AUDIT_FAILURE'); END").run();
  try {
    assert.equal((await request('/api/swaps',people[0],input)).status,500);
    assert.equal(await repository.receipt(shifts[0].memberId,'swap.create',input.requestId),null);
    assert.deepEqual(await repository.listSwaps({ memberId:shifts[0].memberId }),[]);
  } finally { await db.prepare('DROP TRIGGER reject_swap_create_audit').run(); }
  const invite = await request('/api/swaps',people[0],input);
  assert.equal(invite.status,201,JSON.stringify(invite.body));
  assert.equal((await request('/api/field/home',people[1])).body.pendingSwapInvitations,1);
  assert.equal((await request('/api/field/home',people[0])).body.pendingSwapInvitations,0);
  assert.equal((await request('/api/swaps',people[0],input)).body.id,invite.body.id);
  assert.equal((await request('/api/swaps',people[0],{ ...input,note:'不同内容' })).status,409);
  assert.equal((await request('/api/swaps',people[0],{ ...input,requestId:crypto.randomUUID() })).status,409);
  assert.equal((await request(`/api/swaps/${invite.body.id}`,people[3])).status,403);
  assert.equal((await request(`/api/swaps/${invite.body.id}/decision`,people[0],{ decision:'accept',revision:0 })).status,403);
  const otherInput = { fromAssignmentId:shifts[1].id,toAssignmentId:shifts[3].id,toMemberId:shifts[3].memberId,fromRevision:0,toRevision:0,requestId:crypto.randomUUID() };
  const unchangedInvite = await request('/api/swaps',people[2],otherInput);
  assert.equal(unchangedInvite.status,201,JSON.stringify(unchangedInvite.body));
  const decision = { decision:'accept',revision:0,requestId:crypto.randomUUID() };
  for (const failure of ['audit','receipt']) {
    const sql = failure === 'audit' ? "CREATE TRIGGER reject_swap_commit BEFORE INSERT ON audit_events WHEN NEW.action='rosters.swap.decided' BEGIN SELECT RAISE(ABORT,'SWAP_AUDIT_FAILURE'); END" : "CREATE TRIGGER reject_swap_commit BEFORE UPDATE ON operation_receipts WHEN NEW.action='swap.decide' AND NEW.result_status='success' BEGIN SELECT RAISE(ABORT,'SWAP_RECEIPT_FAILURE'); END";
    await db.prepare(sql).run();
    try {
      assert.equal((await request(`/api/swaps/${invite.body.id}/decision`,people[1],decision)).status,500);
      assert.equal((await repository.swapById(invite.body.id)).status,'pending');
      assert.equal((await repository.rosterVersionsForTask('swap-immutable-task-0')).length,1);
      assert.equal((await repository.rosterVersionById(shifts[0].versionId)).status,'published');
      assert.equal(await repository.receipt(shifts[2].memberId,'swap.decide',decision.requestId),null);
      assert.equal((await repository.listAudit({ action:'rosters.swap.decided' })).length,0);
    } finally { await db.prepare('DROP TRIGGER reject_swap_commit').run(); }
  }
  const accepted = await Promise.all([1,2].map(() => request(`/api/swaps/${invite.body.id}/decision`,people[1],decision)));
  assert.ok(accepted.every(row => row.status === 200),JSON.stringify(accepted));
  assert.equal(accepted[0].body.appliedFromAssignmentId,accepted[1].body.appliedFromAssignmentId);
  assert.equal((await repository.rosterVersionsForTask('swap-immutable-task-0')).length,2);
  assert.equal((await repository.listAudit({ action:'rosters.swap.decided' })).length,1);
  assert.equal((await request('/api/field/home',people[1])).body.pendingSwapInvitations,0);
  for (const original of shifts) {
    const current = await repository.assignmentById(original.id);
    assert.deepEqual({ ...current,versionStatus:'published' },original,'Historical published assignment and role facts remain unchanged');
  }
  const applied = await Promise.all([accepted[0].body.appliedFromAssignmentId,accepted[0].body.appliedToAssignmentId].map(id => repository.assignmentById(id)));
  assert.deepEqual(applied.map(row => [row.memberId,row.roleKind,row.revision,row.previousAssignmentId]),[
    [shifts[2].memberId,'',1,shifts[0].id],[shifts[0].memberId,'repair_lead',1,shifts[2].id]
  ]);
  assert.ok(applied.every(row => row.versionStatus === 'published' && !row.originAssignmentId));
  const unaffected = await repository.effectiveAssignment(shifts[1].id,shifts[1].memberId);
  assert.equal(unaffected.originAssignmentId,shifts[1].id); assert.equal(unaffected.revision,0);
  const stillValid = await request(`/api/swaps/${unchangedInvite.body.id}`,people[3]);
  assert.equal(stillValid.body.allowed,true,JSON.stringify(stillValid.body));
  assert.equal((await request(`/api/swaps/${unchangedInvite.body.id}/decision`,people[3],{ decision:'accept',revision:0,requestId:crypto.randomUUID() })).status,200);
  // Different source tasks must be superseded together before successors publish.
  const cross = await fixture('swap-cross-task','2026-12-14',true);
  const crossInvite = await request('/api/swaps',people[0],{ ...input,fromAssignmentId:cross[0].id,toAssignmentId:cross[2].id,requestId:crypto.randomUUID() });
  assert.equal(crossInvite.status,201,JSON.stringify(crossInvite.body));
  const race = await Promise.all(['accept','decline'].map(action => request(`/api/swaps/${crossInvite.body.id}/decision`,people[1],{ decision:action,revision:0,requestId:crypto.randomUUID() })));
  assert.equal(race.filter(row => row.status === 200).length,1,JSON.stringify(race));
  assert.equal(race.filter(row => row.status === 409).length,1,JSON.stringify(race));
  const final = await repository.swapById(crossInvite.body.id);
  for (const side of [0,1]) assert.equal((await repository.rosterVersionsForTask(`swap-cross-task-task-${side}`)).length,final.status === 'accepted' ? 2 : 1);
  // Pending leave, loss of campus scope and profile changes invalidate acceptance.
  const guarded = await fixture('swap-guarded','2026-12-21');
  const guardedInput = { ...input,fromAssignmentId:guarded[0].id,toAssignmentId:guarded[2].id,requestId:crypto.randomUUID() };
  await db.prepare("DELETE FROM duty_roles WHERE assignment_id=?").bind(guarded[1].id).run();
  assert.equal((await request('/api/swaps/preview',people[0],guardedInput)).body.allowed,false,'Removing the other leader must expose lost coverage');
  await db.prepare("INSERT INTO duty_roles(id,assignment_id,role_kind) VALUES('restored-guard-lead',?,'repair_lead')").bind(guarded[1].id).run();
  const guardedInvite = await request('/api/swaps',people[0],guardedInput);
  assert.equal(guardedInvite.status,201,JSON.stringify(guardedInvite.body));
  const path = `/api/swaps/${guardedInvite.body.id}/decision`;
  const guardDecision = { decision:'accept',revision:0,requestId:crypto.randomUUID() };
  const leave = await request('/api/leaves',people[0],{ assignmentId:guarded[0].id,reason:'临时请假',requestId:crypto.randomUUID() });
  assert.equal(leave.status,201,JSON.stringify(leave.body));
  const pendingLeave = await request(path,people[1],guardDecision);
  assert.equal(pendingLeave.status,409); assert.match(pendingLeave.body.error,/请假/);
  assert.equal((await request(`/api/leaves/${leave.body.id}/withdraw`,people[0],{ revision:0 })).status,200);
  await db.prepare("UPDATE member_work_profiles SET effective_to='2026-12-21' WHERE member_id=? AND profile_code='repair'").bind(guarded[2].memberId).run();
  const unqualified = await request(path,people[1],guardDecision);
  assert.equal(unqualified.status,409); assert.match(unqualified.body.error,/工作资格/);
  await db.prepare("UPDATE member_work_profiles SET effective_to=NULL WHERE member_id=? AND profile_code='repair'").bind(guarded[2].memberId).run();
  await db.prepare("DELETE FROM staff_campus_grants WHERE account=?").bind(people[0]).run();
  const wrongCampus = await request(path,people[1],guardDecision);
  assert.equal(wrongCampus.status,409); assert.match(wrongCampus.body.error,/校区/);
  await db.prepare("INSERT INTO staff_campus_grants VALUES(?,'南湖')").bind(people[0]).run();
  await db.prepare("INSERT INTO duty_assignments(id,version_id,member_id,business_date,campus_id,duty_type,start_at,end_at) VALUES('swap-guard-time',?,?,'2026-12-21','campus-nanhu','office','20:00','22:00')").bind(guarded[0].versionId,guarded[2].memberId).run();
  const conflict = await request(path,people[1],guardDecision);
  assert.equal(conflict.status,409); assert.match(conflict.body.error,/冲突/);
  await db.prepare("DELETE FROM duty_assignments WHERE id='swap-guard-time'").run();
  const originalVersionCount = (await repository.rosterVersionsForTask('swap-guarded-task-0')).length;
  const staleSnapshot = { from:guarded[0],to:guarded[2],after:[],fingerprint:await repository.swapFingerprint(guarded[0].id,guarded[2].id) };
  await db.prepare("UPDATE members SET status='inactive' WHERE id=?").bind(guarded[0].memberId).run();
  const audit = { actorAccount:people[1],actorMemberId:guarded[2].memberId,authVersion:(await repository.accountRow(people[1])).auth_version,action:'rosters.swap.decided' };
  const receipt = { action:'swap.decide',id:crypto.randomUUID(),hash:'stale-snapshot' };
  staleSnapshot.after = [guarded[2],guarded[0]];
  assert.equal(await repository.updateSwap(await repository.swapById(guardedInvite.body.id),'accepted',0,audit,receipt,staleSnapshot),null,'Commit must compare the validated snapshot inside its transaction');
  assert.equal(await repository.receipt(audit.actorMemberId,receipt.action,receipt.id),null);
  assert.equal((await repository.rosterVersionsForTask('swap-guarded-task-0')).length,originalVersionCount);
  assert.equal((await repository.swapById(guardedInvite.body.id)).status,'pending');
  await db.prepare("UPDATE members SET status='active' WHERE id=?").bind(guarded[0].memberId).run();
  const approvedLeave = await request('/api/leaves',people[0],{ assignmentId:guarded[0].id,reason:'请假获批后不能换班',requestId:crypto.randomUUID() });
  assert.equal(approvedLeave.status,201,JSON.stringify(approvedLeave.body));
  assert.equal((await request(`/api/leaves/${approvedLeave.body.id}/decision`,'root001',{ decision:'approve',revision:0,requestId:crypto.randomUUID() })).status,200);
  const approvedConflict = await request(path,people[1],guardDecision);
  assert.equal(approvedConflict.status,409); assert.match(approvedConflict.body.error,/已批准的请假/);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('leave review preserves attendance, applies coverage atomically and follows unchanged published assignments', async () => {
  const repository = staffPlatformRepository(db);
  const task = await request('/api/roster-tasks', 'root001', { dutyType: 'office', weekStart: '2026-11-09', campusId: 'campus-nanhu', slotStart: '19:00', slotEnd: '21:00', deadline: '2026-11-08T10:00:00Z' });
  assert.equal(task.status, 201, JSON.stringify(task.body));
  let generated = await request('/api/rosters/generate', 'root001', { taskId: task.body.id });
  const state = (await request(`/api/roster-tasks/${task.body.id}/roster`, 'root001')).body;
  const assignments = state.slots.flatMap(slot => ['member-20261001', 'member-root001'].map(memberId => ({ ...slot, memberId })));
  let saved = await request(`/api/rosters/${generated.body.version.id}`, 'root001', { version: generated.body.version.version, assignments }, 'PATCH');
  assert.equal(saved.body.validation.valid, true, JSON.stringify(saved.body));
  assert.equal((await request(`/api/rosters/${saved.body.id}/publish`, 'root001', { version: saved.body.version })).status, 200);
  const own = (await request('/api/me/roster?weekStart=2026-11-09', '20261001')).body.items;
  const input = { assignmentId: own[0].id, reason: '课程考试需要请假', requestId: crypto.randomUUID() };
  await db.prepare("CREATE TRIGGER reject_leave_receipt BEFORE UPDATE ON operation_receipts WHEN NEW.action='leave.create' AND NEW.result_status='success' BEGIN SELECT RAISE(ABORT,'LEAVE_RECEIPT_FAILURE'); END").run();
  try {
    assert.equal((await request('/api/leaves', '20261001', input)).status, 500);
    assert.equal(await repository.receipt('member-20261001', 'leave.create', input.requestId), null);
    assert.equal((await repository.listLeaves({ memberId: 'member-20261001' })).length, 0);
  } finally { await db.prepare('DROP TRIGGER reject_leave_receipt').run(); }
  const created = await request('/api/leaves', '20261001', input);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await request('/api/leaves', '20261001', input)).body.id, created.body.id);
  assert.equal((await request('/api/leaves', '20261001', { ...input, reason: '同一请求不能换内容' })).status, 409);
  assert.equal((await request('/api/leaves', '20261001', { ...input, requestId: crypto.randomUUID() })).status, 409);
  assert.equal((await request(`/api/leaves/${created.body.id}/withdraw`, '20261001', { revision: '0' })).status, 400);
  assert.equal((await request(`/api/leaves/${created.body.id}`, '20261002')).status, 403);
  assert.equal((await request(`/api/leaves/${created.body.id}/decision`, '20261002', { decision: 'approve', revision: 0 })).status, 403);
  let detail = await request(`/api/leaves/${created.body.id}`, 'root001');
  assert.equal(detail.body.memberName, '林悦');
  assert.deepEqual(detail.body.departments, ['办公室']);
  assert.equal(detail.body.impact.expected, 2);
  assert.equal(detail.body.impact.afterApproval, 1);
  assert.equal(detail.body.impact.checkedIn, false);
  // Attendance is a separate fact: approval must not erase an actual arrival.
  await db.prepare("INSERT INTO attendance_events(id,type,policy_code,policy_version,campus_id,business_date,starts_at,ends_at,created_by_member_id,created_at) VALUES('leave-event','duty','duty.v1','1.0.0','campus-nanhu','2026-11-09','2026-11-09T18:30:00+08:00','2026-11-09T21:00:00+08:00','member-root001','2026-10-15')").run();
  await db.prepare("INSERT INTO attendance_records(id,member_id,event_id,dedupe_key,occurred_at,recorded_at,method) VALUES('leave-arrival','member-20261001','leave-event','leave-arrival','2026-11-09T18:50:00+08:00','2026-11-09T18:50:00+08:00','qr')").run();
  const decision = { decision: 'approve', revision: 0, note: '已安排其他接待人员覆盖', requestId: crypto.randomUUID() };
  assert.equal(await repository.updateLeave(created.body.id, 'approved', 'member-root001', 0, '', {
    actorMemberId: 'member-root001', actorAccount: 'root001', authVersion: -1, action: 'rosters.leave.reviewed'
  }), null, 'An authorization revision changed before commit must not approve a leave');
  await db.prepare("CREATE TRIGGER reject_leave_audit BEFORE INSERT ON audit_events WHEN NEW.action='rosters.leave.reviewed' BEGIN SELECT RAISE(ABORT,'LEAVE_AUDIT_FAILURE'); END").run();
  try {
    assert.equal((await request(`/api/leaves/${created.body.id}/decision`, 'root001', decision)).status, 500);
    assert.equal((await repository.leaveById(created.body.id)).status, 'pending');
  } finally { await db.prepare('DROP TRIGGER reject_leave_audit').run(); }
  const approved = await request(`/api/leaves/${created.body.id}/decision`, 'root001', decision);
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal((await request(`/api/leaves/${created.body.id}/decision`, 'root001', decision)).status, 200);
  assert.equal((await request(`/api/leaves/${created.body.id}/decision`, 'root001', { ...decision, decision: 'reject' })).status, 409);
  detail = await request(`/api/leaves/${created.body.id}`, 'root001');
  assert.equal(detail.body.impact.expected, 1);
  assert.equal(detail.body.impact.checkedIn, true);
  assert.equal(detail.body.impact.arrived, 1);
  assert.equal((await repository.listAssignments('member-20261001', '2026-11-09'))[0].leaveStatus, 'approved');
  const pending = await request('/api/leaves', '20261001', { assignmentId: own[1].id, reason: '课程补课需要请假', requestId: crypto.randomUUID() });
  assert.equal(pending.status, 201);
  generated = await request('/api/rosters/generate', 'root001', { taskId: task.body.id });
  assert.equal(generated.body.assignments.find(row => row.id === own[0].id).leaveStatus, 'approved');
  assert.equal((await request(`/api/rosters/${generated.body.version.id}/publish`, 'root001', { version: generated.body.version.version })).status, 200);
  const republished = (await repository.listAssignments('member-20261001', '2026-11-09'));
  assert.notEqual(republished[0].id, own[0].id);
  assert.equal(republished[0].originAssignmentId, own[0].id);
  assert.equal(republished[0].leaveStatus, 'approved');
  assert.equal(republished[1].leaveStatus, 'pending');
  assert.equal((await request('/api/leaves', '20261001', input)).body.id, created.body.id);
  assert.equal((await request(`/api/leaves/${pending.body.id}`, 'root001')).body.assignment.id, republished[1].id);
  assert.equal((await request('/api/leaves', '20261001', { ...input, assignmentId: republished[0].id, requestId: crypto.randomUUID() })).status, 409);
  assert.equal((await request('/api/leaves', '20261001', { assignmentId: own[2].id, reason: '不能提交旧班次', requestId: crypto.randomUUID() })).status, 409);
  generated = await request('/api/rosters/generate', 'root001', { taskId: task.body.id });
  const removed = generated.body.assignments.filter(row => !(row.memberId === 'member-20261001' && row.businessDate === own[1].businessDate)).map(row => ({ ...row, id: undefined, originAssignmentId: 'untrusted', leaveStatus: '' }));
  saved = await request(`/api/rosters/${generated.body.version.id}`, 'root001', { version: generated.body.version.version, assignments: removed }, 'PATCH');
  assert.equal(saved.body.assignments.find(row => row.memberId === 'member-20261001' && row.businessDate === own[0].businessDate).leaveStatus, 'approved');
  assert.equal((await request(`/api/rosters/${saved.body.id}/publish`, 'root001', { version: saved.body.version })).status, 200);
  detail = await request(`/api/leaves/${pending.body.id}`, 'root001');
  assert.equal(detail.body.actions.approve, false);
  assert.equal(detail.body.actions.review, true);
  assert.equal((await request(`/api/leaves/${pending.body.id}/decision`, 'root001', { ...decision, requestId: crypto.randomUUID() })).status, 409);
  assert.equal((await request(`/api/leaves/${pending.body.id}/decision`, 'root001', { decision: 'reject', revision: 0, note: '原班次已调整' })).status, 200);
  assert.equal((await repository.listAssignments('member-20261001', '2026-11-09')).some(row => row.businessDate === own[1].businessDate), false);
});

test('office managers publish daily assignments, preserve repair tasks and reject duplicate or conflicting coverage', async () => {
  const input = { dutyType: 'office', weekStart: '2026-11-02', campusId: 'campus-nanhu', slotStart: '19:00', slotEnd: '21:00', deadline: '2026-11-01T10:00:00Z' };
  assert.equal((await request('/api/roster-tasks', '20261002', input)).status, 403);
  const created = await request('/api/roster-tasks', 'root001', input);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const taskId = created.body.id;
  assert.equal(created.body.dutyType, 'office');
  // A delegated office manager need not inherit repair or personal-roster grants.
  const repository = staffPlatformRepository(db);
  await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES('20261111','办公排班负责人','technician','南湖',?,'2026-01-01')").bind(hashPassword('StaffTest!2026')).run();
  await db.prepare("INSERT INTO staff_campus_grants VALUES('20261111','南湖')").run();
  await db.prepare("DELETE FROM member_roles WHERE member_id='member-20261111'").run();
  const officeRole = await repository.createRole({ code: 'office-manager-only', name: '办公排班管理', level: 1, grants: [{ permissionCode: 'roster.office.manage', scope: { campusIds: ['campus-nanhu'] }, conditions: [] }] });
  await repository.bindRoles('member-20261111', [{ roleId: officeRole.id, scope: { campusIds: ['campus-nanhu'] }, effectiveFrom: '2026-01-01' }], 0);
  const managerLogin = await request('/api/auth/login', '', { account: '20261111', password: 'StaffTest!2026' });
  tokens['20261111'] = managerLogin.body.token;
  const managerTasks = await request('/api/roster-tasks', '20261111');
  assert.equal(managerTasks.status, 200, JSON.stringify(managerTasks.body));
  assert.equal(managerTasks.body.items.every(item => item.dutyType === 'office'), true);
  assert.equal((await request('/api/auth/me', '20261111')).body.navigation.some(item => item.id === 'office-roster'), true);
  assert.equal((await request('/api/roster-tasks', '20261111', { ...input, campusId: 'campus-hunnan' })).status, 403);
  const generated = await request('/api/rosters/generate', 'root001', { taskId });
  assert.equal(generated.status, 201, JSON.stringify(generated.body));
  let state = (await request(`/api/roster-tasks/${taskId}/roster`, 'root001')).body;
  assert.equal(state.members.some(member => member.memberId === 'member-20261002'), false);
  assert.equal(state.members.some(member => member.memberId === 'member-20261001'), true);
  const assignments = state.slots.map(slot => ({ ...slot, memberId: 'member-20261001', roleKind: 'coordinator' }));
  assert.equal((await request(`/api/rosters/${state.draft.id}/publish`, 'root001', { version: 'invalid' })).status, 400);
  let saved = await request(`/api/rosters/${state.draft.id}`, 'root001', { version: state.draft.version, assignments: [...assignments, assignments[0]] }, 'PATCH');
  assert.equal(saved.status, 409);
  assert.equal((await request(`/api/rosters/${state.draft.id}/publish`, 'root001', { version: state.draft.version })).status, 409);
  saved = await request(`/api/rosters/${state.draft.id}`, 'root001', { version: state.draft.version, assignments }, 'PATCH');
  assert.equal(saved.body.validation.valid, true, JSON.stringify(saved.body));
  assert.equal((await request(`/api/rosters/${state.draft.id}/publish`, 'root001', { version: saved.body.version })).status, 200);
  state = (await request(`/api/roster-tasks/${taskId}/roster`, 'root001')).body;
  assert.equal(state.publishedAssignments.length, 4);
  assert.equal(state.publishedAssignments.every(item => item.dutyType === 'office' && item.roleKind === 'coordinator'), true);
  const revised = await request('/api/rosters/generate', 'root001', { taskId });
  assert.equal(revised.body.assignments.length, 4);
  await db.prepare("CREATE TRIGGER reject_office_publish_audit BEFORE INSERT ON audit_events WHEN NEW.action='rosters.published' BEGIN SELECT RAISE(ABORT,'OFFICE_AUDIT_FAILURE'); END").run();
  try {
    assert.equal((await request(`/api/rosters/${revised.body.version.id}/publish`, 'root001', { version: revised.body.version.version })).status, 500);
    assert.equal((await repository.rosterVersionById(revised.body.version.id)).status, 'draft');
    assert.equal((await repository.rosterVersionById(state.draft.id)).status, 'published');
  } finally { await db.prepare('DROP TRIGGER reject_office_publish_audit').run(); }
  assert.equal((await request(`/api/rosters/${revised.body.version.id}/publish`, 'root001', { version: revised.body.version.version })).status, 200);
  assert.equal((await request(`/api/rosters/${revised.body.version.id}/publish`, 'root001', { version: revised.body.version.version })).status, 200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM audit_events WHERE action='rosters.published' AND json_extract(source_ref,'$.id')=?").bind(revised.body.version.id).first()).n, 1);
  const competing = await request('/api/roster-tasks', 'root001', { ...input, slotStart: '17:00', slotEnd: '18:00' });
  const race = await repository.createRosterVersion({ taskId: competing.body.id, assignments: [{ ...assignments[0], startAt: '17:00', endAt: '18:00' }], validation: { valid: true } });
  // Even a version validated before the other publication cannot become effective.
  await assert.rejects(repository.publishRoster(race.id, race.version), /ROSTER_SCHEDULE_CONFLICT/);
  assert.equal((await repository.rosterVersionById(race.id)).status, 'draft');
  assert.equal((await repository.listAssignments('member-20261001', input.weekStart)).length, 4);
});
async function sql(text) {
  let buffer = "";
  const statements = [];
  for (const line of text.replace(/--[^\n]*/g, "").split("\n")) {
    buffer = `${buffer}\n${line}`.trim();
    if (
      buffer &&
      (buffer.startsWith("CREATE TRIGGER")
        ? line.trim() === "END;"
        : line.trim().endsWith(";"))
    ) {
      statements.push(buffer);
      buffer = "";
    }
  }
  assert.equal(buffer, "");
  // Fixtures can put more than one statement on a line; D1 exec accepts that.
  for (const statement of statements) {
    if (statement.startsWith("CREATE TRIGGER"))
      await db.prepare(statement).run();
    else
      for (const piece of statement
        .split(";")
        .map((s) => s.trim())
        .filter(Boolean))
        await db.prepare(piece).run();
  }
}
async function request(path, account, body, method = body ? "POST" : "GET") {
  const response = await mf.dispatchFetch(`https://field.test${path}`, {
    method,
    headers: {
      ...(account ? { Authorization: `Bearer ${tokens[account]}` } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
before(async () => {
  const cfg = await config();
  wrangler([
    "pages",
    "functions",
    "build",
    "functions",
    "--outdir",
    ".wrangler/field-test-build",
    "--compatibility-date",
    cfg.compatibility_date,
    "--compatibility-flags",
    ...cfg.compatibility_flags,
  ]);
  mf = new Miniflare({
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: "field-tests",
          compatibilityDate: cfg.compatibility_date,
          compatibilityFlags: cfg.compatibility_flags,
          manifest: {
            mainModule: "index.js",
            modules: {
              "index.js": {
                type: "esm",
                contents: workerClock + await readFile(
                  ".wrangler/field-test-build/index.js",
                  "utf8",
                ),
              },
            },
          },
          env: {
            DB: { type: "d1", id: "field-tests" },
            ATTACHMENTS: { type: "r2", name: "field-tests" },
            STAFF_WORKFLOW_ENABLED: { type: "text", value: "true" },
            JWT_SECRET: {
              type: "text",
              value: "field-test-secret-01234567890123456789",
            },
            PII_ENCRYPTION_KEY: {
              type: "text",
              value:
                "0123456789012345678901234567890101234567890123456789012345678901",
            },
          },
        },
      },
    ],
  });
  db = await mf.getD1Database("DB");
  for (const file of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort())
    await sql(await readFile(`migrations/${file}`, "utf8"));
  await db
    .prepare(
      "INSERT INTO staff_accounts(account,name,role,home_campus,protected,password_hash,created_at) VALUES('root001','测试负责人','superadmin','南湖',1,?,'2026-01-01')",
    )
    .bind(hashPassword("StaffTest!2026"))
    .run();
  await db
    .prepare("INSERT INTO staff_campus_grants VALUES('root001','南湖')")
    .run();
  await sql(fieldSeed(dateKey(new Date(testNow))));
  for (const account of [
    "root001",
    "20261001",
    "20261002",
    "20261003",
    "20261004",
  ]) {
    const login = await request("/api/auth/login", null, {
      account,
      password: "StaffTest!2026",
    });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    tokens[account] = login.body.token;
  }
});
after(async () => mf?.dispose());

test('legacy desk summary shares current field authorization and rejects historical duty replay',async()=>{
  assert.equal((await request('/api/desk/summary?campusId=campus-nanhu','20261002')).status,403);
  assert.equal((await request('/api/desk/summary?campusId=campus-hunnan','20261001')).status,403);
  assert.equal((await request('/api/desk/summary?businessDate=2026-10-14','20261001')).status,400);
  const legacy=await request('/api/desk/summary?campusId=campus-nanhu','20261001');
  const current=await request('/api/field/board?campusId=campus-nanhu','20261001');
  assert.equal(legacy.status,200,JSON.stringify(legacy.body));
  assert.deepEqual(legacy.body.appointments,current.body.appointments);
  assert.deepEqual(legacy.body.staffPresence,current.body.staffPresence);
});

test('unscheduled ordinary technician joins the working day through check-in without a roster assignment',async()=>{
  const account='20261983',memberId=`member-${account}`;
  await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,'未排班维修人员','technician','南湖',?,'2026-01-01')").bind(account,hashPassword('StaffTest!2026')).run();
  await db.prepare("INSERT INTO staff_campus_grants VALUES(?,'南湖')").bind(account).run();
  tokens[account]=(await request('/api/auth/login',null,{account,password:'StaffTest!2026'})).body.token;
  assert.equal((await request('/api/field/home',account)).body.todayDuties.length,0);
  assert.equal((await request('/api/field/board','root001')).body.staffPresence.some(item=>item.memberId===memberId),false);
  const credential=await request('/api/attendance/events/field-event/token','root001',{revision:(await staffPlatformRepository(db).attendanceEvent('field-event')).revision});
  const signed=await request('/api/attendance/check-ins',account,{token:credential.body.token,requestId:crypto.randomUUID()});
  assert.equal(signed.status,200,JSON.stringify(signed.body));assert.equal(signed.body.nonScheduled,true);
  const home=(await request('/api/field/home',account)).body;assert.equal(home.state,'available');assert.equal(home.capability['repair.start'],true);
  const person=(await request('/api/field/board','root001')).body.staffPresence.find(item=>item.memberId===memberId);
  assert.equal(person.scheduled,false);assert.equal(person.canReceive,true);assert.equal(person.group,'repair');assert.ok(person.identities.some(item=>item.code==='repair'));
  await db.prepare('DELETE FROM staff_presence WHERE member_id=?').bind(memberId).run();
});

test('unscheduled lead keeps identity, signs in without repair qualification and stays within campus authorization',async()=>{
  const account='20261981';
  await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,'未排班负责人','technician','南湖',?,'2026-01-01')").bind(account,hashPassword('StaffTest!2026')).run();
  await db.prepare("INSERT INTO staff_campus_grants VALUES(?,'南湖'),(?,'浑南')").bind(account,account).run();
  await db.prepare('DELETE FROM member_work_profiles WHERE member_id=?').bind(`member-${account}`).run();
  await db.prepare("INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from) VALUES('unscheduled-lead',?,'role-repair-lead','{\"campusIds\":[\"campus-nanhu\"]}','2026-01-01')").bind(`member-${account}`).run();
  tokens[account]=(await request('/api/auth/login',null,{account,password:'StaffTest!2026'})).body.token;
  let home=(await request('/api/field/home',account)).body;
  assert.equal(home.todayDuties.length,0);
  assert.deepEqual(home.identities.map(item=>item.code),['repair_lead']);
  assert.equal(home.capability['repair.transfer'],false);
  assert.equal(home.directAttendance.allowed,true,'an authorized unscheduled leader can self-check-in');
  assert.equal((await request('/api/attendance/self-check-in',account,{campusId:'campus-hunnan',requestId:crypto.randomUUID()})).status,403,'campus grants alone do not grant a leader identity outside its scope');
  const signed=await request('/api/attendance/self-check-in',account,{campusId:'campus-nanhu',requestId:crypto.randomUUID()});
  assert.equal(signed.status,200,JSON.stringify(signed.body));assert.equal(signed.body.nonScheduled,true);
  home=(await request('/api/field/home',account)).body;
  assert.equal(home.capability['repair.transfer'],true);
  assert.equal(home.capability['repair.start'],false);
  assert.equal((await request('/api/field/home?campusId=campus-hunnan',account)).body.capability['repair.transfer'],false);
  const board=await request('/api/field/board',account);
  const person=board.body.staffPresence.find(item=>item.account===account);
  assert.equal(person.group,'repair');assert.equal(person.canReceive,false);assert.equal(person.scheduled,false);assert.ok(person.signedInAt);
  await db.prepare("UPDATE member_roles SET effective_to='2026-10-15' WHERE id='unscheduled-lead'").run();
  home=(await request('/api/field/home',account)).body;
  assert.equal(home.capability['repair.transfer'],false);assert.equal(home.identities.some(item=>item.code==='repair_lead'),false);
  assert.equal(home.directAttendance.allowed,false);
  assert.equal((await request('/api/attendance/self-check-in',account,{campusId:'campus-nanhu',directLeader:true,requestId:crypto.randomUUID()})).status,403,'body flags cannot restore expired leader authorization');
});

test('exchange import, activation, check-in and qualification revocation preserve the same member and exclude roster participation',async()=>{
  const repository=staffPlatformRepository(db);
  const account='20261982',memberId=`member-${account}`;
  const csv=`studentId,name,homeCampusId,departmentId,workProfiles,roleCodes,authorizedCampuses,trainingConfirmed\n${account},交流测试人员,campus-nanhu,dept-office,exchange,technician,campus-nanhu,true`;
  assert.equal((await request('/api/members/import','root001',{csv:csv.replace(',true',',false')})).status,400);
  const preview=await request('/api/members/import','root001',{csv});
  assert.equal(preview.body.mode,'preview');
  assert.deepEqual(preview.body.items[0].roleCodes,['exchange'],'legacy technician CSV uses the separate exchange role');
  assert.equal((await request('/api/members/import','root001',{csv:csv.replace('exchange,technician','exchange,exchange')})).status,200);
  assert.equal(await repository.memberRow(memberId),null);
  assert.equal((await request('/api/members/import','root001',{csv,confirm:true})).status,200);
  const activation=await request('/api/activation',null,{studentId:account,name:'交流测试人员',homeCampus:'南湖',password:'StaffTest!2026'});
  assert.equal(activation.status,201,JSON.stringify(activation.body));
  assert.equal((await request('/api/activation-requests/review','root001',{ids:[activation.body.id],status:'approved',identityVerified:true})).status,200);
  tokens[account]=(await request('/api/auth/login',null,{account,password:'StaffTest!2026'})).body.token;
  let home=(await request('/api/field/home',account)).body;
  assert.equal(home.actor.memberId,memberId);assert.deepEqual(home.identities.map(item=>item.code),['exchange']);
  assert.notEqual(home.permissions['roster.read'],true);
  assert.equal((await request('/api/me/roster',account)).status,403);
  const navigation=(await request('/api/auth/me',account)).body.navigation;
  for(const id of ['roster','roster-manage','office-roster','members','roles']) assert.equal(navigation.some(item=>item.id===id),false,id);
  assert.equal((await request('/api/field/board',account)).status,403);
  assert.deepEqual((await repository.profiles(memberId,'2026-10-15')).map(item=>item.profileCode),['exchange']);
  assert.deepEqual((await repository.roleBindings(memberId)).map(item=>item.roleId),['role-exchange']);
  const listed=(await request('/api/users','root001')).body.items.find(item=>item.account===account);
  assert.deepEqual(listed.roleNames,['交流人员'],'account management displays the assigned work role, not the legacy login type');
  assert.deepEqual((await repository.memberships(memberId,'2026-10-15')).map(item=>item.departmentId),['dept-office'],'exchange keeps the actual non-hardware department');
  const credential=await request('/api/attendance/events/field-event/token','root001',{revision:(await repository.attendanceEvent('field-event')).revision});
  const signed=await request('/api/attendance/check-ins',account,{token:credential.body.token,requestId:crypto.randomUUID()});
  assert.equal(signed.status,200,JSON.stringify(signed.body));
  home=(await request('/api/field/home',account)).body;assert.equal(home.state,'available');
  let person=(await request('/api/field/board','root001')).body.staffPresence.find(item=>item.memberId===memberId);
  assert.equal(person.canReceive,true);assert.equal(person.group,'repair');assert.equal(person.scheduled,false);
  const created=await request('/api/scan/onsite','root001',{requestId:crypto.randomUUID(),registrationFlow:'frontdesk',campus:'南湖',name:'交流维修机主',studentId:'20309982',social:'exchange-test',deviceType:'笔记本电脑',brand:'联想',deviceModel:'ThinkPad',warranty:'否',faultType:'系统问题',signature:[Array.from({length:10},(_,i)=>[.1+i*.05,.2+i*.03])]});
  assert.equal(created.status,201,JSON.stringify(created.body));
  const id=created.body.id,before=(await request(`/api/field/appointments/${id}`,account)).body,photos=[];
  assert.equal(before.canStart,true);
  for(const side of ['front','back']) {
    const upload=await request(`/api/appointments/${id}/attachments`,account,{filename:`${side}.png`,mimeType:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Hf8AAAAASUVORK5CYII=',purpose:`intake_${side}`});
    assert.equal(upload.status,201,JSON.stringify(upload.body));photos.push(upload.body.id);
  }
  const started=await request(`/api/appointments/${id}/status`,account,{status:'in_progress',revision:before.revision,frontPhotoId:photos[0],backPhotoId:photos[1],verification:{brand:'联想',model:'ThinkPad',warranty:'expired',liquidMetal:'no'},requestId:crypto.randomUUID()},'PATCH');
  assert.equal(started.status,200,JSON.stringify(started.body));
  assert.equal((await request('/api/field/home',account)).body.state,'repairing');
  const finished=await request(`/api/appointments/${id}/status`,account,{status:'completed',revision:started.body.revision,outcome:'repaired',repairNote:'交流人员完成系统维修',requestId:crypto.randomUUID()},'PATCH');
  assert.equal(finished.status,200,JSON.stringify(finished.body));
  assert.equal((await request('/api/field/home',account)).body.state,'available');
  const detail=(await request(`/api/members/${memberId}`,'root001')).body;
  const profile=detail.member.workProfiles[0];
  assert.equal((await request(`/api/members/${memberId}/work-profiles`,'20261002',{revision:detail.member.revision,id:profile.id,profileRevision:profile.revision,effectiveTo:'2026-10-15'})).status,403);
  const end={revision:detail.member.revision,id:profile.id,profileRevision:profile.revision,effectiveTo:'2026-10-15'};
  assert.equal((await request(`/api/members/${memberId}/work-profiles`,'root001',end)).status,200);
  assert.equal((await request(`/api/members/${memberId}/work-profiles`,'root001',end)).status,409);
  assert.equal((await request('/api/field/home',account)).status,401);
  tokens[account]=(await request('/api/auth/login',null,{account,password:'StaffTest!2026'})).body.token;
  home=(await request('/api/field/home',account)).body;assert.notEqual(home.state,'available');
  person=(await request('/api/field/board','root001')).body.staffPresence.find(item=>item.memberId===memberId);
  assert.equal(person.canReceive,false);assert.equal(person.identities.some(item=>item.code==='exchange'),false);
});

test('ordinary reception and repair roles cannot enter management or use legacy admin API shortcuts', async () => {
  for (const account of ['20261001', '20261002']) {
    const profile = await request('/api/auth/me', account);
    assert.equal(profile.status, 200);
    for (const code of ['members.manage', 'roles.manage', 'accounts.manage', 'statistics.read', 'settings.manage']) assert.notEqual(profile.body.permissions[code], true, `${account}: ${code}`);
    for (const entry of ['members','roles','users','stats','capacity','roster-manage']) assert.equal(profile.body.navigation.some(item => item.id === entry), false, `${account}: ${entry}`);
    for (const path of ['/api/members','/api/roles','/api/permissions','/api/users','/api/staff-whitelist','/api/activation-requests','/api/stats/summary','/api/export/appointments.csv','/api/slot-capacities']) {
      assert.equal((await request(path, account)).status, 403, `${account}: ${path}`);
    }
    assert.equal((await request('/api/users/20261003', account, { status: 'disabled' }, 'PATCH')).status, 403);
    assert.equal((await request('/api/slot-capacities', account, { items: [] }, 'PATCH')).status, 403);
  }
  const profile = await request('/api/auth/me', 'root001');
  for (const entry of ['members','roles','users','stats','capacity']) assert.ok(profile.body.navigation.some(item => item.id === entry), entry);
});

test('explicit scoped capabilities work for technicians and revocation invalidates old sessions and entries', async () => {
  const account = '20261901';
  await db.prepare("INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at) VALUES(?,'范围测试人员','technician','南湖',?,'2026-01-01')").bind(account, hashPassword('StaffTest!2026')).run();
  await db.prepare("INSERT INTO staff_campus_grants VALUES(?,'南湖'),(?,'浑南')").bind(account, account).run();
  async function login() { tokens[account] = (await request('/api/auth/login', null, { account, password: 'StaffTest!2026' })).body.token; }
  await login();
  const initial = (await request('/api/auth/me', account)).body;
  const role = await request('/api/roles', 'root001', { code: 'scoped_test', name: '范围配置员', grants: ['settings.manage','statistics.read'].map(permissionCode => ({ permissionCode, scope: { campusIds: ['campus-nanhu'] }, conditions: [] })) });
  assert.equal(role.status, 201, JSON.stringify(role.body));
  const detail = await request(`/api/members/${initial.actor.memberId}`, 'root001');
  assert.equal((await request(`/api/members/${initial.actor.memberId}/roles`, 'root001', { revision: detail.body.member.revision, bindings: [{ roleId: role.body.id, scope: { campusIds: ['campus-nanhu'] }, effectiveFrom: '2026-01-01' }] }, 'PUT')).status, 200);
  assert.equal((await request('/api/auth/me', account)).status, 401);
  await login();
  const granted = (await request('/api/auth/me', account)).body;
  for (const id of ['capacity','stats']) assert.ok(granted.navigation.some(entry => entry.id === id));
  const capacities = await request('/api/slot-capacities', account);
  assert.equal(capacities.status, 200, JSON.stringify(capacities.body));
  assert.ok(capacities.body.items.length);
  assert.ok(capacities.body.items.every(item => item.campus === '南湖'));
  assert.equal((await request('/api/slot-capacities/actual?campus=浑南&date=2026-10-15', account)).status, 403);
  const cell = capacities.body.items[0];
  assert.equal((await request('/api/slot-capacities', account, { items: [{ ...cell, capacity: cell.capacity }] }, 'PATCH')).status, 200);
  assert.equal((await request('/api/stats/summary', account)).status, 200);
  const updated = await request(`/api/roles/${role.body.id}`, 'root001', { revision: role.body.revision, grants: [] }, 'PATCH');
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal((await request('/api/slot-capacities', account)).status, 401);
  await login();
  const revoked = (await request('/api/auth/me', account)).body;
  assert.equal(revoked.navigation.some(entry => ['capacity','stats'].includes(entry.id)), false);
  assert.equal((await request('/api/slot-capacities', account)).status, 403);
  assert.equal((await request('/api/stats/summary', account)).status, 403);
  for (const path of ['/api/me/roster','/api/me/attendance','/api/leaves','/api/swaps']) assert.equal((await request(path, account)).status, 403, path);
});

test('actual capacity keeps date snapshots and scopes staffing by existing roster grants', async () => {
  const path = '/api/slot-capacities/actual?campus=%E5%8D%97%E6%B9%96&date=2026-10-15';
  assert.equal((await request(path, null)).status, 401);
  assert.equal((await request(path, '20261002')).status, 403);
  assert.equal((await request('/api/slot-capacities/actual?campus=浑南&date=2026-10-15', 'root001')).status, 403);
  assert.equal((await request('/api/slot-capacities/actual?campus=南湖&date=2026-02-30', 'root001')).status, 400);
  const initial = await request(path, 'root001');
  assert.equal(initial.status, 200, JSON.stringify(initial.body));
  assert.equal(initial.body.source, 'template');
  assert.equal(initial.body.items.length, 4);
  assert.deepEqual(initial.body.staffing, { repair: 3, office: 1 });
  const limited = await request(path, '20261001');
  assert.equal(limited.status, 403, JSON.stringify(limited.body));
  const date = '2026-10-22';
  const { results } = await db.prepare("SELECT * FROM weekday_slot_capacities WHERE campus='南湖' AND weekday=4").all();
  await db.batch(results.map(row => db.prepare('INSERT INTO booking_day_slots(campus,date,time_slot,capacity) VALUES(?,?,?,?)').bind(row.campus, date, row.time_slot, row.capacity)));
  const cell = results[0];
  await db.prepare('UPDATE weekday_slot_capacities SET capacity=capacity+2,revision=revision+1 WHERE campus=? AND weekday=4 AND time_slot=?').bind(cell.campus, cell.time_slot).run();
  const frozen = await request(`/api/slot-capacities/actual?campus=南湖&date=${date}`, 'root001');
  assert.equal(frozen.body.source, 'snapshot');
  assert.equal(frozen.body.items.find(item => item.timeSlot === cell.time_slot).capacity, cell.capacity);
  const future = await request('/api/slot-capacities/actual?campus=南湖&date=2026-10-29', 'root001');
  assert.equal(future.body.source, 'template');
  assert.equal(future.body.items.find(item => item.timeSlot === cell.time_slot).capacity, cell.capacity + 2);
  await db.prepare('UPDATE weekday_slot_capacities SET capacity=?,revision=revision+1 WHERE campus=? AND weekday=4 AND time_slot=?').bind(cell.capacity, cell.campus, cell.time_slot).run();
});

test('field number suggestions preserve suffix/date rules and campus privacy without decrypting customer fields',async()=>{
  const ids=['reserve020261015-89','reserve020261014-89','reserve120261015-89'];
  try{
    for(const [index,id] of ids.entries())await db.prepare(`INSERT INTO appointments(id,student_id,name,campus,social,device_type,brand,device_model,warranty,fault_type,date,time_slot,status,access_token_hash,credential_rotated_at,created_at,agreement_at,agreement_version,source,expires_at,outcome)
      VALUES(?,?,? ,?,'private-social','笔记本电脑','测试','测试','否','系统问题',?,'19:00–19:30','completed',?,'2026-10-15','2026-10-15','2026-10-15','v1.0','onsite','2026-10-15T13:30:00.000Z','repaired')`)
      .bind(id,`2090990${index}`,'private-name',index===2?'浑南':'南湖',index===1?'2026-10-14':'2026-10-15',String(index+1).repeat(64)).run();
    assert.equal((await request('/api/scan/search',null,{q:'89'})).status,401);
    assert.deepEqual((await request('/api/scan/search','20261002',{q:'8'})).body,{items:[],hasMore:false});
    const suffix=await request('/api/scan/search','20261002',{q:'89'});
    assert.equal(suffix.status,200,JSON.stringify(suffix.body));assert.deepEqual(suffix.body.items.map(item=>item.id),[ids[0]]);
    assert.deepEqual(Object.keys(suffix.body.items[0]).sort(),['campus','date','id','status','timeSlot']);
    const history=await request('/api/scan/search','20261002',{q:'20261014-89'});
    assert.equal(history.status,200,JSON.stringify(history.body));assert.deepEqual(history.body.items.map(item=>item.id),[ids[1]]);
    assert.equal((await request('/api/scan/search','20261002',{q:'20261015-89'})).body.items.some(item=>item.campus==='浑南'),false);
    assert.equal((await request('/api/scan/search','20261002',{q:'%'})).status,400);
  }finally{await db.batch(ids.map(id=>db.prepare('DELETE FROM appointments WHERE id=?').bind(id)));}
});

test("field day: reception, attendance, intake, transfer and completion share authoritative facts", async () => {
  const office = "20261001",
    tech = "20261002",
    next = "20261003",
    lead = "20261004";
  const home = await request("/api/field/home", tech);
  assert.equal(home.status, 200, JSON.stringify(home.body));
  assert.equal(home.body.state, "unsigned");
  assert.equal(
    (
      await request(
        "/api/presence/me",
        tech,
        { state: "available", revision: 0 },
        "PATCH",
      )
    ).status,
    409,
  );
  assert.equal((await request("/api/field/board", tech)).status, 403);
  assert.equal(
    (await request("/api/field/board?campusId=campus-hunnan", office)).status,
    403,
  );
  const event = await request("/api/attendance/events", office, {
    campusId: "campus-nanhu",
    businessDate: dateKey(new Date(testNow)),
    requestId: "field-event-request",
  });
  assert.equal(event.status, 201, JSON.stringify(event.body));
  const credential = await request(
    `/api/attendance/events/${event.body.id}/token`,
    office,
    { revision: event.body.revision },
  );
  assert.equal(credential.status, 200, JSON.stringify(credential.body));
  assert.equal((await request('/api/field/home',lead)).body.capability['repair.transfer'],false);
  assert.ok((await request('/api/field/home',lead)).body.identities.some(item => item.code==='repair_lead'));
  for (const account of [tech, next, lead]) {
    const signed = await request("/api/attendance/check-ins", account, {
      token: credential.body.token,
      requestId: `field-check-${account}`,
    });
    assert.equal(signed.status, 200, JSON.stringify(signed.body));
  }
  const duplicate = await request("/api/attendance/check-ins", tech, {
    token: credential.body.token,
  });
  assert.equal(duplicate.body.isExisting, true);
  const board = await request("/api/field/board", office);
  assert.equal(board.status, 200, JSON.stringify(board.body));
  assert.equal(board.body.staffPresence.filter((p) => p.canReceive).length, 3);
  assert.ok(board.body.staffPresence.find(p => p.account===lead).identities.some(item=>item.code==='repair_lead'));
  const signature = [
    Array.from({ length: 10 }, (_, i) => [0.1 + i * 0.05, 0.2 + i * 0.03]),
  ];
  const create = (number) =>
    request("/api/scan/onsite", office, {
      requestId: crypto.randomUUID(),
      registrationFlow: "frontdesk",
      campus: "南湖",
      name: "测试机主",
      studentId: `2030100${number}`,
      social: "test-contact",
      deviceType: "笔记本电脑",
      brand: "联想",
      deviceModel: `ThinkPad ${number}`,
      warranty: "否",
      faultType: "系统问题",
      signature,
    });
  const first = await create(1),
    second = await create(2);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(second.status, 201, JSON.stringify(second.body));
  assert.notEqual(first.body.id, second.body.id);
  const id = first.body.id;
  const before = await request(`/api/field/appointments/${id}`, tech);
  assert.equal(before.body.social, undefined);
  assert.equal(before.body.canStart, true);
  assert.equal(before.body.canCorrect, false);
  assert.equal(before.body.canRecoverCredential, false);
  assert.equal(before.body.original, null);
  assert.equal((await request(`/api/field/appointments/${id}/assignees`, tech)).status, 403);
  const rootDetail = await request(`/api/field/appointments/${id}`, 'root001');
  assert.equal(rootDetail.body.canCorrect, true);
  assert.equal(rootDetail.body.canRecoverCredential, true);
  assert.ok(rootDetail.body.original.signature);
  const officeDetail = await request(`/api/field/appointments/${id}`, office);
  assert.equal(officeDetail.body.canCorrect, false);
  assert.equal(officeDetail.body.canRecoverCredential, false);
  assert.equal((await request(`/api/appointments/${id}/correction`, office, { status: 'cancelled', revision: before.body.revision, correctionReason: '没有纠错授权时不能使用旧管理员身份绕过' }, 'PATCH')).status, 403);
  assert.equal((await request(`/api/appointments/${id}/credential`, office, { identityVerified: true, reason: '没有纠错授权时不能签发新的用户凭证' })).status, 403);
  const assignees = await request(`/api/field/appointments/${id}/assignees`, 'root001');
  assert.equal(assignees.status, 200);
  assert.ok(assignees.body.items.some(person => person.account === tech));
  assert.equal(
    (await request(`/api/field/appointments/${id}`, office)).body.social,
    "test-contact",
  );
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Hf8AAAAASUVORK5CYII=";
  const photos = [];
  for (const side of ["front", "back"]) {
    const photo = await request(`/api/appointments/${id}/attachments`, tech, {
      filename: `${side}.png`,
      mimeType: "image/png",
      data: png,
      purpose: `intake_${side}`,
    });
    assert.equal(photo.status, 201, JSON.stringify(photo.body));
    photos.push(photo.body.id);
  }
  const claim = {
    status: "in_progress",
    revision: before.body.revision,
    frontPhotoId: photos[0],
    backPhotoId: photos[1],
    verification: {
      brand: "联想",
      model: "ThinkPad 实机",
      warranty: "expired",
      liquidMetal: "no",
      note: "外观已核验",
    },
    requestId: "field-start-request",
  };
  const started = await request(
    `/api/appointments/${id}/status`,
    tech,
    claim,
    "PATCH",
  );
  assert.equal(started.status, 200, JSON.stringify(started.body));
  const candidates = await request(`/api/field/appointments/${id}/transfer-candidates`, lead);
  assert.equal(candidates.status, 200, JSON.stringify(candidates.body));
  assert.ok(candidates.body.items.some(person => person.account === next));
  assert.ok(!candidates.body.items.some(person => person.account === tech));
  assert.equal((await request(`/api/field/appointments/${id}/transfer-candidates`, tech)).status, 403);
  const replay = await request(
    `/api/appointments/${id}/status`,
    tech,
    claim,
    "PATCH",
  );
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM repair_intake_records WHERE appointment_id=?",
        )
        .bind(id)
        .first()
    ).n,
    1,
  );
  assert.equal(
    (
      await request(
        "/api/presence/me",
        tech,
        { state: "away", revision: 0 },
        "PATCH",
      )
    ).status,
    409,
  );
  assert.equal(
    (await request("/api/field/home", tech)).body.state,
    "repairing",
  );
  const active = await request(`/api/field/appointments/${id}`, lead);
  assert.equal(active.body.canTransfer, true);
  const transfer = {
    assignedTo: next,
    reason: "更换负责人员",
    revision: active.body.revision,
    requestId: "field-transfer-request",
  };
  assert.equal(
    (await request(`/api/appointments/${id}/transfer`, office, transfer))
      .status,
    403,
  );
  const moved = await request(
    `/api/appointments/${id}/transfer`,
    lead,
    transfer,
  );
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.equal(
    (await request("/api/field/home", tech)).body.currentRepair,
    null,
  );
  const current = (await request("/api/field/home", next)).body.currentRepair;
  assert.equal(current.id, id);
  assert.equal(current.intake.model, "ThinkPad 实机");
  const finish = {
    status: "completed",
    outcome: "repaired",
    repairNote: "重装驱动后测试正常",
    revision: current.revision,
    requestId: "field-finish-request",
  };
  assert.equal(
    (await request(`/api/appointments/${id}/status`, tech, finish, "PATCH"))
      .status,
    403,
  );
  const done = await request(
    `/api/appointments/${id}/status`,
    next,
    finish,
    "PATCH",
  );
  assert.equal(done.status, 200, JSON.stringify(done.body));
  assert.equal(
    (await request(`/api/appointments/${id}/status`, next, finish, "PATCH"))
      .status,
    200,
  );
  assert.equal(
    (await request("/api/field/home", next)).body.state,
    "available",
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_events WHERE action IN ('repairs.started','repairs.transferred','repairs.completed') AND json_extract(source_ref,'$.id')=?",
        )
        .bind(id)
        .first()
    ).n,
    3,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM operation_receipts WHERE json_extract(resource_ref,'$.id')=?",
        )
        .bind(id)
        .first()
    ).n,
    3,
  );
  // The original customer-provided model remains intact.
  assert.equal(
    (
      await db
        .prepare("SELECT device_model FROM appointments WHERE id=?")
        .bind(id)
        .first()
    ).device_model,
    "ThinkPad 1",
  );
});

test("failed audit rolls back intake and leaving races safely with taking a repair", async () => {
  const tech = "20261002";
  const { id } = await db
    .prepare(
      "SELECT id FROM appointments WHERE status='booked' ORDER BY id LIMIT 1",
    )
    .first();
  const photos = [];
  for (const side of ["front", "back"]) {
    const photo = await request(`/api/appointments/${id}/attachments`, tech, {
      filename: `${side}.png`,
      mimeType: "image/png",
      data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Hf8AAAAASUVORK5CYII=",
      purpose: `intake_${side}`,
    });
    assert.equal(photo.status, 201);
    photos.push(photo.body.id);
  }
  const before = await request(`/api/field/appointments/${id}`, tech);
  const claim = {
    status: "in_progress",
    revision: before.body.revision,
    frontPhotoId: photos[0],
    backPhotoId: photos[1],
    verification: {
      brand: "联想",
      model: "现场验证",
      warranty: "expired",
      liquidMetal: "no",
      note: "",
    },
    requestId: "field-atomic-claim",
  };
  await db
    .prepare(
      "CREATE TRIGGER field_test_audit_failure BEFORE INSERT ON audit_events WHEN NEW.action='repairs.started' BEGIN SELECT RAISE(ABORT,'simulated audit failure'); END;",
    )
    .run();
  assert.equal(
    (await request(`/api/appointments/${id}/status`, tech, claim, "PATCH"))
      .status,
    500,
  );
  assert.equal(
    (
      await db
        .prepare("SELECT status FROM appointments WHERE id=?")
        .bind(id)
        .first()
    ).status,
    "booked",
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM repair_intake_records WHERE appointment_id=?",
        )
        .bind(id)
        .first()
    ).n,
    0,
  );
  assert.equal(
    (
      await db
        .prepare(
          "SELECT COUNT(*) AS n FROM operation_receipts WHERE request_id=?",
        )
        .bind(claim.requestId)
        .first()
    ).n,
    0,
  );
  await db.prepare("DROP TRIGGER field_test_audit_failure").run();
  const home = (await request("/api/field/home", tech)).body;
  const [start, away] = await Promise.all([
    request(`/api/appointments/${id}/status`, tech, claim, "PATCH"),
    request(
      "/api/presence/me",
      tech,
      { state: "away", revision: home.presence.revision },
      "PATCH",
    ),
  ]);
  assert.equal(
    [start.status, away.status].filter((s) => s === 200).length,
    1,
    JSON.stringify({ start, away }),
  );
  const current = (await request("/api/field/home", tech)).body;
  assert.ok(current.state === "away" || current.state === "repairing");
  if (current.state === "repairing")
    assert.equal(current.presence.state, "available");
});

test("concurrent claims and transfers serialize; cross-day repairs survive and revoked sessions cannot read them", async () => {
  const office = "20261001",
    candidates = ["20261003", "20261004"];
  const home = (await request("/api/field/home", office)).body;
  const credential = await request(
    `/api/attendance/events/${home.event.id}/token`,
    office,
    { revision: home.event.revision },
  );
  for (const account of candidates)
    assert.equal(
      (
        await request("/api/attendance/check-ins", account, {
          token: credential.body.token,
          requestId: crypto.randomUUID(),
        })
      ).status,
      200,
    );
  const created = await request("/api/scan/onsite", office, {
    requestId: crypto.randomUUID(),
    registrationFlow: "frontdesk",
    campus: "南湖",
    name: "并发机主",
    studentId: "20301009",
    social: "private-concurrency-contact",
    deviceType: "笔记本电脑",
    brand: "联想",
    deviceModel: "并发验证设备",
    warranty: "否",
    faultType: "系统问题",
    signature: [
      Array.from({ length: 10 }, (_, i) => [0.1 + i * 0.05, 0.2 + i * 0.03]),
    ],
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  const bodies = [];
  for (const account of candidates) {
    const photos = [];
    for (const side of ["front", "back"]) {
      const photo = await request(
        `/api/appointments/${id}/attachments`,
        account,
        {
          filename: `${side}.png`,
          mimeType: "image/png",
          data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Hf8AAAAASUVORK5CYII=",
          purpose: `intake_${side}`,
        },
      );
      assert.equal(photo.status, 201, JSON.stringify(photo.body));
      photos.push(photo.body.id);
    }
    bodies.push({
      status: "in_progress",
      revision: created.body.revision,
      frontPhotoId: photos[0],
      backPhotoId: photos[1],
      verification: {
        brand: "联想",
        model: "并发验证设备",
        warranty: "expired",
        liquidMetal: "no",
        note: "",
      },
      requestId: crypto.randomUUID(),
    });
  }
  const claims = await Promise.all(
    candidates.map((account, i) =>
      request(`/api/appointments/${id}/status`, account, bodies[i], "PATCH"),
    ),
  );
  assert.equal(
    claims.filter((result) => result.status === 200).length,
    1,
    JSON.stringify(claims),
  );
  const winner = claims.findIndex((result) => result.status === 200),
    next = candidates[1 - winner];
  const transfer = {
    assignedTo: next,
    reason: "测试并发交接",
    revision: claims[winner].body.revision,
  };
  const transfers = await Promise.all(
    [1, 2].map(() =>
      request(`/api/appointments/${id}/transfer`, "20261004", {
        ...transfer,
        requestId: crypto.randomUUID(),
      }),
    ),
  );
  assert.equal(
    transfers.filter((result) => result.status === 200).length,
    1,
    JSON.stringify(transfers),
  );
  const previousDay = new Date(testNow - 86400000).toLocaleDateString(
    "en-CA",
    { timeZone: "Asia/Shanghai" },
  );
  await db
    .prepare("UPDATE appointments SET date=? WHERE id=?")
    .bind(previousDay, id)
    .run();
  const current = (await request("/api/field/home", next)).body.currentRepair;
  assert.equal(current.id, id);
  const officeList = await request("/api/appointments?status=all", office);
  assert.equal(officeList.status, 200);
  assert.equal(
    officeList.body.items.find((item) => item.id === id)?.social,
    undefined,
  );
  assert.equal(
    (await request(`/api/field/appointments/${id}`, office)).status,
    403,
  );
  assert.equal(
    (
      await request(
        `/api/appointments/${id}/status`,
        next,
        {
          status: "completed",
          revision: current.revision,
          repairNote: "跨日维修完成",
          outcome: "repaired",
          requestId: crypto.randomUUID(),
        },
        "PATCH",
      )
    ).status,
    200,
  );
  await db
    .prepare(
      "UPDATE staff_accounts SET token_version=token_version+1 WHERE account=?",
    )
    .bind(next)
    .run();
  assert.equal(
    (await request(`/api/field/appointments/${id}`, next)).status,
    401,
  );
  await db
    .prepare("DELETE FROM member_roles WHERE member_id='member-20261001'")
    .run();
  await db
    .prepare(
      "UPDATE staff_accounts SET auth_version=auth_version+1 WHERE account='20261001'",
    )
    .run();
  assert.equal((await request("/api/field/board", office)).status, 403);
});
