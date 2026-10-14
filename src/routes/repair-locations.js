import { json, readBody } from '../lib/http.js';
import { repairLocationInput } from '../lib/validation.js';

export const repairLocationRoutes = [
  ['GET', /^\/api\/repair-locations$/, async context => json(await context.services.repairLocations.list())],
  ['PATCH', /^\/api\/repair-locations$/, async context => {
    const actor = await context.role('superadmin');
    await context.limit('write');
    return json(await context.services.repairLocations.update(repairLocationInput(await readBody(context.request)),actor));
  }]
];
