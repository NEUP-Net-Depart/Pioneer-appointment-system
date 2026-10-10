import { json, securityHeaders } from '../lib/http.js';
import { statsQuery } from '../lib/validation.js';

export const statsRoutes = [
  ['GET', /^\/api\/stats\/(summary|fault-types)$/, async (context, match) => {
    const actor=await context.role('admin');
    const result = await context.services.stats.summary(statsQuery(context.query),actor);
    return json(match[1] === 'fault-types' ? result.faults : result);
  }],
  ['GET', /^\/api\/export\/appointments\.csv$/, async context => {
    const actor=await context.role('admin');
    return new Response(await context.services.export.csv(actor), { headers: { ...securityHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="appointments.csv"' } });
  }]
];
