import type { Route } from './route.ts';
import { json, securityHeaders } from '../lib/http.ts';
import { statsQuery } from '../lib/validation.ts';

export const statsRoutes: Route[] = [
  ['GET', /^\/api\/stats\/(summary|fault-types)$/, async (context, match: string[]) => {
    const actor=await context.permission('statistics.read');
    const result = await context.services.stats.summary(statsQuery(context.query),actor);
    return json(match[1] === 'fault-types' ? result.faults : result);
  }],
  ['GET', /^\/api\/export\/appointments\.csv$/, async context => {
    const actor=await context.permission('statistics.read');
    return new Response(await context.services.export.csv(actor), { headers: { ...securityHeaders, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="appointments.csv"' } });
  }]
];
