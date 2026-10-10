import { json, readBody } from '../lib/http.js';
import { appointmentQuery, appointmentPatch, bookingInput, liveQuery } from '../lib/validation.js';

export const appointmentRoutes = [
  ['GET', /^\/api\/appointments$/, async context => {
    const user = await context.role('technician');
    return json(await context.services.appointments.list(appointmentQuery(context.query), user));
  }],
  ['POST', /^\/api\/appointments$/, async context => {
    await context.limit('write');
    const input = bookingInput(await readBody(context.request));
    return json(await context.services.appointments.create(input), 201);
  }],
  ['GET', /^\/api\/appointments\/([^/]+)$/, async (context,match) => {
    await context.limit('lookup');
    const item = await context.services.appointments.lookup(decodeURIComponent(match[1]),context.accessToken);
    const attachments = await context.services.attachments.list(item.id,null,context.accessToken);
    return json({ ...item, attachments: attachments.items });
  }],
  ['POST', /^\/api\/appointments\/([^/]+)\/credential$/, async (context,match) => {
    const actor=await context.role('admin');
    await context.limit('write');
    return json(await context.services.appointments.recover(decodeURIComponent(match[1]),await readBody(context.request),actor));
  }],
  ['PATCH', /^\/api\/appointments\/([^/]+)\/status$/, async (context, match) => {
    await context.limit('write');
    const input = appointmentPatch(await readBody(context.request));
    return json(await context.services.appointments.update(decodeURIComponent(match[1]),input,await context.authenticate(),context.accessToken));
  }],
  ['GET', /^\/api\/live\/summary$/, async context => {
    const query = liveQuery(context.query);
    if (query.appointmentId) await context.limit('lookup', { consume: false });
    try { return json(await context.services.queue.summary(query,context.accessToken)); }
    catch (error) {
      // Valid polling only reads the quota. Failed credentials share lookup's budget.
      if (query.appointmentId && error.status === 404) await context.limit('lookup');
      throw error;
    }
  }]
];
