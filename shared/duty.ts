import type { AvailabilityPeriod, AvailabilityWindow, CampusId, DutyAssignmentSummary, DutyCandidate, DutyType, Membership } from './staff-types.ts';
import { activeMemberships, leadershipPositions } from './staff-organization.ts';
import { addDays } from './time.ts';

export const DUTY_START = '19:00';
export const DUTY_END = '21:00';
export const DUTY_CHECK_IN_START = '18:30';
export const DUTY_CHECK_IN_END = '21:30';
export const DUTY_TYPES = ['repair', 'office'] as const;
export const DUTY_WEEKDAYS = [1, 2, 3, 4];
export const dutyTypeLabels = { repair: '维修', office: '办公' };
export const dutyEligibilityRequirements = {
  repair: '维修班次仅限硬件部部员或具有「交流维修」任职的成员',
  office: '办公班次仅限具有「维修事务」任职的成员'
};
export const dutyCampusNames = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' };

export function isDutyCampusId(value: unknown): value is CampusId {
  return value === 'campus-nanhu' || value === 'campus-hunnan';
}

export function dutyCampusName(id: string | null | undefined) {
  return isDutyCampusId(id) ? dutyCampusNames[id] : undefined;
}
export const dutyAvailabilityLabels = {
  missing: '未填写统计表',
  conflict: '与其时间冲突'
};

export function dutyWindow(day: string) {
  return {
    startsAt: `${day}T${DUTY_CHECK_IN_START}:00+08:00`,
    endsAt: `${day}T${DUTY_CHECK_IN_END}:00+08:00`
  };
}

export function availableForDuty(windows: readonly AvailabilityWindow[], weekday: number, campusId: string) {
  return windows.some(
    (row) =>
      row.weekday === weekday &&
      row.campusId === campusId &&
      row.startAt <= DUTY_START &&
      row.endAt >= DUTY_END
  );
}

export function hasDutyAvailability(windows: readonly AvailabilityWindow[], campuses = Object.keys(dutyCampusNames)) {
  return DUTY_WEEKDAYS.some((weekday) =>
    campuses.some((campus) => availableForDuty(windows, weekday, campus))
  );
}

export function dutyAvailabilityLabel(person: DutyCandidate | null | undefined, row: Pick<DutyAssignmentSummary, 'businessDate' | 'dutyType'>, campusId: string, weekStart: string) {
  if (!person) return '';
  const windows = person.availability[row.dutyType];
  const weekday = new Date(`${row.businessDate}T12:00:00Z`).getUTCDay() || 7;
  if (availableForDuty(windows, weekday, campusId)) return '当天有空';
  if (
    !DUTY_WEEKDAYS.some(
      (day) => dutyCandidateTypes(person.memberships, addDays(weekStart, day - 1)).length
    )
  ) {
    return '无需填报';
  }
  return hasDutyAvailability(windows)
    ? dutyAvailabilityLabels.conflict
    : dutyAvailabilityLabels.missing;
}

type DutyUnassignedReason = 'missing_availability' | 'other_campus' | 'paused' | 'not_scheduled' | 'no_eligible_day';

export function dutyPlanningReview({ weekStart, campusId, people, assignments, paused }: {
  weekStart: string; campusId: string; people: readonly (Pick<DutyCandidate, 'memberId' | 'name' | 'memberships'> & { availability: Pick<DutyCandidate['availability'], 'repair'> })[];
  assignments: readonly DutyAssignmentSummary[]; paused: readonly string[];
}) {
  const days = DUTY_WEEKDAYS.map((weekday) => addDays(weekStart, weekday - 1)).filter(
    (day) => !paused.includes(day)
  );
  const activeAssignments = assignments.filter((row) => !paused.includes(row.businessDate));
  const candidates = people.filter((person) =>
    days.some((day) => dutyCandidateTypes(person.memberships, day).length)
  );
  const gaps = days.flatMap((businessDate) =>
      DUTY_TYPES.filter(
        (dutyType) =>
          !activeAssignments.some(
            (row) => row.businessDate === businessDate && row.dutyType === dutyType
          )
      ).map((dutyType) => ({
        businessDate,
        dutyType,
        reason: `尚未安排${dutyTypeLabels[dutyType]}值班`
      }))
    );
  const unassigned = candidates
    .filter((person) =>
      days.some((day) => dutyCandidateTypes(person.memberships, day).includes('repair'))
    )
    .filter((person) => !activeAssignments.some((row) => row.memberId === person.memberId))
    .map((person) => {
      const windows = person.availability.repair;
      const dutyType = 'repair' as const;
      const reasonCode: DutyUnassignedReason = !hasDutyAvailability(windows)
          ? 'missing_availability'
          : !hasDutyAvailability(windows, [campusId])
            ? 'other_campus'
            : !DUTY_WEEKDAYS.some(
                  (weekday) =>
                    !paused.includes(addDays(weekStart, weekday - 1)) &&
                    availableForDuty(windows, weekday, campusId)
                )
              ? 'paused'
              : 'not_scheduled';
      return {
        memberId: person.memberId,
        name: person.name,
        dutyType,
        reasonCode: reasonCode as DutyUnassignedReason,
        reason: {
          missing_availability: dutyAvailabilityLabels.missing,
          other_campus: '空闲在其他校区',
          paused: '空闲日均已暂停服务',
          not_scheduled: '尚未安排，请核对'
        }[reasonCode]
      };
    });
  return { gaps, unassigned };
}

export function dutyAvailability(rows: readonly AvailabilityPeriod[], weekStart: string) {
  const latest = (period: string) =>
    rows
      .filter((row) => row.weekStart === period)
      .slice()
      .sort(
        (first, second) =>
          (second.updatedAt || '').localeCompare(first.updatedAt || '') ||
          (second.dutyType || '').localeCompare(first.dutyType || '')
      )[0];
  const usual = latest('') || { revision: -1, windows: [] };
  // Only a weekly exception may store JSON null to restore usual availability.
  const usualWindows = usual.windows ?? [];
  const exception = latest(weekStart) || null;
  return {
    usual: { ...usual, windows: usualWindows },
    exception,
    effectiveWindows: exception?.windows ?? usualWindows,
    source: exception?.windows ? 'exception' : 'usual',
    updatedThisWeek: !!exception?.windows
  };
}

export function isDutyExempt(memberships: readonly Membership[], day: string) {
  return activeMemberships({ memberships, businessDate: day }).some((post) =>
    leadershipPositions.includes(post.positionCode)
  );
}

function isHardwareMember(post: Membership) {
  return (
    post.positionCode === 'member' &&
    post.assignmentType === 'primary' &&
    post.departmentCode === 'hardware' &&
    post.isPrimary
  );
}

export function canAssignDuty(memberships: readonly Membership[] | undefined, day: string, dutyType: DutyType) {
  if (isDutyExempt(memberships ?? [], day)) return false;
  return activeMemberships({ memberships, businessDate: day }).some((post) => {
    if (post.positionCode !== 'member') return false;
    if (dutyType === 'repair')
      return isHardwareMember(post) || (post.assignmentType === 'exchange' && post.departmentCode === 'hardware');
    return dutyType === 'office' && post.assignmentType === 'maintenance_affairs';
  });
}

export function dutyCandidateTypes(memberships: readonly Membership[], day: string) {
  if (isDutyExempt(memberships, day)) return [];
  const posts = activeMemberships({ memberships, businessDate: day });
  return DUTY_TYPES.filter((type) =>
    posts.some(
      (post) =>
        type === 'office'
          ? post.positionCode === 'member' && post.assignmentType === 'maintenance_affairs'
          : isHardwareMember(post)
    )
  );
}

export function manualDutyPriority(memberships: readonly Membership[], day: string, dutyType: DutyType) {
  const posts = activeMemberships({ memberships, businessDate: day });
  if (dutyType === 'repair') {
    return posts.some(isHardwareMember) ? 0 : 1;
  }
  return posts.some(
    (post) =>
      post.isPrimary &&
      post.positionCode === 'member' &&
      ['office', 'art', 'publicity'].includes(post.departmentCode || '')
  )
    ? 0
    : 1;
}
