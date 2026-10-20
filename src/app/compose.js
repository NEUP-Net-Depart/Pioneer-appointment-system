import { manifests, validateManifests, navigationFor, workbenchProviders } from '../modules/registry.js';
import { createAuthorizer } from '../modules/authorization/public.js';
import { policyRegistry } from '../modules/attendance/public.js';

export function composeStaffPlatform({ repository, repairs }) {
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
    async authContext(user, options = {}) {
      const context = await repository.authorizationContext(user, options.businessDate);
      const grants = context.grants;
      const actor = { ...context.actor, role: user.role, authorizedCampuses: user.authorizedCampuses, authVersion: context.authVersion };
      return { ...context, actor, navigation: navigationFor(actor, grants, manifests, { ...context, businessDate: options.businessDate }), modules: manifestCheck.summary, resumeTasks: [], workbenchProviders: workbenchProviders(manifests) };
    }
  };
}
