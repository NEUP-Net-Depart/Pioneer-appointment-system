import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceHistory } from '../src/modules/attendance/history.js';
import { attendanceReportingDomain } from '../src/services/staff-platform/reporting.js';

const assignment = (memberId, extra = {}) => ({ memberId, memberName: memberId, campusId: 'campus-nanhu', businessDate: '2026-11-12', startAt: '19:00', endAt: '21:00', dutyType: 'repair', ...extra });
const run = (assignments, records = [], paused = []) => attendanceHistory({ assignments, records, paused, now: '2026-11-14T08:00:00Z' });

test('history automatically marks unsigned completed shifts absent, distinguishing leave and future', () => {
  const report = run([assignment('missing'), assignment('absent', { review: { decision: 'absent' } }), assignment('leave', { leaveStatus: 'recorded' }), assignment('future', { businessDate: '2026-11-16' })]);
  const states = Object.fromEntries(report.rows.map(row => [row.memberId, row.entries[0].status]));
  assert.deepEqual(states, { missing: 'absent', absent: 'absent', future: 'upcoming', leave: 'leave' });
});

test('multiple shifts count once, real attendance supersedes absence, and support is separate', () => {
  const report = run([assignment('signed', { review: { decision: 'absent' } }), assignment('signed', { dutyType: 'office' })], [assignment('signed'), assignment('support')]);
  const signed = report.rows.find(row => row.memberId === 'signed');
  assert.equal(signed.summary.expected, 1);
  assert.equal(signed.summary.arrived, 1);
  assert.equal(signed.summary.absent, 0);
  assert.equal(signed.entries[0].assignments.length, 2);
  const support = report.rows.find(row => row.memberId === 'support');
  assert.equal(support.summary.expected, 0);
  assert.equal(support.summary.support, 1);
});

test('paused service retains history without counting attendance or expected shifts', () => {
  const report = run([assignment('paused')], [assignment('paused')], [{ campusId: 'campus-nanhu', businessDate: '2026-11-12', paused: true }]);
  assert.equal(report.rows[0].entries[0].status, 'paused');
  assert.equal(report.rows[0].summary.expected, 0);
  assert.equal(report.rows[0].summary.arrived, 0);
  assert.deepEqual(report.rows[0].days, []);
});

test('history keeps campus groups separate and does not expose internal review metadata', () => {
  const report = run([assignment('person', { review: { decision: 'absent', reason: 'private' } }), assignment('person', { campusId: 'campus-hunnan' })]);
  assert.equal(report.rows.length, 2);
  assert.equal(JSON.stringify(report).includes('private'), false);
});

test('report service filters members and campuses before aggregation and restricts check-in sources', async () => {
  const record = assignment('visible', { primaryDepartmentIdSnapshot: 'dept-hardware', occurredAt: '2026-11-12T11:00:00Z', checkinSource: { kind: 'qr', issuerName: 'issuer' } });
  const repository = {
    weeklyAttendanceData: async () => ({ members: [], records: [record, { ...record, memberId: 'hidden' }, { ...record, campusId: 'campus-hunnan' }] }),
    dutyDay: async () => ({ assignments: [assignment('visible'), assignment('hidden')] }),
    serviceDays: async () => [],
    membershipsForMembers: async () => []
  };
  let manage = false;
  const domain = attendanceReportingDomain({ repository, contextFor: async () => ({ permissions: { 'attendance.export': true } }), evaluate: (_context, action, target) => ({ allowed: target.campusId === 'campus-nanhu' && target.memberId !== 'hidden' && (action !== 'attendance.correct' || manage) }) });
  const report = await domain.attendanceMatrix({}, { month: '2026-11' });
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].canManage, false);
  assert.equal(report.rows[0].entries[0].record.checkinSource, undefined);
  manage = true;
  const managed = await domain.attendanceMatrix({}, { month: '2026-11' });
  assert.equal(managed.rows[0].entries[0].record.checkinSource.issuerName, 'issuer');
});

test('absence follows the last non-leave shift end and disappears after correction without a review', () => {
  const assignments = [assignment('person'), assignment('person', { endAt: '22:00', review: { decision: 'cleared' } })];
  const make = (now, records = []) => attendanceHistory({ assignments, records, paused: [], now }).rows[0];
  assert.equal(make('2026-11-12T13:30:00Z').entries[0].status, 'upcoming');
  assert.equal(make('2026-11-12T14:00:00Z').summary.absent, 1);
  const corrected = make('2026-11-12T14:10:00Z', [assignment('person')]);
  assert.equal(corrected.summary.absent, 0);
  assert.equal(corrected.summary.arrived, 1);
});

test('department order puts hardware first, groups remaining departments and places unknown departments last', () => {
  const report = attendanceHistory({ assignments: ['office', 'hardware', 'unknown', 'office2'].map(id => assignment(id)), records: [], paused: [], now: '2026-11-14T08:00:00Z', departments: new Map([
    ['office', { departmentName: '办公室', departmentCode: 'office' }],
    ['office2', { departmentName: '办公室', departmentCode: 'office' }],
    ['hardware', { departmentName: '硬件部', departmentCode: 'hardware' }]
  ]) });
  assert.deepEqual(report.rows.map(row => row.memberId), ['hardware', 'office', 'office2', 'unknown']);
});
