import test from 'node:test';
import assert from 'node:assert/strict';
import { database, seedStaff } from './helpers/database.mjs';
import { staffIdentities } from '../shared/staff-identities.js';
import { staffPlatformRepository } from '../src/db/staff-platform.js';
import { composeStaffPlatform } from '../src/app/compose.js';
import { staffPlatformService } from '../src/services/staff-platform.js';
import { userRepository } from '../src/db/users.js';

test('account lists and member identities describe appointments rather than legacy login types', async (t) => {
  const db = database();
  t.after(() => db.sqlite.close());
  seedStaff(db, '20261001');
  db.sqlite.exec(
    "UPDATE staff_accounts SET role='admin'; INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,created_at) VALUES('hardware','member-20261001','dept-hardware','primary',1,'member','2026-01-01','2026-01-01'),('exchange','member-20261001','dept-hardware','exchange',0,'member','2026-01-01','2026-01-01'),('affairs','member-20261001','dept-office','maintenance_affairs',0,'member','2026-01-01','2026-01-01'),('expired','member-20261001','dept-network','maintenance_affairs',0,'member','2025-01-01','2025-01-01'); UPDATE member_department_memberships SET effective_to='2026-01-01' WHERE id='expired';"
  );
  const users = userRepository(db);
  const list = await users.list(['南湖']);
  const detail = await users.find('20261001', { withRoles: true });
  assert.deepEqual(list[0].identities, detail.identities);
  assert.deepEqual(
    detail.identities.map((item) => item.label).sort(),
    ['工作人员', '硬件部部员', '交流维修', '维修事务'].sort()
  );
  assert.equal(
    detail.identities.some((item) => /管理员|交流人员/.test(item.label)),
    false
  );
  assert.equal(staffIdentities({ actor: { role: 'admin' } }).length, 1);
});

test('independent identities work without selecting a department and cannot overlap or duplicate through import', async (t) => {
  const db = database();
  t.after(() => db.sqlite.close());
  seedStaff(db, '20261001');
  db.sqlite.exec(
    "INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,created_at) VALUES('head','member-20261001','dept-office','primary',1,'head','2026-01-01','2026-01-01');"
  );
  const repository = staffPlatformRepository(db);
  const platform = composeStaffPlatform({ repository });
  const staff = staffPlatformService({ repository, platform, manifests: platform.manifests });
  const actor = await userRepository(db).find('20261001');
  const { member } = await staff.createMember(actor, {
    studentId: '20269901',
    name: '独立身份测试',
    homeCampusId: 'campus-nanhu',
    exchangeParticipation: true,
    effectiveFrom: '2026-01-01'
  });
  const add = async (assignmentType, extra = {}) =>
    staff.addMembership(actor, member.memberId, {
      assignmentType,
      effectiveFrom: '2026-01-01',
      revision: (await repository.memberRow(member.memberId)).revision,
      requestId: crypto.randomUUID(),
      ...extra
    });
  await add('maintenance_affairs');
  assert.deepEqual(
    (await repository.listMemberships(member.memberId)).map((item) => item.assignmentType).sort(),
    ['exchange', 'maintenance_affairs']
  );
  await assert.rejects(add('exchange'), (error) => error.status === 409);
  await assert.rejects(
    add('maintenance_affairs', { departmentId: 'dept-office' }),
    (error) => error.status === 409
  );
  await assert.rejects(
    add('maintenance_affairs', { positionCode: 'head' }),
    (error) => error.status === 400
  );
  db.sqlite
    .prepare(
      "UPDATE member_department_memberships SET department_id='dept-office' WHERE member_id=? AND assignment_type='maintenance_affairs'"
    )
    .run(member.memberId);
  const preview = await staff.importMembers(actor, {
    csv: 'studentId,name\n20269901,独立身份测试',
    defaults: {
      homeCampusId: 'campus-nanhu',
      exchangeParticipation: true,
      maintenanceParticipation: true,
      effectiveFrom: '2026-01-01'
    }
  });
  assert.equal(preview.summary.skipped, 1);
  assert.deepEqual(preview.items[0].changes, []);
  await assert.rejects(add('primary'), (error) => error.status === 400);
});
