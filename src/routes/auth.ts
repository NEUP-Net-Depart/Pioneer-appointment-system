import type { Route } from './route.ts';
import type { StaffProfileDto } from '../../shared/staff-types.ts';
import { json, readBody } from '../lib/http.ts';

export const authRoutes: Route[] = [
  ['POST', /^\/api\/auth\/login$/, async context => {
    await context.limit('login');
    return json({ ...await context.services.auth.login(await readBody(context.request)) });
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
    const response = {
      ...profile,
      account: user.account,
      memberId: profile.actor.memberId,
      name: user.name,
      role: user.role,
      status: user.status,
      homeCampus: user.homeCampus,
      authorizedCampuses: user.authorizedCampuses,
      actor: { ...profile.actor, account: user.account, name: profile.actor.name ?? user.name, role: user.role }
    };
    return json(response satisfies StaffProfileDto);
  }],
  ['POST', /^\/api\/auth\/logout$/, async context => json(await context.services.auth.logout(await context.role('technician')))]
];
