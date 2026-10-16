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
  for (const account of [tech, next]) {
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
  assert.equal(board.body.staffPresence.filter((p) => p.canReceive).length, 2);
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
