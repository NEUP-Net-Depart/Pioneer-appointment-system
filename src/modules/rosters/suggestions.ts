import type { AvailabilityPeriod, DutyAssignmentSummary, DutyShift, Membership } from '../../../shared/staff-types.ts';

type RetainedShift = Pick<DutyShift, 'memberId' | 'businessDate' | 'dutyType'> &
  Partial<Pick<DutyShift, 'id' | 'campusId' | 'startAt' | 'endAt' | 'source' | 'memberName' | 'suggested'>> & { availabilityConflict?: boolean };
type SuggestedShift = RetainedShift & Required<Pick<DutyShift, 'id' | 'startAt' | 'endAt'>> & { source: 'auto'; suggested: true };

interface SuggestionPerson {
  memberId: string;
  name: string;
  memberships: readonly Membership[];
  assignments: readonly Pick<DutyShift, 'campusId' | 'businessDate' | 'startAt' | 'endAt'>[];
}

interface SuggestionInput<T extends RetainedShift> {
  weekStart: string;
  campusId: string;
  people: readonly SuggestionPerson[];
  availability: readonly (AvailabilityPeriod & { memberId: string })[];
  paused: readonly string[];
  kept?: readonly T[];
  excluded?: readonly DutyAssignmentSummary[];
}
import { addDays } from '../../platform/time.ts';
import {
  DUTY_START,
  DUTY_END,
  DUTY_WEEKDAYS,
  availableForDuty,
  dutyAvailability,
  dutyPlanningReview,
  dutyCandidateTypes,
  isDutyExempt
} from '../../../shared/duty.ts';
import { bestDutyPlan } from './balanced-assignment.ts';

const maxSpread = 2;

export function suggestDuties<T extends RetainedShift>({
  weekStart,
  campusId,
  people,
  availability,
  paused,
  kept = [],
  excluded = []
}: SuggestionInput<T>) {
  const weekDays = DUTY_WEEKDAYS.map((weekday) => addDays(weekStart, weekday - 1));
  const days = weekDays.filter((day) => !paused.includes(day));
  const assignments: ((T & RetainedShift) | SuggestedShift)[] = kept
    .filter(
      (row) =>
        paused.includes(row.businessDate) || !isDutyExempt(
          people.find((person) => person.memberId === row.memberId)?.memberships || [],
          row.businessDate
        )
    )
    .map((row) => ({ ...row }));
  const activeKept = assignments.filter((row) => !paused.includes(row.businessDate));
  const keptCounts = new Map<string, number>();
  for (const row of activeKept)
    keptCounts.set(row.memberId, (keptCounts.get(row.memberId) || 0) + 1);
  const officeDays = days.filter(
    (day) => !activeKept.some((row) => row.businessDate === day && row.dutyType === 'office')
  );
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
      const needsWeeklyShift = days.some((day) =>
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
          .filter((option) => option.dutyType === 'repair' || (
            !option.conflict && officeDays.includes(option.businessDate)
          ))
      );
      return {
        ...person,
        options,
        needsWeeklyShift,
        availability: { repair: windows, office: windows }
      };
    });
  const pending = candidates.filter(
    (person) => !keptCounts.has(person.memberId) && (person.needsWeeklyShift || person.options.length)
  );
  const repeated = candidates.find((person) => (keptCounts.get(person.memberId) || 0) > 1);
  const blocked = pending.find((person) => !person.options.length);
  const fixedRepair = days.map(
    (day) =>
      activeKept.filter((row) => row.businessDate === day && row.dutyType === 'repair').length
  );
  let reason = null;
  if (!days.length) reason = '本周服务日均已暂停，无法生成班表';
  else if (repeated) reason = `${repeated.name}本周已有多个班次，请先调整为一次`;
  else if (blocked) reason = `${blocked.name}本周没有可安排的班次，请核对任职和排除项`;
  const best = reason ? null : bestDutyPlan(pending, days, officeDays, fixedRepair, maxSpread);
  if (!best && !reason) {
    reason = '无法将每日维修人数差控制在 2 人以内，请核对保留班次和排除项';
  }
  for (const row of best?.items || []) {
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
    if (candidate && !candidate.options.length) {
      person.reasonCode = 'no_eligible_day';
      person.reason = '本周没有可安排的班次，请核对任职和排除项';
    }
  }
  const daily = days.map((businessDate) => {
    const rows = assignments.filter((row) => row.businessDate === businessDate);
    const repair = rows.filter((row) => row.dutyType === 'repair').length;
    return { businessDate, repair, office: rows.length - repair, total: rows.length };
  });
  const repairLoads = daily.map((row) => row.repair);
  return {
    assignments,
    ...review,
    optimization: {
      complete: Boolean(best),
      reason,
      weeklyOnce: !repeated && !review.unassigned.length,
      balanced: repairLoads.length > 0 && Math.max(...repairLoads) - Math.min(...repairLoads) <= maxSpread,
      conflicts: best?.conflicts || 0,
      maxSpread,
      daily
    }
  };
}
