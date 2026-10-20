import { fail } from '../lib/http.js';
import { roleLevel } from '../../shared/constants.js';

export function requireRole(user, minimum) {
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
export function requireCampus(user, campus) {
  requireRole(user, 'technician');
  if (!user.authorizedCampuses.includes(campus)) fail(403, '没有该校区的访问权限');
}
export function requireGrantScope(actor, campuses) {
  // The permission engine decides whether the operation is available.  The
  // legacy account role only proves that this is a staff session; keeping the
  // old admin gate here made explicit grants such as accounts.manage unusable
  // for otherwise eligible technicians.
  requireRole(actor, 'technician');
  if (!campuses.length || campuses.some((campus) => !actor.authorizedCampuses.includes(campus)))
    fail(403, '不能管理授权范围以外的校区');
}
export function canManageAccount(actor, target) {
  return (
    !target.protected &&
    target.account !== actor.account &&
    target.role !== 'superadmin' &&
    (target.role !== 'admin' || actor.role === 'superadmin') &&
    target.authorizedCampuses.length > 0 &&
    target.authorizedCampuses.every((campus) => actor.authorizedCampuses.includes(campus))
  );
}
export function appointmentScope(user) {
  requireRole(user, 'technician');
  // Appointment visibility is granted by repair.summary.read and its scope.
  // The legacy account role must not silently narrow an explicitly granted
  // campus scope to booked or self-assigned records.
  return { campuses: user.authorizedCampuses, technician: '' };
}

export function ownsRepair(user, item) {
  return (
    !!user &&
    (item.assignedTo === user.account ||
      (!!user.memberId && item.assignedMemberId === user.memberId))
  );
}
export function ownsRegistration(user, item) {
  return (
    !!user &&
    (item.registeredBy === user.account ||
      (!!user.memberId && item.registeredMemberId === user.memberId))
  );
}
