export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };
export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; sandbox"
};
export function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...securityHeaders, 'Content-Type': 'application/json; charset=utf-8' } });
}
export async function readBody(request, maxBytes = 1024 * 1024) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail(415, '请求必须使用 application/json');
  if (Number(request.headers.get('content-length')) > maxBytes) fail(413, '请求体过大');
  const reader = request.body?.getReader();
  if (!reader) fail(400, '缺少请求体');
  const chunks = []; let length = 0;
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
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, '请求体不是有效 JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, '请求体必须是 JSON 对象');
  return body;
}
