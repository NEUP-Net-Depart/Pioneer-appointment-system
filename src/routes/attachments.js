import { fail, json, readBody, securityHeaders } from '../lib/http.js';
import { attachmentInput } from '../lib/attachment-input.js';
import { account } from '../lib/validation.js';

export const attachmentRoutes = [
  ['POST', /^\/api\/appointments\/([^/]+)\/attachments(?:\/([^/]+))?$/, async (context, match) => {
    await context.limit('upload');
    if (match[2]) fail(405, '此路径不支持上传');
    const body = await readBody(context.request, 8 * 1024 * 1024);
    const result = await context.services.attachments.upload(decodeURIComponent(match[1]), attachmentInput(body), await context.authenticate(), account(body.studentId));
    return json(result, 201);
  }],
  ['GET', /^\/api\/appointments\/([^/]+)\/attachments$/, async (context, match) => {
    await context.limit('lookup');
    return json(await context.services.attachments.list(decodeURIComponent(match[1]), await context.authenticate(), account(context.query.studentId)));
  }],
  ['GET', /^\/api\/appointments\/([^/]+)\/attachments\/([^/]+)$/, async (context, match) => {
    await context.limit('lookup');
    const file = await context.services.attachments.download(decodeURIComponent(match[1]), decodeURIComponent(match[2]), await context.authenticate(), account(context.query.studentId));
    return new Response(file.body, { headers: { ...securityHeaders, 'Content-Type': file.metadata.mimeType, 'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename="attachment"; filename*=UTF-8''${encodeURIComponent(file.metadata.filename)}` } });
  }]
];
