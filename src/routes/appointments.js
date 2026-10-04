import { json, readBody } from '../lib/http.js';
import { appointmentQuery, appointmentPatch, bookingInput, credentials, liveQuery } from '../lib/validation.js';

export const appointmentRoutes = [
  ['GET', /^\/api\/appointments$/, async context => {
    const user = await context.role('student');
    return json(await context.services.appointments.list(appointmentQuery(context.query), user));
  }],
  ['POST', /^\/api\/appointments$/, async context => {
    await context.limit();
    const input = bookingInput(await readBody(context.request));
    return json(await context.services.appointments.create(input, await context.authenticate()), 201);
  }],
  ['GET', /^\/api\/appointments\/lookup$/, async context => {
    await context.limit();
    const item = await context.services.appointments.lookup(credentials(context.query));
    const attachments = await context.services.attachments.list(item.id, null, item.studentId);
    return json({ ...item, attachments: attachments.items });
  }],
  ['PATCH', /^\/api\/appointments\/([^/]+)\/status$/, async (context, match) => {
    await context.limit();
    const input = appointmentPatch(await readBody(context.request));
    return json(await context.services.appointments.update(decodeURIComponent(match[1]), input, await context.authenticate()));
  }],
  ['GET', /^\/api\/live\/summary$/, async context => {
    await context.limit();
    return json(await context.services.queue.summary(liveQuery(context.query)));
  }]
];
