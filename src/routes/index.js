import { authRoutes } from './auth.js';
import { appointmentRoutes } from './appointments.js';
import { attachmentRoutes } from './attachments.js';
import { userRoutes } from './users.js';
import { statsRoutes } from './stats.js';
import { activationRoutes } from './activation.js';
import { fail, json } from '../lib/http.js';

const routes = [
  ['GET', /^\/api\/health$/, async context => json(await context.services.health())],
  ...authRoutes,...activationRoutes,...appointmentRoutes,...attachmentRoutes,...userRoutes,...statsRoutes
];
export async function dispatch(context) {
  for (const [method, pattern, handler] of routes) {
    if (context.request.method !== method) continue;
    const match = context.url.pathname.match(pattern);
    if (match) return handler(context, match);
  }
  fail(404, 'API 路径不存在');
}
