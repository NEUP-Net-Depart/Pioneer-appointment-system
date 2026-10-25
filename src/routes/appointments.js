import { json, readBody } from '../lib/http.js';
import { appointmentQuery, appointmentPatch, bookingDevicesInput, bookingRequestKey, liveQuery } from '../lib/validation.js';

export const appointmentRoutes = [
  ['PATCH', /^\/api\/appointments\/([^/]+)\/device$/, async (context,match) => {
    await context.limit('write');
    return json(await context.services.appointments.editDevice(decodeURIComponent(match[1]),await readBody(context.request),context.accessToken));
  }],
  ['POST', /^\/api\/appointments\/([^/]+)\/repair-followups\/([^/]+)\/queue-exit$/, async (context,match) => {
    await context.limit('write');
    return json(await context.services.appointments.leaveFollowupQueue(decodeURIComponent(match[1]),decodeURIComponent(match[2]),await readBody(context.request),context.accessToken));
  }],
  ['POST', /^\/api\/appointments\/([^/]+)\/queue-exit$/, async (context,match) => {
    await context.limit('write');
    return json(await context.services.appointments.leaveQueue(decodeURIComponent(match[1]),await readBody(context.request),context.accessToken));
  }],
  ['GET', /^\/api\/appointments\/([^/]+)\/reception-options$/, async (context,match) =>
    json(await context.services.appointments.receptionOptions(decodeURIComponent(match[1]),await context.role('technician')))],
  ['POST', /^\/api\/appointments\/([^/]+)\/reception$/, async (context,match) => {
    await context.limit('write');
    return json(await context.services.appointments.reception(decodeURIComponent(match[1]),await readBody(context.request),await context.role('technician')));
  }],
  ['GET', /^\/api\/appointments\/overview$/, async context => {
    return json(await context.services.appointments.overview(await context.role('technician')));
  }],
  ['POST', /^\/api\/appointments\/([^/]+)\/repair-followups$/, async (context,match) => {
    await context.limit('write');
    return json(await context.services.followups.request(decodeURIComponent(match[1]),await readBody(context.request),context.accessToken),201);
  }],
  ['POST', /^\/api\/appointments\/([^/]+)\/repair-followups\/staff$/, async (context,match) => {
    await context.limit('write');
    return json(await context.services.followups.createByStaff(decodeURIComponent(match[1]),await readBody(context.request),await context.role('technician')),201);
  }],
  ['GET', /^\/api\/appointments$/, async context => {
    const user = await context.role('technician');
    return json(await context.services.appointments.list(appointmentQuery(context.query), user));
  }],
  ['POST', /^\/api\/appointments$/, async context => {
    await context.limit('write');
    const raw = await readBody(context.request);
    const input = bookingDevicesInput(raw);
    return json(await context.services.appointments.createDevices(input,bookingRequestKey(context.request.headers.get('Idempotency-Key')),raw.additionalFor,context.accessToken), 201);
  }],
  ['POST', /^\/api\/booking-attempts\/resolve$/, async context => {
    await context.limit('lookup');
    const input = await readBody(context.request);
    return json(await context.services.appointments.resolveAttempt(bookingRequestKey(input.requestKey)));
  }],
  ['GET', /^\/api\/appointments\/([^/]+)$/, async (context,match) => {
    await context.limit('lookup');
    const item = await context.services.appointments.lookup(decodeURIComponent(match[1]),context.accessToken);
    const attachments = await context.services.attachments.list(item.id,null,context.accessToken);
    return json({ ...item, attachments: attachments.items });
  }],
  ['POST', /^\/api\/appointments\/([^/]+)\/credential$/, async (context,match) => {
    const actor=await context.role('technician');
    await context.limit('write');
    return json(await context.services.appointments.recover(decodeURIComponent(match[1]),await readBody(context.request),actor));
  }],
  ['PATCH', /^\/api\/appointments\/([^/]+)\/status$/, async (context, match) => {
    await context.limit('write');
    const input = appointmentPatch(await readBody(context.request));
    return json(await context.services.appointments.update(decodeURIComponent(match[1]),input,await context.authenticate(),context.accessToken));
  }],
  ['POST', /^\/api\/appointments\/([^/]+)\/transfer$/, async (context, match) => {
    await context.limit('write');
    return json(await context.services.appointments.transfer(decodeURIComponent(match[1]), await readBody(context.request), await context.role('technician')));
  }],
  ['PATCH', /^\/api\/appointments\/([^/]+)\/correction$/, async (context, match) => {
    await context.limit('write');
    const input = appointmentPatch({ ...await readBody(context.request), action: 'correct' });
    return json(await context.services.appointments.update(decodeURIComponent(match[1]), { ...input, action: 'correct' }, await context.role('technician')));
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
