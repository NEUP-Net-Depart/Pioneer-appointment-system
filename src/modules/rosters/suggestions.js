import { addDays } from '../../platform/time.js';
import {
  DUTY_START,
  DUTY_END,
  DUTY_TYPES,
  availableForDuty,
  dutyCandidateTypes,
  dutyLeader
} from '../../../shared/duty.js';

// Four daily leader slots form a bipartite matching. Augmenting paths avoid
// spending the only available leader for one day on a more flexible day.
export function suggestDuties({ weekStart, campusId, people, availability, paused, kept = [] }) {
  const weekDays = Array.from({ length: 4 }, (_, i) => addDays(weekStart, i));
  const days = weekDays.filter((day) => !paused.includes(day));
  const assignments = kept.map((row) => ({ ...row }));
  const used = new Set(kept.map((row) => row.memberId));
  const candidates = people
    .filter((person) => weekDays.some((day) => dutyCandidateTypes(person.memberships, day).length))
    .slice()
    .sort((a, b) => a.memberId.localeCompare(b.memberId))
    .map((person) => {
      const options = [];
      for (const day of days) {
        const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
        for (const dutyType of dutyCandidateTypes(person.memberships, day)) {
          const values = availability.filter(
            (row) => row.memberId === person.memberId && row.dutyType === dutyType
          );
          const windows =
            values.find((row) => row.weekStart === weekStart && row.windows !== null)?.windows ??
            values.find((row) => !row.weekStart)?.windows ??
            [];
          if (availableForDuty(windows, weekday, campusId))
            options.push({ businessDate: day, dutyType });
        }
      }
      const occupied = person.assignments.some((row) => row.campusId !== campusId);
      return { ...person, options, occupied };
    });
  const count = (day, type) =>
    assignments.filter((row) => row.businessDate === day && (!type || row.dutyType === type))
      .length;
  const choose = (options) =>
    options
      .slice()
      .sort(
        (a, b) =>
          count(a.businessDate, a.dutyType) - count(b.businessDate, b.dutyType) ||
          count(a.businessDate) - count(b.businessDate) ||
          a.businessDate.localeCompare(b.businessDate) ||
          DUTY_TYPES.indexOf(a.dutyType) - DUTY_TYPES.indexOf(b.dutyType)
      )[0];
  const add = (person, option) => {
    assignments.push({
      id: `suggested-${person.memberId}-${option.businessDate}-${option.dutyType}`,
      memberId: person.memberId,
      memberName: person.name,
      campusId,
      ...option,
      startAt: DUTY_START,
      endAt: DUTY_END,
      suggested: true
    });
    used.add(person.memberId);
  };
  const covered = (day) =>
    assignments.some(
      (row) =>
        row.businessDate === day &&
        row.leaveStatus !== 'recorded' &&
        dutyLeader(
          people.find((person) => person.memberId === row.memberId)?.memberships || [],
          day
        )
    );
  const matches = new Map();
  function match(day, seen) {
    for (const person of candidates) {
      if (
        person.occupied ||
        used.has(person.memberId) ||
        seen.has(person.memberId) ||
        !dutyLeader(person.memberships, day) ||
        !person.options.some((option) => option.businessDate === day)
      )
        continue;
      seen.add(person.memberId);
      const previous = matches.get(person.memberId);
      if (!previous || match(previous, seen)) {
        matches.set(person.memberId, day);
        return true;
      }
    }
    return false;
  }
  for (const day of days.filter((day) => !covered(day))) match(day, new Set());
  for (const [id, day] of matches) {
    const person = candidates.find((row) => row.memberId === id);
    add(person, choose(person.options.filter((option) => option.businessDate === day)));
  }
  for (const person of candidates
    .slice()
    .sort((a, b) => a.options.length - b.options.length || a.memberId.localeCompare(b.memberId))) {
    if (!person.occupied && !used.has(person.memberId) && person.options.length)
      add(person, choose(person.options));
  }
  return {
    assignments,
    gaps: days.flatMap((businessDate) => [
      ...(!covered(businessDate)
        ? [{ businessDate, reason: '缺少硬件部负责人或更高职位人员' }]
        : []),
      ...(!count(businessDate) ? [{ businessDate, reason: '当日无人可排' }] : [])
    ]),
    unassigned: candidates
      .filter((person) => !used.has(person.memberId))
      .map((person) => ({
        memberId: person.memberId,
        name: person.name,
        reason: person.occupied
          ? '本周已有其他校区班次'
          : !days.length
            ? '本周服务日均已暂停'
            : '没有符合岗位的整班空闲'
      }))
  };
}
