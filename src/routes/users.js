import { json, readBody } from '../lib/http.js';
import { userPatch, assigneeQuery } from '../lib/validation.js';

export const userRoutes = [
  ['GET', /^\/api\/staff\/assignees$/, async context => {
    const actor = await context.role('admin');
    return json(await context.services.users.assignees(assigneeQuery(context.query), actor));
  }],
  ['GET', /^\/api\/users$/, async context => {
    const actor=await context.role('admin');
    return json(await context.services.users.list(actor));
  }],
  ['PATCH', /^\/api\/users\/([^/]+)$/, async (context, match) => {
    const actor = await context.role('admin');
    return json(await context.services.users.update(decodeURIComponent(match[1]), userPatch(await readBody(context.request)), actor));
  }]
];
