import { isObject } from '../../shared/api-types.ts';
import type { FieldErrors } from '../../shared/api-types.ts';

export class HttpError extends Error {
  declare status: number;
  declare code: string;
  declare fields?: FieldErrors;

  constructor(status: number, message: string, code = '', fields?: FieldErrors) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}
export function fail(status: number, message: string, code = '', fields?: FieldErrors): never {
  throw new HttpError(status, message, code, fields);
}
export const securityHeaders = {
  'Alt-Svc': 'clear',
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox"
};
export function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
}
export async function readBytes(request: Request, maxBytes: number) {
  if (Number(request.headers.get('content-length')) > maxBytes) fail(413, '请求体过大');
  const reader = request.body?.getReader();
  if (!reader) fail(400, '缺少请求体');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); fail(413, '请求体过大'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function readBody(request: Request, maxBytes = 1024 * 1024) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail(415, '请求必须使用 application/json');
  const bytes = await readBytes(request, maxBytes);
  let body: unknown;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, '请求体不是有效 JSON'); }
  if (!isObject(body)) fail(400, '请求体必须是 JSON 对象');
  return body;
}
