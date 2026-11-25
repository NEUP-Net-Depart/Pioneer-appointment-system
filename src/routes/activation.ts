import type { Route } from './route.ts';
import { json,readBody } from '../lib/http.ts';
export const activationRoutes: Route[] = [
  ['GET',/^\/api\/members\/([^/]+)\/activation$/,async(context,match: string[])=>{
    return json(await context.services.activation.member(decodeURIComponent(match[1]),await context.permission('accounts.manage')));
  }],
  ['POST',/^\/api\/members\/([^/]+)\/activation$/,async(context,match: string[])=>{
    const actor=await context.permission('accounts.manage');
    return json(await context.services.activation.configureMember(decodeURIComponent(match[1]),await readBody(context.request),actor));
  }],
  ['POST',/^\/api\/activation$/,async context=>{
    await context.limit('activation');
    return json(await context.services.activation.submit(await readBody(context.request)),201);
  }],
  ['GET',/^\/api\/activation\/([^/]+)$/,async(context,match: string[])=>{
    await context.limit('lookup');
    return json(await context.services.activation.status(decodeURIComponent(match[1]),context.request.headers.get('X-Activation-Receipt')));
  }],
  ['GET',/^\/api\/staff-whitelist$/,async context=>json(await context.services.activation.whitelist(await context.permission('accounts.manage')))],
  ['PATCH',/^\/api\/staff-whitelist\/([^/]+)$/,async(context,match: string[])=>{
    const actor=await context.permission('accounts.manage');
    return json(await context.services.activation.changeWhitelist(decodeURIComponent(match[1]),await readBody(context.request),actor));
  }],
  ['GET',/^\/api\/activation-requests$/,async context=>json(await context.services.activation.requests(await context.permission('accounts.manage')))],
  ['POST',/^\/api\/activation-requests\/review$/,async context=>{
    const actor=await context.permission('accounts.manage');
    return json(await context.services.activation.review(await readBody(context.request),actor));
  }]
];
