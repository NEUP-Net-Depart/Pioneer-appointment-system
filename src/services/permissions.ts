import type { StaffAccountDto, StaffRole } from '../../shared/staff-types.ts';
import { fail } from '../lib/http.ts';
import { roleLevel } from '../../shared/constants.ts';

export function requireRole<T extends StaffAccountDto>(user: T | null | undefined, minimum: StaffRole): T {
  if (!user || user.status !== 'enabled' || user.memberStatus === 'inactive')
    fail(401, '登录已失效，请重新登录');
  if (
    !Object.hasOwn(roleLevel, user.role) ||
    !Object.hasOwn(roleLevel, minimum) ||
    roleLevel[user.role] < roleLevel[minimum]
  )
    fail(403, '没有执行此操作的权限');
  return user;
}
export function requireCampus(user: StaffAccountDto, campus: string) {
  requireRole(user, 'technician');
  if (!user.authorizedCampuses.includes(campus)) fail(403, '没有该校区的访问权限');
}
export function requireGrantScope(actor: StaffAccountDto, campuses: readonly string[]) {
  requireRole(actor, 'technician');
  if (!campuses.length || campuses.some((campus) => !actor.authorizedCampuses.includes(campus)))
    fail(403, '不能管理授权范围以外的校区');
}
export function canManageAccount(actor: StaffAccountDto, target: StaffAccountDto) {
  return (
    !target.protected &&
    target.account !== actor.account &&
    (!target.memberId || target.memberId !== actor.memberId) &&
    target.role !== 'superadmin' &&
    target.authorizedCampuses.length > 0 &&
    target.authorizedCampuses.every((campus) => actor.authorizedCampuses.includes(campus))
  );
}
export function appointmentScope(user: StaffAccountDto) {
  requireRole(user, 'technician');
  // Appointment visibility is granted by repair.summary.read and its scope.
  // The legacy account role must not silently narrow an explicitly granted
  // campus scope to booked or self-assigned records.
  return { campuses: user.authorizedCampuses, technician: '' };
}

export function ownsRepair(user: StaffAccountDto | null | undefined, item: { assignedTo?: string; assignedMemberId?: string }) {
  return (
    !!user &&
    (item.assignedTo === user.account ||
      (!!user.memberId && item.assignedMemberId === user.memberId))
  );
}
