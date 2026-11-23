import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestDuties } from '../src/modules/rosters/suggestions.js';
import { dutyPlanningReview, manualDutyPriority } from '../shared/duty.js';
import { addDays, dutyWeekKey, rosterWeekKey } from '../shared/time.js';

const weekStart = '2026-11-16', campusId = 'campus-nanhu';
const post = (departmentCode = 'hardware', assignmentType = 'primary') => ({
  departmentCode, assignmentType, isPrimary: assignmentType === 'primary', positionCode: 'member', effectiveFrom: '2026-01-01'
});
function scenario(windows) {
  const people = windows.map((days, index) => ({ memberId: `member-${index}`, name: `成员${index}`, memberships: [post()], assignments: [] }));
  return {
    weekStart, campusId, people, paused: [],
    availability: windows.map((days, index) => ({ memberId: people[index].memberId, dutyType: 'repair', weekStart: '', windows: days.map((weekday) => ({ weekday, campusId, startAt: '19:00', endAt: '21:00' })) }))
  };
}

test('balanced matching resolves the avoidable coverage gap without availability conflicts', () => {
  const input = scenario([[1, 2], [1, 3], [1, 3]]);
  input.paused = [addDays(weekStart, 3)];
  const result = suggestDuties(input);
  assert.equal(result.assignments.length, 3);
  assert.equal(new Set(result.assignments.map((row) => row.businessDate)).size, 3);
  assert.equal(result.optimization.conflicts, 0);
  assert.equal(result.gaps.filter((row) => row.dutyType === 'repair').length, 0);
});

test('every hardware member is assigned once including missing availability while daily difference stays within two', () => {
  const input = scenario(Array.from({ length: 20 }, () => [1]));
  const result = suggestDuties(input);
  assert.equal(result.assignments.length, 20);
  assert.equal(new Set(result.assignments.map((row) => row.memberId)).size, 20);
  assert.equal(result.optimization.balanced, true);
  assert.equal(result.optimization.conflicts, 14, 'six can fit Monday while the remaining three days stay within two');
  const missing = suggestDuties(scenario([[1], [], [2], [3], [4]]));
  assert.equal(missing.assignments.length, 5);
  assert.equal(missing.assignments.filter((row) => row.memberId === 'member-1').length, 1);
  assert.ok(missing.assignments.find((row) => row.memberId === 'member-1').availabilityConflict);
});

test('matching minimizes actual conflicts among all balanced allocations in a small exhaustive reference', () => {
  const windows = [[1], [1], [1, 2], [2, 3], [3], [1, 4]];
  let best = Infinity;
  function enumerate(assignments) {
    if (assignments.length === windows.length) {
      const counts = [1, 2, 3, 4].map((day) => assignments.filter((value) => value === day).length);
      if (Math.max(...counts) - Math.min(...counts) <= 2)
        best = Math.min(best, assignments.filter((day, index) => !windows[index].includes(day)).length);
      return;
    }
    for (const day of [1, 2, 3, 4]) enumerate([...assignments, day]);
  }
  enumerate([]);
  const result = suggestDuties(scenario(windows));
  assert.equal(result.optimization.conflicts, best);
  assert.ok(result.optimization.daily.every((row) => row.repair >= 1));
});

test('office preference still applies and a historical out-of-campus shift only blocks its own time', () => {
  const input = scenario([[1, 2, 3, 4], [1], [2], [3]]);
  input.people[0].memberships.push(post('hardware', 'maintenance_affairs'));
  input.people[1].assignments.push({ campusId: 'campus-hunnan', businessDate: weekStart, startAt: '19:00', endAt: '21:00' });
  const result = suggestDuties(input);
  assert.equal(result.assignments.find((row) => row.memberId === 'member-0').dutyType, 'office');
  assert.notEqual(result.assignments.find((row) => row.memberId === 'member-1').businessDate, weekStart);
});

test('office only fills actual available days with at most one person and allows an empty day', () => {
  const input = scenario([[1, 2, 3], [1, 2, 3], [], [1]]);
  for (const person of input.people)
    person.memberships = [post('network'), post('network', 'maintenance_affairs')];
  const result = suggestDuties(input);
  assert.equal(result.assignments.length, 3);
  assert.equal(new Set(result.assignments.map((row) => row.businessDate)).size, 3);
  assert.ok(result.assignments.every((row) => row.dutyType === 'office' && !row.availabilityConflict));
  assert.ok(!result.assignments.some((row) => row.memberId === 'member-2'));
  assert.deepEqual(result.unassigned, []);
  assert.ok(result.gaps.some((row) => row.businessDate === addDays(weekStart, 3) && row.dutyType === 'office'));
  assert.equal(result.optimization.complete, true);
  assert.equal(result.optimization.balanced, true);
});

test('office can rotate one available member across dates without forcing unavailable coverage', () => {
  const input = scenario([[1, 2, 3], []]);
  for (const person of input.people)
    person.memberships = [post('network'), post('network', 'maintenance_affairs')];
  input.people[0].assignments = [{ campusId: 'campus-hunnan', businessDate: addDays(weekStart, 1), startAt: '19:00', endAt: '21:00' }];
  const result = suggestDuties(input);
  assert.deepEqual(result.assignments.map((row) => row.businessDate).sort(), [weekStart, addDays(weekStart, 2)]);
  assert.ok(result.assignments.every((row) => row.memberId === 'member-0'));
  assert.equal(result.optimization.weeklyOnce, true);
});

test('dual-qualified hardware still gets one repair shift when no office availability exists', () => {
  const input = scenario([[]]);
  input.people[0].memberships.push(post('hardware', 'maintenance_affairs'));
  const result = suggestDuties(input);
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].dutyType, 'repair');
  assert.equal(result.optimization.weeklyOnce, true);
  assert.equal(result.optimization.conflicts, 1);
  const review = dutyPlanningReview({ ...input, assignments: [], people: input.people.map(person => ({ ...person, availability: { repair: [] } })) });
  assert.equal(review.unassigned[0].dutyType, 'repair');
});

test('generating suggestions preserves a published office shift without replacing that day', () => {
  const input = scenario([[1], [1]]);
  for (const person of input.people)
    person.memberships = [post('network'), post('network', 'maintenance_affairs')];
  const original = { id: 'office-shift', memberId: 'member-0', campusId, businessDate: weekStart, dutyType: 'office' };
  const result = suggestDuties({ ...input, kept: [original] });
  assert.deepEqual(result.assignments, [original]);
  assert.ok(!result.gaps.some((row) => row.businessDate === weekStart && row.dutyType === 'office'));
});

test('published repair shifts preserve their weekly slot and provide service day coverage', () => {
  const input = scenario([[1], [2]]);
  const original = { id: 'original', memberId: 'member-0', businessDate: weekStart, campusId, dutyType: 'repair' };
  const result = suggestDuties({ ...input, kept: [original] });
  assert.deepEqual(result.assignments.find((row) => row.id === original.id), original);
  assert.equal(result.assignments.filter((row) => row.memberId === 'member-0').length, 1);
  assert.ok(!result.gaps.some((row) => row.businessDate === weekStart && row.dutyType === 'repair'));
  assert.equal(result.unassigned.some((row) => row.memberId === 'member-0'), false);
  const publishedShape = { ...input, people: input.people.map((person) => ({ ...person, availability: { repair: [] } })), assignments: [original] };
  assert.ok(!dutyPlanningReview(publishedShape).gaps.some((row) => row.businessDate === weekStart && row.dutyType === 'repair'));
});

test('manual fixed overload and fully paused weeks report infeasibility without discarding history', () => {
  const input = scenario([[1, 2, 3, 4], [1, 2, 3, 4]]);
  const kept = Array.from({ length: 8 }, (_, index) => ({ id: `manual-${index}`, memberId: `fixed-${index}`, businessDate: weekStart, campusId, dutyType: 'repair' }));
  const result = suggestDuties({ ...input, kept });
  assert.equal(result.assignments.length, 10);
  assert.equal(result.optimization.balanced, false);
  assert.equal(result.assignments.filter((row) => row.suggested && row.businessDate === weekStart).length, 0);
  const paused = suggestDuties({ ...input, paused: [0, 1, 2, 3].map((offset) => addDays(weekStart, offset)) });
  assert.equal(paused.assignments.length, 0);
  assert.equal(paused.optimization.complete, false);
});

test('manual repair and office priorities use real appointments without inventing departments', () => {
  assert.equal(manualDutyPriority([post()], weekStart, 'repair'), 0);
  assert.equal(manualDutyPriority([post('network'), post('hardware', 'exchange')], weekStart, 'repair'), 1);
  for (const department of ['office', 'art', 'publicity']) assert.equal(manualDutyPriority([post(department)], weekStart, 'office'), 0);
  assert.equal(manualDutyPriority([post('network'), post('hardware', 'maintenance_affairs')], weekStart, 'office'), 1);
  assert.equal(dutyWeekKey('2026-11-22'), '2026-11-16');
  assert.equal(addDays(dutyWeekKey('2026-11-22'), 7), '2026-11-23');
  assert.equal(dutyWeekKey('2027-01-03'), '2026-12-28');
  assert.equal(rosterWeekKey('2026-11-22'), '2026-11-23', 'existing Sunday booking/education calendar stays independent');
});
