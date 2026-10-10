import { json, readBody } from '../lib/http.js';

export const authRoutes = [
  ['POST', /^\/api\/auth\/login$/, async context => {
    await context.limit('login');
    return json(await context.services.auth.login(await readBody(context.request)));
  }],
  ['GET', /^\/api\/auth\/me$/, async context => {
    const { account, name, role, status, homeCampus, authorizedCampuses } = await context.role('technician');
    return json({ account, name, role, status, homeCampus, authorizedCampuses });
  }],
  ['POST', /^\/api\/auth\/logout$/, async context => json(await context.services.auth.logout(await context.role('technician')))]
];
