import { json, readBody } from '../lib/http.js';

export const warrantyRoutes = [
  ['GET', /^\/api\/warranty\/providers$/, async context => {
    await context.role('technician');
    return json(context.services.warranty.providers());
  }],
  ['POST', /^\/api\/warranty\/challenge$/, async context => {
    const actor = await context.role('technician');
    await context.limit('warranty');
    return json(await context.services.warranty.challenge(await readBody(context.request, 2048), actor));
  }],
  ['POST', /^\/api\/warranty\/query$/, async context => {
    const actor = await context.role('technician');
    await context.limit('warranty');
    return json(await context.services.warranty.query(await readBody(context.request, 24 * 1024), actor));
  }]
];
