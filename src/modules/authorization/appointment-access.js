import { campusId } from './scopes.js';

// Appointment targets contain campus, owner, object ID and business date.
// Evaluate complete grants with the engine, retaining their row-dependent
// restrictions for D1. New condition providers must declare a projection here
// before they can widen a list query; unsupported conditions fail closed.
const projectedConditions = new Set([
  'ownResource',
  'activeDutyRole',
  'signedDutyPresence',
  'activeDepartmentMembership',
  'repairWorkEligible',
  'rosterParticipantEligible',
  'attendanceEligible',
  'meetingParticipant',
  'meetingOrganizer'
]);

export function appointmentAccessRules(authorizer, actor, permission, context) {
  const rules = [];
  for (const grant of authorizer.eligibleGrants(permission, context, context.grants || [])) {
    const conditions = grant.conditions ?? [];
    if (
      !Array.isArray(conditions) ||
      conditions.some((condition) => !projectedConditions.has(condition?.code))
    )
      continue;
    for (const campus of actor.authorizedCampuses || []) {
      const target = {
        campusId: campusId(campus),
        assignedMemberId: context.actor.memberId,
        id: grant.scope?.objectIds?.[0] || '',
        businessDate: context.businessDate
      };
      if (
        !authorizer.evaluate({ ...context.actor, ...actor }, permission, target, context, [grant])
          .allowed
      )
        continue;
      rules.push({
        campus,
        ...(grant.scope?.self || conditions.some((item) => item.code === 'ownResource')
          ? { memberId: context.actor.memberId }
          : {}),
        ...(conditions.some((item) => item.code === 'activeDutyRole')
          ? { date: context.businessDate }
          : {}),
        ...(grant.scope?.objectIds !== undefined ? { objectIds: grant.scope.objectIds } : {})
      });
    }
  }
  return rules;
}
