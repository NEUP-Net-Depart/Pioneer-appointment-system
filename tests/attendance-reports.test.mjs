import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAuthorizer } from '../src/modules/authorization/public.js';
import { attendanceReportingDomain } from '../src/services/staff-platform/reporting.js';
import {
  volunteerWorkbook,
  attendanceMatrixWorkbook,
  volunteerZip
} from '../frontend/staff-react/report-xlsx.js';
import { strFromU8, unzipSync } from 'fflate';

const volunteerTemplate = new Uint8Array(
  readFileSync(new URL('../frontend/assets/volunteer-register-template.xlsx', import.meta.url))
);

const actor = { account: 'reporter', role: 'technician' };
const baseRecords = [
  ['2026-05-25', 'ordinary'],
  ['2026-05-25', 'ordinary'],
  ['2026-05-26', 'ordinary'],
  ['2026-05-25', 'lead']
].map(([businessDate, memberId], index) => ({
  id: `record-${index}`,
  memberId,
  businessDate,
  campusId: 'campus-nanhu',
  primaryDepartmentIdSnapshot: 'dept-hardware',
  primaryDepartmentNameSnapshot: '硬件部',
  identitySnapshot: {
    name: memberId === 'lead' ? '负责人' : '维修人员',
    studentId: memberId === 'lead' ? '20260002' : '20260001'
  }
}));
const members = [
  {
    memberId: 'ordinary',
    name: '维修人员',
    studentId: '20260001',
    college: '信息学院',
    major: '计算机',
    campuses: ['南湖']
  },
  {
    memberId: 'lead',
    name: '负责人',
    studentId: '20260002',
    college: '信息学院',
    major: '软件工程',
    campuses: ['南湖']
  },
  {
    memberId: 'unsigned-lead',
    name: '未签到负责人',
    studentId: '20260003',
    college: '信息学院',
    major: '自动化',
    campuses: ['南湖']
  }
];
function leader(memberId) {
  return {
    memberId,
    name: members.find((item) => item.memberId === memberId).name,
    studentId: members.find((item) => item.memberId === memberId).studentId,
    active: true,
    role: 'technician',
    campuses: ['南湖'],
    profiles: [],
    memberships: [
      {
        departmentId: 'dept-hardware',
        departmentName: '硬件部',
        isPrimary: true,
        effectiveFrom: '2026-01-01'
      }
    ],
    grants: [
      {
        id: `grant-${memberId}`,
        roleCode: 'office_lead',
        permissionCode: 'roster.office.manage',
        scope: { campusIds: ['campus-nanhu'] },
        conditions: [],
        binding: { effectiveFrom: '2026-01-01' }
      }
    ]
  };
}
function setup(settings, records = baseRecords, options = {}) {
  const repository = {
    attendanceReportSettings: async () => ({ ...settings, revision: 0 }),
    weeklyAttendanceData: async () => ({ records, members: options.members || members }),
    serviceDays: async () => options.paused || [],
    rosterMemberFacts: async () => options.facts || [leader('lead'), leader('unsigned-lead')]
  };
  const context = {
    actor: { memberId: 'manager' },
    permissions: { 'attendance.export': true, 'settings.manage': true }
  };
  const domain = attendanceReportingDomain({
    repository,
    platform: { authorizer: createAuthorizer() },
    contextFor: async () => context,
    evaluate: (_context, _permission, target) => ({
      allowed: (options.allowed || ['campus-nanhu']).includes(target.campusId)
    })
  });
  return { domain, repository };
}

test('monthly volunteer report assigns the full Monday-Thursday week to its Monday month', async () => {
  const { domain } = setup({ countMode: 'weekly', hoursPerCount: 4, mergeLeaders: true });
  const report = await domain.volunteerReport(actor, { month: '2026-05' });
  const week = report.weeks.find((item) => item.weekStart === '2026-05-25');
  assert.equal(week.weekNumber, 4);
  assert.equal(week.weekEnd, '2026-05-28');
  assert.equal(week.campuses.length, 1);
  const rows = Object.fromEntries(week.campuses[0].rows.map((row) => [row.memberId, row]));
  assert.equal(rows.ordinary.count, 1);
  assert.equal(rows.ordinary.hours, 4);
  assert.equal(rows.lead.count, 1, 'leader sign-in does not add another credit');
  assert.equal(rows['unsigned-lead'].count, 1, 'leader without sign-in is included');
  assert.ok(!report.weeks.some((item) => item.weekStart === '2026-04-27'));
  const june = await domain.volunteerReport(actor, { month: '2026-06' });
  assert.ok(
    june.weeks.some((item) => item.weekStart === '2026-06-29' && item.weekEnd === '2026-07-02')
  );
});

test('volunteer modes count once weekly or once per distinct day', async () => {
  for (const [countMode, expected] of [
    ['weekly', 1],
    ['actual', 2]
  ]) {
    const { domain } = setup({ countMode, hoursPerCount: 2.5, mergeLeaders: true });
    const report = await domain.volunteerReport(actor, { month: '2026-05' });
    const rows = report.weeks.find((item) => item.weekStart === '2026-05-25').campuses[0].rows;
    assert.equal(rows.find((row) => row.memberId === 'ordinary').hours, expected * 2.5);
    assert.equal(rows.find((row) => row.memberId === 'lead').hours, 2.5);
  }
});

test('merged leaders receive one campus credit and no credit when the week is suspended', async () => {
  const both = leader('lead');
  both.campuses = ['南湖', '浑南'];
  both.grants[0].scope.campusIds = ['campus-nanhu', 'campus-hunnan'];
  both.grants.push({
    ...both.grants[0],
    id: 'repair-lead-grant',
    roleCode: 'repair_lead',
    permissionCode: 'repair.transfer'
  });
  both.assignments = [{ businessDate: '2026-05-25', campusId: 'campus-hunnan' }];
  const report = await setup(
    { countMode: 'actual', hoursPerCount: 4, mergeLeaders: true },
    [...baseRecords, { ...baseRecords[3], id: 'second-campus', campusId: 'campus-hunnan' }],
    { facts: [both], allowed: ['campus-nanhu', 'campus-hunnan'] }
  ).domain.volunteerReport(actor, { month: '2026-05' });
  const campuses = report.weeks.find((item) => item.weekStart === '2026-05-25').campuses;
  assert.equal(
    campuses.flatMap((campus) => campus.rows).filter((row) => row.memberId === 'lead').length,
    1
  );
  assert.equal(campuses.find((campus) => campus.campusId === 'campus-hunnan').rows[0].hours, 4);

  const paused = Array.from({ length: 4 }, (_, index) => ({
    businessDate: `2026-05-${25 + index}`,
    campusId: 'campus-nanhu',
    paused: true
  }));
  const suspended = await setup(
    { countMode: 'weekly', hoursPerCount: 4, mergeLeaders: true },
    baseRecords,
    { paused }
  ).domain.volunteerReport(actor, { month: '2026-05' });
  assert.deepEqual(
    suspended.weeks.find((item) => item.weekStart === '2026-05-25').campuses[0].rows,
    []
  );
});

test('future weeks do not grant volunteer hours before service begins', async () => {
  const report = await setup(
    { countMode: 'weekly', hoursPerCount: 4, mergeLeaders: true },
    []
  ).domain.volunteerReport(actor, { month: '2099-05' });
  assert.ok(report.weeks.length > 0);
  assert.ok(
    report.weeks.every((week) => week.campuses.every((campus) => campus.rows.length === 0))
  );
});

test('attendance matrix counts a member once per actual day and excludes paused and hidden facts', async () => {
  const records = [
    ...baseRecords,
    { ...baseRecords[0], id: 'hidden', campusId: 'campus-hunnan' },
    { ...baseRecords[0], id: 'paused', businessDate: '2026-05-27', servicePaused: true }
  ];
  const { domain } = setup({ countMode: 'actual', hoursPerCount: 4, mergeLeaders: false }, records);
  const report = await domain.attendanceMatrix(actor, { month: '2026-05' });
  assert.deepEqual(report.dates, ['2026-05-25', '2026-05-26']);
  assert.deepEqual(report.rows.find((row) => row.memberId === 'ordinary').days, report.dates);
  assert.ok(report.rows.every((row) => row.campusId === 'campus-nanhu'));
});

test('generated Excel files contain the required headers, week dates and numeric hours', () => {
  const week = {
    weekStart: '2026-05-25',
    weekEnd: '2026-05-28',
    weekNumber: 4,
    rows: [{ college: '信息学院', name: '测试人员', studentId: '00123456', hours: 4 }]
  };
  const templateFiles = unzipSync(volunteerTemplate);
  const generatedFiles = unzipSync(volunteerWorkbook('2026-05', week, volunteerTemplate));
  const sheet = strFromU8(generatedFiles['xl/worksheets/sheet1.xml']);
  assert.match(sheet, /信息采集表（2026年5月）/);
  assert.match(sheet, /2026年5月25日-5月28日/);
  assert.match(sheet, /<c r="E4" s="2"><v>4<\/v><\/c>/);
  assert.match(sheet, /<c r="C4" s="9" t="inlineStr">/);
  assert.deepEqual(generatedFiles['xl/styles.xml'], templateFiles['xl/styles.xml']);
  assert.deepEqual(
    generatedFiles['xl/worksheets/sheet2.xml'],
    templateFiles['xl/worksheets/sheet2.xml']
  );
  assert.deepEqual(
    generatedFiles['xl/worksheets/sheet3.xml'],
    templateFiles['xl/worksheets/sheet3.xml']
  );
  assert.match(sheet, /<mergeCells count="2"/);
  assert.match(sheet, /<dataValidations count="2"/);
  assert.doesNotMatch(strFromU8(templateFiles['xl/worksheets/sheet1.xml']), /20240316/);
  const archive = unzipSync(
    volunteerZip(
      {
        month: '2026-05',
        weeks: [{ ...week, campuses: [{ campus: '南湖', rows: week.rows }] }]
      },
      volunteerTemplate
    )
  );
  assert.ok(archive['南湖先锋5月4周.xlsx']);
  const expanded = unzipSync(
    volunteerWorkbook('2026-05', { ...week, rows: Array(21).fill(week.rows[0]) }, volunteerTemplate)
  );
  assert.match(strFromU8(expanded['xl/workbook.xml']), /Sheet1!\$A\$1:\$O\$24/);
  assert.match(strFromU8(expanded['xl/worksheets/sheet1.xml']), /<c r="A24" s="9" t="inlineStr">/);
  assert.ok(
    unzipSync(
      attendanceMatrixWorkbook({
        month: '2026-05',
        dates: ['2026-05-25'],
        rows: [
          {
            campus: '南湖',
            department: '硬件部',
            name: '测试人员',
            studentId: '00123456',
            days: ['2026-05-25']
          }
        ]
      })
    )['xl/worksheets/sheet1.xml']
  );
});
