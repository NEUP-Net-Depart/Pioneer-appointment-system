import { json, readBody } from '../lib/http.js';

export const authRoutes = [
  ['POST', /^\/api\/auth\/login$/, async context => {
    await context.limit('login');
    return json({ ...await context.services.auth.login(await readBody(context.request)), staffWorkflowEnabled: context.services.field.enabled });
  }],
  ['PATCH', /^\/api\/auth\/password$/, async context => {
    const user=await context.role('technician');
    await context.limit('login');
    return json(await context.services.auth.changePassword(await readBody(context.request),user));
  }],
  ['POST', /^\/api\/auth\/revoke$/, async context => json(await context.services.auth.logout(await context.role('technician')))],
  ['GET', /^\/api\/auth\/me$/, async context => {
    const user = await context.role('technician');
    const profile = await context.services.staffPlatform.contextFor(user);
    return json({ account:user.account, name:user.name, role:user.role, status:user.status, homeCampus:user.homeCampus,
      authorizedCampuses:user.authorizedCampuses, ...profile, actor:{ ...profile.actor, account:user.account, role:user.role },
      authVersion:profile.authVersion, schemaVersion:profile.schemaVersion, modules:profile.modules || [], navigation:profile.navigation || [],
      resumeTasks:profile.resumeTasks || [], todayDuties:profile.todayDuties || [], staffWorkflowEnabled: context.services.field.enabled });
  }],
  ['POST', /^\/api\/auth\/logout$/, async context => json(await context.services.auth.logout(await context.role('technician')))]
];
