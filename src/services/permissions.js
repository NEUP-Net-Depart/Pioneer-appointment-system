import { fail } from '../lib/http.js';
import { roleLevel } from '../../shared/constants.js';

export function requireRole(user, minimum) {
  if (!user || user.status!=='enabled') fail(401,'登录已失效，请重新登录');
  if (!Object.hasOwn(roleLevel,user.role) || !Object.hasOwn(roleLevel,minimum) || roleLevel[user.role]<roleLevel[minimum]) fail(403,'没有执行此操作的权限');
  return user;
}
export function requireCampus(user, campus) {
  requireRole(user,'technician');
  if (!user.authorizedCampuses.includes(campus)) fail(403,'没有该校区的访问权限');
}
export function requireGrantScope(actor, campuses) {
  requireRole(actor,'admin');
  if (!campuses.length || campuses.some(campus=>!actor.authorizedCampuses.includes(campus))) fail(403,'不能管理授权范围以外的校区');
}
export function canManageAccount(actor, target) {
  return !target.protected && roleLevel[target.role]<roleLevel[actor.role] &&
    target.authorizedCampuses.length>0 && target.authorizedCampuses.every(campus=>actor.authorizedCampuses.includes(campus));
}
export function requireAppointmentAccess(user, item, { claim = false } = {}) {
  requireCampus(user,item.campus);
  if (user.role==='technician' && item.assignedTo!==user.account &&
      !(claim && !item.assignedTo && ['pending','awaiting_claim'].includes(item.status))) fail(403,'只能访问自己接单的预约');
}
export function appointmentScope(user) {
  requireRole(user,'technician');
  return { campuses:user.authorizedCampuses, technician:user.role==='technician' ? user.account : '' };
}
