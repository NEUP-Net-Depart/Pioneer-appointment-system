import type { StaffAccountDto } from '../../shared/staff-types.ts';
import type { StaffRepository } from '../db/staff-platform.ts';
import type { appointmentRepository } from '../db/appointments.ts';

type AppointmentRepository = ReturnType<typeof appointmentRepository>;
export type StaffPlatform = ReturnType<typeof composeStaffPlatform>;

import { manifests, validateManifests, navigationFor, workbenchProviders } from '../modules/registry.ts';
import { createAuthorizer } from '../modules/authorization/public.ts';
import { policyRegistry } from '../modules/attendance/public.ts';

export function composeStaffPlatform({ repository, repairs }: { repository: Pick<StaffRepository, 'authorizationContext'>; repairs: AppointmentRepository }) {
  const manifestCheck = validateManifests(manifests);
  if (!manifestCheck.valid) throw new Error(`Invalid module manifest: ${manifestCheck.errors.join(', ')}`);
  const authorizer = createAuthorizer();
  const policies = policyRegistry();
  return {
    manifests,
    repairs,
    manifestCheck,
    authorizer,
    policies,
    async authContext(user: Pick<StaffAccountDto, 'account'> & Partial<Pick<StaffAccountDto, 'name'>>, options: { businessDate?: string } = {}) {
      const context = await repository.authorizationContext(user, options.businessDate);
      const grants = context.grants;
      const actor = { ...context.actor, authVersion: context.authVersion };
      return { ...context, actor, navigation: navigationFor(actor, grants, manifests, { ...context, businessDate: options.businessDate }), modules: manifestCheck.summary, resumeTasks: [], workbenchProviders: workbenchProviders(manifests) };
    }
  };
}
