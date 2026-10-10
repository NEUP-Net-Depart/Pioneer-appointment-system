import { json,readBody } from '../lib/http.js';
export const activationRoutes=[
  ['POST',/^\/api\/activation$/,async context=>{
    await context.limit('activation');
    return json(await context.services.activation.submit(await readBody(context.request)),201);
  }],
  ['GET',/^\/api\/activation\/([^/]+)$/,async(context,match)=>{
    await context.limit('lookup');
    return json(await context.services.activation.status(decodeURIComponent(match[1]),context.request.headers.get('X-Activation-Receipt')));
  }],
  ['GET',/^\/api\/staff-whitelist$/,async context=>json(await context.services.activation.whitelist(await context.role('admin')))],
  ['POST',/^\/api\/staff-whitelist\/import$/,async context=>{
    const actor=await context.role('admin');
    return json(await context.services.activation.import(await readBody(context.request),actor));
  }],
  ['PATCH',/^\/api\/staff-whitelist\/([^/]+)$/,async(context,match)=>{
    const actor=await context.role('admin');
    return json(await context.services.activation.changeWhitelist(decodeURIComponent(match[1]),await readBody(context.request),actor));
  }],
  ['GET',/^\/api\/activation-requests$/,async context=>json(await context.services.activation.requests(await context.role('admin')))],
  ['POST',/^\/api\/activation-requests\/review$/,async context=>{
    const actor=await context.role('admin');
    return json(await context.services.activation.review(await readBody(context.request),actor));
  }]
];
