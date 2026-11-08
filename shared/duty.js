import { activeMemberships, globalLeadershipPositions } from './staff-organization.js';

export const DUTY_START = '19:00';
export const DUTY_END = '21:00';
export const DUTY_CHECK_IN_START = '18:30';
export const DUTY_CHECK_IN_END = '21:30';
export const DUTY_TYPES = ['repair', 'office'];
export const dutyTypeLabels = { repair: '维修', office: '办公' };
export const dutyCampusNames = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' };

export function dutyWindow(day) {
  return {
    startsAt: `${day}T${DUTY_CHECK_IN_START}:00+08:00`,
    endsAt: `${day}T${DUTY_CHECK_IN_END}:00+08:00`
  };
}

export function availableForDuty(windows, weekday, campusId) {
  return windows.some(
    (row) =>
      row.weekday === weekday &&
      row.campusId === campusId &&
      row.startAt <= DUTY_START &&
      row.endAt >= DUTY_END
  );
}

export function dutyLeader(memberships, day) {
  return activeMemberships({ memberships, businessDate: day }).some(
    (post) =>
      post.assignmentType !== 'exchange' &&
      (globalLeadershipPositions.includes(post.positionCode) ||
        (post.departmentCode === 'hardware' && ['head', 'deputy_head'].includes(post.positionCode)))
  );
}

export function dutyCandidateTypes(memberships, day) {
  const posts = activeMemberships({ memberships, businessDate: day });
  if (
    posts.some(
      (post) =>
        post.assignmentType !== 'exchange' && globalLeadershipPositions.includes(post.positionCode)
    )
  )
    return DUTY_TYPES;
  return DUTY_TYPES.filter((type) =>
    posts.some(
      (post) =>
        post.assignmentType !== 'exchange' &&
        post.departmentCode === (type === 'repair' ? 'hardware' : 'office') &&
        (post.isPrimary ||
          (type === 'repair' && ['head', 'deputy_head'].includes(post.positionCode)))
    )
  );
}
