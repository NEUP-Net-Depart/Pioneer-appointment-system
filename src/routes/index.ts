import type { RequestContext, Route } from './route.ts';
import { warrantyRoutes } from './warranty.ts';
import { scanRoutes } from './scan.ts';
import { authRoutes } from './auth.ts';
import { appointmentRoutes } from './appointments.ts';
import { attachmentRoutes } from './attachments.ts';
import { userRoutes } from './users.ts';
import { statsRoutes } from './stats.ts';
import { activationRoutes } from './activation.ts';
import { slotCapacityRoutes } from './slot-capacities.ts';
import { staffPlatformRoutes } from './staff-platform.ts';
import { serviceLocationRoutes } from './service-locations.ts';
import { fail, json } from '../lib/http.ts';
import { bookingSettingsRoutes } from './booking-settings.ts';

const routes: Route[] = [
  ['GET', /^\/api\/health$/, async context => json(await context.services.health())],
  ...warrantyRoutes,...authRoutes,...activationRoutes,...scanRoutes,...appointmentRoutes,...attachmentRoutes,...userRoutes,...statsRoutes,...slotCapacityRoutes,...serviceLocationRoutes,...staffPlatformRoutes,...bookingSettingsRoutes
];
export async function dispatch(context: RequestContext) {
  for (const [method, pattern, handler] of routes) {
    if (context.request.method !== method) continue;
    const match = context.url.pathname.match(pattern);
    if (match) return handler(context, match);
  }
  fail(404, 'API 路径不存在');
}
