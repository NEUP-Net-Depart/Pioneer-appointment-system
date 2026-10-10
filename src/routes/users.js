import { json, readBody } from '../lib/http.js';
import { newUserInput, userPatch } from '../lib/validation.js';

export const userRoutes = [
  ['GET', /^\/api\/users$/, async context => {
    await context.role('admin');
    return json(await context.services.users.list());
  }],
  ['POST', /^\/api\/users$/, async context => {
    const actor = await context.role('admin');
    return json(await context.services.users.create(newUserInput(await readBody(context.request)),actor), 201);
  }],
  ['PATCH', /^\/api\/users\/([^/]+)$/, async (context, match) => {
    const actor = await context.role('admin');
    return json(await context.services.users.update(decodeURIComponent(match[1]), userPatch(await readBody(context.request)), actor));
  }]
];
