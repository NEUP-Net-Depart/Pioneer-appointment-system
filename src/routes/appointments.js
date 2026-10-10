import { json, readBody } from '../lib/http.js';
import { appointmentQuery, appointmentPatch, bookingInput, credentials, liveQuery } from '../lib/validation.js';

export const appointmentRoutes = [
  ['GET', /^\/api\/appointments$/, async context => {
    const user = await context.role('technician');
    return json(await context.services.appointments.list(appointmentQuery(context.query), user));
  }],
  ['POST', /^\/api\/appointments$/, async context => {
    await context.limit('write');
    const input = bookingInput(await readBody(context.request));
    return json(await context.services.appointments.create(input, await context.authenticate()), 201);
  }],
  ['GET', /^\/api\/appointments\/lookup$/, async context => {
    await context.limit('lookup');
    const item = await context.services.appointments.lookup(credentials(context.query));
    const attachments = await context.services.attachments.list(item.id, null, item.studentId);
    return json({ ...item, attachments: attachments.items });
  }],
  ['PATCH', /^\/api\/appointments\/([^/]+)\/status$/, async (context, match) => {
    await context.limit('write');
    const input = appointmentPatch(await readBody(context.request));
    return json(await context.services.appointments.update(decodeURIComponent(match[1]), input, await context.authenticate()));
  }],
  ['GET', /^\/api\/live\/summary$/, async context => {
    const query = liveQuery(context.query);
    if (query.appointmentId) await context.limit('lookup', { consume: false });
    try { return json(await context.services.queue.summary(query)); }
    catch (error) {
      // Valid polling only reads the quota. Failed credentials share lookup's budget.
      if (query.appointmentId && error.status === 404) await context.limit('lookup');
      throw error;
    }
  }]
];
