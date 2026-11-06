import { staffRepairPermissions } from './public.js';

export function appointmentAccessRules(authorizer, actor, permission, context) {
  if (!staffRepairPermissions.includes(permission)) return [];
  return (actor.authorizedCampuses || []).filter(campus =>
    authorizer.evaluate(context.actor, permission, { campusId: campus }, context, context.grants).allowed
  ).map(campus => ({campus}));
}
