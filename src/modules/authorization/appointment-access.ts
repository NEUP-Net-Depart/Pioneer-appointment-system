import type { Authorizer } from './public.ts';
import type { StaffContext } from '../../services/staff-platform/context.ts';
import type { StaffAccountDto } from '../../../shared/staff-types.ts';
import { staffRepairPermissions } from './public.ts';

export function appointmentAccessRules(authorizer: Authorizer, actor: StaffAccountDto, permission: string, context: StaffContext) {
  if (!staffRepairPermissions.includes(permission)) return [];
  return (actor.authorizedCampuses || []).filter(campus =>
    authorizer.evaluate(context.actor, permission, { campusId: campus }, context, context.grants).allowed
  ).map(campus => ({campus}));
}
