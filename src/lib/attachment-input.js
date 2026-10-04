import { Buffer } from 'node:buffer';
import { fail } from './http.js';

const mimeTypes = new Set(['image/jpeg','image/png','image/webp','application/pdf','text/plain']);
export function attachmentInput(body) {
  if (typeof body.filename !== 'string' || typeof body.mimeType !== 'string' || typeof body.data !== 'string') fail(400, '附件格式不正确');
  // Strip ASCII control characters from download filenames.
  // eslint-disable-next-line no-control-regex
  const filename = body.filename.split(/[\\/]/).pop().replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 160);
  const mimeType = body.mimeType.toLowerCase();
  if (!filename || !mimeTypes.has(mimeType) || !body.data.length || body.data.length > 6990508 || body.data.length % 4 || /[^A-Za-z0-9+/=]/.test(body.data) || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) fail(400, '附件格式不支持或大小超过 5 MB');
  const bytes = Buffer.from(body.data, 'base64');
  if (bytes.toString('base64') !== body.data || !bytes.length || bytes.length > 5 * 1024 * 1024) fail(400, '附件大小不能超过 5 MB');
  const valid = {
    'image/jpeg': () => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    'image/png': () => bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    'image/webp': () => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
    'application/pdf': () => bytes.toString('ascii', 0, 5) === '%PDF-',
    'text/plain': () => { try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); return !bytes.includes(0); } catch { return false; } }
  };
  if (!valid[mimeType]()) fail(400, '附件内容与文件类型不匹配');
  return { filename, mimeType, bytes };
}
