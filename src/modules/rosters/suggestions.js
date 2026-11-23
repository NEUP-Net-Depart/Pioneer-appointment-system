import { addDays } from '../../platform/time.js';
import {
  DUTY_START,
  DUTY_END,
  DUTY_WEEKDAYS,
  availableForDuty,
  dutyAvailability,
  dutyPlanningReview,
  dutyCandidateTypes,
  isDutyExempt
} from '../../../shared/duty.js';
import { balancedPlans, comparePlans, officePlan } from './balanced-assignment.js';

export function suggestDuties({
  weekStart,
  campusId,
  people,
  availability,
  paused,
  kept = [],
  excluded = []
}) {
  const weekDays = DUTY_WEEKDAYS.map((weekday) => addDays(weekStart, weekday - 1));
  const days = weekDays.filter((day) => !paused.includes(day));
  const assignments = kept
    .filter(
      (row) =>
        paused.includes(row.businessDate) || !isDutyExempt(
          people.find((person) => person.memberId === row.memberId)?.memberships || [],
          row.businessDate
        )
    )
    .map((row) => ({ ...row }));
  const activeKept = assignments.filter((row) => !paused.includes(row.businessDate));
  const used = new Set(activeKept.map((row) => row.memberId));
  const exclusionKeys = new Set(
    excluded.map((row) => `${row.memberId}:${row.businessDate}:${row.dutyType}`)
  );
  const candidates = people
    .filter((person) => days.some((day) => dutyCandidateTypes(person.memberships, day).length))
    .slice()
    .sort((a, b) => a.memberId.localeCompare(b.memberId))
    .map((person) => {
      const windows = dutyAvailability(
        availability.filter((row) => row.memberId === person.memberId),
        weekStart
      ).effectiveWindows;
      const weeklyOnce = days.some((day) =>
        dutyCandidateTypes(person.memberships, day).includes('repair')
      );
      const options = days.filter((day) => !person.assignments.some(
        (row) => row.campusId !== campusId && row.businessDate === day && row.startAt < DUTY_END && row.endAt > DUTY_START
      )).flatMap((businessDate) =>
        dutyCandidateTypes(person.memberships, businessDate)
          .filter(
            (dutyType) => !exclusionKeys.has(`${person.memberId}:${businessDate}:${dutyType}`)
          )
          .map((dutyType) => ({
            businessDate,
            dutyType,
            conflict: !availableForDuty(
              windows,
              new Date(`${businessDate}T12:00:00Z`).getUTCDay(),
              campusId
            )
          }))
      );
      return {
        ...person,
        options,
        weeklyOnce,
        availability: { repair: windows, office: windows }
      };
    });
  const officeDays = days.filter(
    (day) => !assignments.some((row) => row.businessDate === day && row.dutyType === 'office')
  );
  const officeItems = officePlan(
    candidates
      .filter((person) => !person.weeklyOnce || !used.has(person.memberId))
      .map((person) => ({
        ...person,
        officeLoad:
          activeKept.filter((row) => row.memberId === person.memberId).length,
        options: person.options.filter(
          (option) =>
            option.dutyType === 'office' &&
            !option.conflict &&
            officeDays.includes(option.businessDate) &&
            !assignments.some(
              (row) => row.businessDate === option.businessDate && row.memberId === person.memberId
            )
        )
      })),
    officeDays
  );
  for (const row of officeItems) used.add(row.person.memberId);
  const eligible = candidates
    .filter((person) => person.weeklyOnce && !used.has(person.memberId))
    .map((person) => ({
      ...person,
      options: person.options.filter((option) => option.dutyType === 'repair')
    }));
  const choices = balancedPlans(
    eligible,
    days,
    days.map(
      (day) =>
        assignments.filter((row) => row.businessDate === day && row.dutyType === 'repair').length
    )
  );
  const spread = (loads) => (loads.length ? Math.max(...loads) - Math.min(...loads) : 0);
  let best = null;
  const officeLoads = days.map(
    (day) =>
      assignments.filter((row) => row.businessDate === day && row.dutyType === 'office').length +
      officeItems.filter((row) => row.businessDate === day).length
  );
  for (const repair of choices) {
    const totalLoads = days.map((day, index) => repair.loads[index] + officeLoads[index]);
    const items = repair.items;
    const score = [
      eligible.length - items.length,
      Math.max(0, spread(repair.loads) - 2),
      items.filter((row) => row.conflict).length,
      repair.loads.filter((value) => !value).length,
      spread(repair.loads),
      repair.loads.reduce((sum, value) => sum + value * value, 0)
    ];
    if (!best || comparePlans(score, best.score) < 0)
      best = { items, score, totalLoads, repairLoads: repair.loads, officeLoads };
  }
  for (const row of [...officeItems, ...(best?.items || [])]) {
    assignments.push({
      id: `suggested-${row.person.memberId}-${row.businessDate}-${row.dutyType}`,
      memberId: row.person.memberId,
      memberName: row.person.name,
      campusId,
      businessDate: row.businessDate,
      dutyType: row.dutyType,
      startAt: DUTY_START,
      endAt: DUTY_END,
      source: 'auto',
      suggested: true,
      availabilityConflict: row.conflict
    });
  }
  const review = dutyPlanningReview({
    weekStart,
    campusId,
    people: candidates,
    assignments,
    paused
  });
  for (const person of review.unassigned) {
    const candidate = candidates.find((row) => row.memberId === person.memberId);
    person.reasonCode = days.length ? 'no_eligible_day' : 'paused';
    person.reason = days.length ? '可排日期无有效任职，请手动核对' : '本周服务日均已暂停';
    if (candidate.options.length) person.reason = '保留安排导致条件无法同时满足，请手动核对';
  }
  return {
    assignments,
    ...review,
    optimization: {
      complete:
        days.length > 0 && best?.score[0] === 0 && review.unassigned.length === 0,
      weeklyOnce: candidates
        .filter((person) => person.weeklyOnce)
        .every(
          (person) =>
            assignments.filter(
              (row) => row.memberId === person.memberId && !paused.includes(row.businessDate)
            ).length === 1
        ),
      balanced: best?.score[1] === 0,
      conflicts: best?.score[2] || 0,
      maxSpread: 2,
      daily: days.map((businessDate, index) => ({
        businessDate,
        repair: best.repairLoads[index],
        office: best.officeLoads[index],
        total: best.totalLoads[index]
      }))
    }
  };
}
