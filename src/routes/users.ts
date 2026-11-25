import type { Route } from './route.ts';
import { json, readBody } from '../lib/http.ts';
import { userPatch, assigneeQuery } from '../lib/validation.ts';

export const userRoutes: Route[] = [
  ['GET', /^\/api\/staff\/assignees$/, async context => {
    const actor = await context.permission('repair.correct');
    return json(await context.services.users.assignees(assigneeQuery(context.query), actor));
  }],
  ['GET', /^\/api\/users$/, async context => {
    const actor=await context.permission('accounts.manage');
    return json(await context.services.users.list(actor));
  }],
  ['GET', /^\/api\/users\/([^/]+)$/, async (context, match: string[]) => {
    const actor = await context.permission('accounts.manage');
    return json(await context.services.users.detail(decodeURIComponent(match[1]), actor));
  }],
  ['PATCH', /^\/api\/users\/([^/]+)$/, async (context, match: string[]) => {
    const actor = await context.permission('accounts.manage');
    return json(await context.services.users.update(decodeURIComponent(match[1]), userPatch(await readBody(context.request)), actor));
  }]
];
