import { json, readBody } from '../lib/http.js';
import { appointmentQuery, appointmentPatch, bookingInput, bookingRequestKey } from '../lib/validation.js';
import { appointmentContactTerm } from '../../shared/appointment-search.js';

export const appointmentRoutes = [
  ...['receive','photos'].map(operation => ['POST',new RegExp('^/api/appointments/([^/]+)/'+operation+'$'),async (context,match)=>{
    await context.limit('write');
    const {patch,...rest}=appointmentPatch(await readBody(context.request));
    return json(await context.services.appointments[operation==='receive'?'receive':'supplement'](decodeURIComponent(match[1]),{...patch,...rest},await context.role('technician')));
  }]),
  ['PATCH', /^\/api\/appointments\/([^/]+)\/information$/, async(context,match)=>{
    await context.limit('write');
    return json(await context.services.appointments.edit(decodeURIComponent(match[1]),await readBody(context.request),await context.role('technician')));
  }],
  ['GET', /^\/api\/appointments\/overview$/, async context => {
    return json(await context.services.appointments.overview(await context.role('technician')));
  }],
  ['POST', /^\/api\/appointments\/([^/]+)\/link$/, async(context,match)=>{
    await context.limit('write');
    return json(await context.services.appointments.link(decodeURIComponent(match[1]),await readBody(context.request),await context.role('technician')));
  }],
  ['GET', /^\/api\/appointments$/, async context => {
    const user = await context.role('technician');
    const query = appointmentQuery(context.query);
    if (appointmentContactTerm(query.q)) await context.limit('scanSearch');
    return json(await context.services.appointments.list(query, user));
  }],
  ['POST', /^\/api\/appointments$/, async context => {
    await context.limit('write');
    const input = bookingInput(await readBody(context.request));
    return json(await context.services.appointments.create(input,undefined,bookingRequestKey(context.request.headers.get('Idempotency-Key'))), 201);
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
];
