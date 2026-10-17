import {campusId} from '../authorization/scopes.js';

const strings = value => Array.isArray(value) && value.every(item => typeof item === 'string' && item.trim());
export function rosterScope(task) {
  const scope = task?.campusScope || {}, departments = scope.departmentIds ?? [];
  const valid = strings(scope.campusIds) && scope.campusIds.length > 0 && strings(departments);
  return {valid,campusIds:valid ? [...new Set(scope.campusIds.map(campusId))] : [],departmentIds:valid ? [...new Set(departments)] : []};
}

export function rosterTaskManaged(context, authorizer, task, permissionCode) {
  const scope = rosterScope(task);
  if (!scope.valid) return false;
  const code = permissionCode || (task.dutyType === 'office' ? 'roster.office.manage' : 'roster.repair.manage');
  // A task controls every campus/department pair in its declared scope. Test
  // actual pairs; passing arrays to an any-match grant evaluator widens access.
  return scope.campusIds.every(campusId => (scope.departmentIds.length ? scope.departmentIds : [undefined]).every(departmentId =>
    authorizer.evaluate(context.actor,code,{id:task.id,campusId,departmentId,businessDate:context.businessDate},context,context.grants).allowed));
}

export function rosterDepartments(fact, day, task) {
  const selected = rosterScope(task).departmentIds;
  return (fact?.memberships || []).filter(item => item.effectiveFrom <= day && (!item.effectiveTo || day < item.effectiveTo) &&
    (!selected.length || selected.includes(item.departmentId)));
}

export function rosterMemberInScope(fact, task, day, campus) {
  const scope = rosterScope(task);
  return !!fact && scope.valid && scope.campusIds.includes(campus) && (fact.campuses || []).some(value => campusId(value) === campus) &&
    (!scope.departmentIds.length || rosterDepartments(fact,day,task).length > 0);
}

export function rosterMemberReadable(context, authorizer, fact, task, day, campus) {
  if (!rosterMemberInScope(fact,task,day,campus)) return false;
  const departments = rosterDepartments(fact,day,task);
  return (departments.length ? departments : [{departmentId:undefined}]).some(item => authorizer.evaluate(context.actor,'roster.read',
    {id:task.id,memberId:fact.memberId,campusId:campus,departmentId:item.departmentId,businessDate:context.businessDate},context,context.grants).allowed);
}
