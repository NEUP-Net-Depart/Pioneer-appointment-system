import { json, readBody } from '../lib/http.js';

export const scanRoutes = [
  ['GET', /^\/api\/appointments\/([^/]+)\/related\/([^/]+)\/scan-code$/, async (context,match) => {
    await context.limit('lookup');
    return json(await context.services.scan.relatedCode(decodeURIComponent(match[1]),decodeURIComponent(match[2]),context.accessToken));
  }],
  ['POST', /^\/api\/scan\/resolve$/, async context => {
    const actor = await context.role('technician');
    await context.limit('lookup');
    return json(await context.services.scan.resolve(await readBody(context.request), actor));
  }],
  ['POST', /^\/api\/scan\/search$/, async context => {
    const actor = await context.role('technician');
    await context.limit('scanSearch');
    return json(await context.services.scan.search(await readBody(context.request), actor));
  }],
  ['POST', /^\/api\/scan\/onsite$/, async context => {
    const actor = await context.role('technician');
    await context.limit('write');
    return json(await context.services.scan.onsite(await readBody(context.request), actor), 201);
  }],
  ['GET', /^\/api\/appointments\/([^/]+)\/scan-code$/, async (context, match) => {
    await context.limit('lookup');
    return json(await context.services.scan.code(decodeURIComponent(match[1]), context.accessToken));
  }]
];
