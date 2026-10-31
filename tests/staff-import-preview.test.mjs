import test from 'node:test';
import assert from 'node:assert/strict';
import { membersDomain } from '../src/services/staff-platform/members.js';
import { planningDomain } from '../src/services/staff-platform/planning.js';
import { createAuthorizer } from '../src/modules/authorization/public.js';

const actor = { account: 'manager' };

test('education import previews college by major and rejects changed content or revisions', async () => {
  const member = {
    memberId: 'member-1',
    studentId: '20260001',
    name: '测试人员',
    homeCampusId: 'campus-nanhu',
    revision: 3,
    college: '',
    major: ''
  };
  let saved;
  const repository = {
    listMembers: async () => [member],
    memberships: async () => [],
    accountForMember: async () => null,
    importEducation: async (items) => {
      saved = items;
    }
  };
  const context = {
    actor: { memberId: 'manager-1' },
    businessDate: '2026-10-31',
    authVersion: 1,
    permissions: { 'members.manage': true }
  };
  const domain = membersDomain({
    repository,
    platform: {},
    contextFor: async () => context,
    evaluate: () => ({ allowed: true })
  });
  const csv = 'studentId,major,college\n20260001,计算机科学与技术,\n';
  const input = { csv, collegeByMajor: { 计算机科学与技术: '计算机学院' } };
  const preview = await domain.importEducation(actor, input);
  assert.equal(preview.items[0].college, '计算机学院');
  await assert.rejects(
    domain.importEducation(actor, {
      ...input,
      confirm: true,
      previewToken: preview.previewToken,
      collegeByMajor: { 计算机科学与技术: '其他学院' },
      expectedRevisions: { 20260001: 3 }
    }),
    /重新预览/
  );
  assert.equal(saved, undefined);
  member.revision = 4;
  await assert.rejects(
    domain.importEducation(actor, {
      ...input,
      confirm: true,
      previewToken: preview.previewToken,
      expectedRevisions: { 20260001: 3 }
    }),
    /重新预览/
  );
  member.revision = 3;
  await domain.importEducation(actor, {
    ...input,
    confirm: true,
    previewToken: preview.previewToken,
    expectedRevisions: { 20260001: 3 }
  });
  assert.equal(saved[0].college, '计算机学院');
  repository.accountForMember = async () => ({ protected: true });
  await assert.rejects(domain.importEducation(actor, input), /受保护系统账号/);
});

test('college-only import keeps existing major and requires a matching preview', async () => {
  const member = {
    memberId: 'member-1',
    studentId: '20260001',
    name: '测试人员',
    homeCampusId: 'campus-nanhu',
    revision: 3,
    college: '',
    major: '软件工程'
  };
  let saved;
  const domain = membersDomain({
    repository: {
      listMembers: async () => [member],
      memberships: async () => [],
      accountForMember: async () => null,
      importEducation: async (items) => {
        saved = items;
      }
    },
    platform: {},
    contextFor: async () => ({
      actor: { memberId: 'manager-1' },
      businessDate: '2026-10-31',
      authVersion: 1,
      permissions: { 'members.manage': true }
    }),
    evaluate: () => ({ allowed: true })
  });
  const csv = 'studentId,college\n20260001,\n';
  const preview = await domain.importEducation(actor, { csv });
  const selected = await domain.importEducation(actor, {
    csv,
    collegeByStudentId: { 20260001: '软件学院' }
  });
  await domain.importEducation(actor, {
    csv,
    confirm: true,
    collegeByStudentId: { 20260001: '软件学院' },
    previewToken: selected.previewToken,
    expectedRevisions: { 20260001: 3 }
  });
  assert.notEqual(preview.previewToken, selected.previewToken);
  assert.equal(saved[0].college, '软件学院');
  assert.equal(saved[0].major, '软件工程');
});

test('staff can edit their own name and college but not identity or authorization fields', async () => {
  const member = {
    id: 'member-1',
    name: '测试人员',
    student_id: '20260001',
    college: '',
    major: '',
    home_campus_id: 'campus-nanhu',
    status: 'active',
    revision: 2
  };
  let update;
  const domain = membersDomain({
    repository: {
      memberRow: async (id) => (id === member.id ? member : null),
      updateMember: async (id, patch, revision, audit) => {
        update = { id, patch, revision, audit };
        return { ...member, college: patch.college, revision: revision + 1 };
      }
    },
    platform: {},
    contextFor: async () => ({ actor: { memberId: member.id }, authVersion: 4 })
  });
  assert.equal((await domain.ownProfile(actor)).member.college, '');
  await assert.rejects(
    domain.ownProfile(actor, { college: '软件学院', revision: 2, status: 'inactive' }),
    /仅可修改/
  );
  await assert.rejects(domain.ownProfile(actor, { college: '任意学院', revision: 2 }), /请选择/);
  const result = await domain.ownProfile(actor, { college: '软件学院', revision: 2 });
  assert.equal(result.member.college, '软件学院');
  assert.equal(update.id, member.id);
  assert.equal(update.audit.action, 'identity.member.profile.updated');
  assert.deepEqual(update.patch, { college: '软件学院' });
  await domain.ownProfile(actor, { name: '新姓名', college: '软件学院', revision: 2 });
  assert.deepEqual(update.patch, { name: '新姓名', college: '软件学院' });
});

test('roster CSV import binds confirmation to the previewed draft and rejects changed files', async () => {
  const weekStart = '2026-11-02';
  const task = {
    id: 'task-1',
    weekStart,
    dutyType: 'office',
    workflowVersion: 1,
    campusScope: { campusIds: ['campus-nanhu'], departmentIds: [] },
    slotStart: '18:00',
    slotEnd: '20:00',
    memberIds: ['member-1'],
    requirements: [],
    revision: 1
  };
  const version = { id: 'draft-1', taskId: task.id, status: 'draft', version: 1 };
  const existing = [
    {
      memberId: 'member-1',
      businessDate: '2026-11-02',
      campusId: 'campus-nanhu',
      dutyType: 'office',
      startAt: '18:00',
      endAt: '20:00',
      roleKind: '',
      locked: true
    }
  ];
  let saved;
  const repository = {
    rosterTaskById: async () => task,
    serviceDays: async () => [],
    availability: async () => [],
    rosterMemberFacts: async () => [
      {
        memberId: 'member-1',
        name: '测试人员',
        studentId: '20260001',
        active: true,
        campuses: ['南湖'],
        profiles: [{ profileCode: 'office', effectiveFrom: '2026-01-01' }],
        memberships: [],
        grants: [],
        assignments: []
      }
    ],
    rosterVersionsForTask: async () => [version],
    rosterVersionById: async () => version,
    versionAssignments: async () => existing,
    updateRosterDraft: async (_id, input) => {
      saved = input;
      return { ...version, version: 2 };
    },
    rosterAudit: true
  };
  const context = {
    actor: { memberId: 'manager-1' },
    businessDate: '2026-10-31',
    authVersion: 1,
    grants: []
  };
  const domain = planningDomain({
    repository,
    platform: {
      authorizer: {
        ...createAuthorizer(),
        evaluate: () => ({ allowed: true })
      }
    },
    contextFor: async () => context,
    commandRecord: () => ({
      actorMemberId: 'manager-1',
      actorAccount: actor.account,
      requestId: 'request-1'
    }),
    rosterWrite: async (write) => write()
  });
  const csv = '姓名,学号,日期,校区,岗位\n测试人员,20260001,2026-11-02,南湖,办公人员\n';
  const preview = await domain.importRoster(actor, task.id, { csv, version: 1 });
  assert.equal(preview.assignments.length, 1);
  await assert.rejects(
    domain.importRoster(actor, task.id, {
      csv: `${csv}测试人员,20260001,2026-11-03,南湖,办公人员\n`,
      version: 1,
      confirm: true,
      previewToken: preview.previewToken
    }),
    /重新预览/
  );
  assert.equal(saved, undefined);
  await domain.importRoster(actor, task.id, {
    csv,
    version: 1,
    confirm: true,
    previewToken: preview.previewToken
  });
  assert.equal(saved.assignments[0].businessDate, '2026-11-02');
  assert.equal(saved.assignments[0].locked, true);
});
