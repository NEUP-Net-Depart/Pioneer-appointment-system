import { json, readBody } from '../lib/http.js';
import { slotCapacityInput } from '../lib/validation.js';

export const slotCapacityRoutes = [
  ['GET', /^\/api\/slot-capacities$/, async context => {
    return json(await context.services.slotCapacities.list(await context.role('admin')));
  }],
  ['PATCH', /^\/api\/slot-capacities$/, async context => {
    const actor = await context.role('admin');
    await context.limit('write');
    return json(await context.services.slotCapacities.update(slotCapacityInput(await readBody(context.request)), actor));
  }]
];
