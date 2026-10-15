import { json, readBody } from '../lib/http.js';
import { slotCapacityInput, slotCapacityBatchInput } from '../lib/validation.js';

export const slotCapacityRoutes = [
  ['GET', /^\/api\/slot-capacities$/, async context => {
    return json(await context.services.slotCapacities.list(await context.role('admin')));
  }],
  ['PATCH', /^\/api\/slot-capacities$/, async context => {
    const actor = await context.role('admin');
    await context.limit('write');
    const input = await readBody(context.request);
    return json(input.items !== undefined
      ? await context.services.slotCapacities.updateMany(slotCapacityBatchInput(input), actor)
      : await context.services.slotCapacities.update(slotCapacityInput(input), actor));
  }]
];
