import { json, readBody } from '../lib/http.js';
import { slotCapacityInput, slotCapacityBatchInput } from '../lib/validation.js';

export const slotCapacityRoutes = [
  ['GET', /^\/api\/slot-capacities\/actual$/, async context => {
    return json(await context.services.slotCapacities.actual(await context.permission('settings.manage'), context.query));
  }],
  ['GET', /^\/api\/slot-capacities$/, async context => {
    return json(await context.services.slotCapacities.list(await context.permission('settings.manage')));
  }],
  ['PATCH', /^\/api\/slot-capacities$/, async context => {
    const actor = await context.permission('settings.manage');
    await context.limit('write');
    const input = await readBody(context.request);
    return json(input.items !== undefined
      ? await context.services.slotCapacities.updateMany(slotCapacityBatchInput(input), actor)
      : await context.services.slotCapacities.update(slotCapacityInput(input), actor));
  }]
];
