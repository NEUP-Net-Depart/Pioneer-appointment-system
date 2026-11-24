import type { DutyType } from '../shared/staff-types.ts';
import { database, seedStaff } from './helpers/database.ts';
import { staffActor, staffServices } from './fixtures/staff-services.ts';
import { staffPlatformRepository } from '../src/db/staff-platform.ts';
import { present } from './helpers/present.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceHistory } from '../src/modules/attendance/history.ts';
import { attendanceReportingDomain } from '../src/services/staff-platform/reporting.ts';

const assignment = (memberId: string, extra: { dutyType?: DutyType; businessDate?: string; campusId?: string; endAt?: string; review?: { decision: string; reason?: string }; leaveStatus?: string } = {}) => ({ memberId, memberName: memberId, campusId: 'campus-nanhu', businessDate: '2026-11-12', startAt: '19:00', endAt: '21:00', dutyType: 'repair' as DutyType, ...extra });
type HistoryInput = Parameters<typeof attendanceHistory>[0];
type Assignment = ReturnType<typeof assignment>;
const run = (assignments: Assignment[], records: Assignment[] = [], paused: HistoryInput['paused'] = []) => attendanceHistory({ assignments, records, paused, now: '2026-11-14T08:00:00Z' });

test('history counts published shifts regardless of retired leave metadata and distinguishes future dates', () => {
  const report = run([assignment('missing'), assignment('absent', { review: { decision: 'absent' } }), assignment('leave', { leaveStatus: 'recorded' }), assignment('future', { businessDate: '2026-11-16' })]);
  const states = Object.fromEntries(report.rows.map(row => [row.memberId, row.entries[0].status]));
  assert.deepEqual(states, { missing: 'absent', absent: 'absent', future: 'upcoming', leave: 'absent' });
  const legacy = report.rows.find(row => row.memberId === 'leave');
  assert.equal(present(legacy).summary.expected, 1);
  assert.equal('leave' in present(legacy).summary, false);
  assert.equal('leaveStatus' in present(legacy).entries[0].assignments[0], false);
});

test('multiple shifts count once, real attendance supersedes absence, and support is separate', () => {
  const report = run([assignment('signed', { review: { decision: 'absent' } }), assignment('signed', { dutyType: 'office' })], [assignment('signed'), assignment('support')]);
  const signed = report.rows.find(row => row.memberId === 'signed');
  assert.equal(present(signed).summary.expected, 1);
  assert.equal(present(signed).summary.arrived, 1);
  assert.equal(present(signed).summary.absent, 0);
  assert.equal(present(signed).entries[0].assignments.length, 2);
  const support = report.rows.find(row => row.memberId === 'support');
  assert.equal(present(support).summary.expected, 0);
  assert.equal(present(support).summary.support, 1);
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

test('report service filters members and campuses before aggregation and restricts check-in sources', async (t) => {
  const db = database();
  t.after(() => db.sqlite.close());
  seedStaff(db, '20261001');
  const actor = staffActor({ account: '20261001', memberId: 'member-20261001' });
  const staff = staffServices(db, '00'.repeat(32));
  const repository = staffPlatformRepository(db);
  type WeeklyData = Awaited<ReturnType<typeof repository.weeklyAttendanceData>>;
  const record: WeeklyData['records'][number] = {
    ...assignment('visible'), id: 'checkin', eventId: 'duty', dedupeKey: 'duty',
    type: 'duty', method: 'qr', sourceRef: {}, studentId: 'test', nonScheduled: false,
    revision: 0, identitySnapshot: {}, primaryDepartmentNameSnapshot: null,
    primaryDepartmentIdSnapshot: 'dept-hardware', occurredAt: '2026-11-12T11:00:00Z',
    recordedAt: '2026-11-12T11:00:00Z', checkinSource: { kind: 'qr', issuerName: 'issuer' }
  };
  repository.weeklyAttendanceData = async () => ({ members: [], records: [record, { ...record, memberId: 'hidden' }, { ...record, campusId: 'campus-hunnan' }] });
  repository.dutyDay = async () => ({ assignments: ['visible', 'hidden'].map(id => ({ ...assignment(id), id, campusId: 'campus-nanhu', weekId: 'week', active: true, revision: 0, studentId: '', memberStatus: 'active' })) });
  repository.serviceDays = async () => [];
  repository.membershipsForMembers = async () => [];
  let manage = false;
  const domain = attendanceReportingDomain({
    repository,
    contextFor: async () => {
      const context = await staff.contextFor(actor);
      return { ...context, permissions: { ...context.permissions, 'attendance.export': true } };
    },
    evaluate: (context, action, target) => ({ ...staff.evaluate(context, action, target), allowed: target.campusId === 'campus-nanhu' && target.memberId !== 'hidden' && (action !== 'attendance.correct' || manage) })
  });
  const report = await domain.attendanceMatrix(actor, { month: '2026-11' });
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].canManage, false);
  assert.equal(present(report.rows[0].entries[0].record).checkinSource, undefined);
  manage = true;
  const managed = await domain.attendanceMatrix(actor, { month: '2026-11' });
  assert.equal(present(present(managed.rows[0].entries[0].record).checkinSource).issuerName, 'issuer');
});

test('absence follows the last shift end and disappears after correction without a review', () => {
  const assignments = [assignment('person'), assignment('person', { endAt: '22:00', review: { decision: 'cleared' } })];
  const make = (now: string, records: Assignment[] = []) => attendanceHistory({ assignments, records, paused: [], now }).rows[0];
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
