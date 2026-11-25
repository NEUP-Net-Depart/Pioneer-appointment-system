import type { AttachmentPurpose } from '../../shared/appointment-types.ts';
import { Buffer } from 'node:buffer';
import { fail, readBody, readBytes } from './http.ts';

const mimeTypes = ['image/jpeg','image/png','image/webp','application/pdf','text/plain'] as const;
const purposes = ['general', 'student_photo', 'intake_front', 'intake_back'] as const satisfies readonly AttachmentPurpose[];
export function attachmentInput(body: Record<string, unknown>) {
  if (typeof body.filename !== 'string' || typeof body.mimeType !== 'string' || typeof body.data !== 'string') fail(400, '附件格式不正确');
  const { maxBytes, sizeError } = attachmentMetadata(body);
  if (body.data.length > Math.ceil(maxBytes / 3) * 4) fail(400, sizeError);
  if (!body.data.length || body.data.length % 4 || /[^A-Za-z0-9+/=]/.test(body.data) || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.data)) fail(400, '附件格式不正确');
  const bytes = Buffer.from(body.data, 'base64');
  if (bytes.toString('base64') !== body.data) fail(400, '附件格式不正确');
  return attachmentBytes(body, bytes);
}

function attachmentMetadata(body: Record<string, unknown>) {
  if (typeof body.filename !== 'string' || typeof body.mimeType !== 'string') fail(400, '附件格式不正确');
  const purpose = purposes.find(value => value === (body.purpose || 'general'));
  if (!purpose) fail(400, '附件用途不正确');
  const intake = purpose === 'intake_front' || purpose === 'intake_back', photo = intake || purpose === 'student_photo';
  const maxBytes = (photo ? 2 : 5) * 1024 * 1024;
  const sizeError = intake ? '签到照片大小不能超过 2 MB' : photo ? '照片大小不能超过 2 MB' : '附件大小不能超过 5 MB';
  // Strip ASCII control characters from download filenames.
  // eslint-disable-next-line no-control-regex
  const filename = (body.filename.split(/[\\/]/).pop() || '').replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 160);
  const rawMime = body.mimeType.toLowerCase();
  const mimeType = mimeTypes.find(value => value === rawMime);
  if (!filename || !mimeType) fail(400, '附件格式不支持');
  if (intake && !mimeType.startsWith('image/')) fail(400, '签到照片必须为图片');
  if (purpose === 'student_photo' && !mimeType.startsWith('image/')) fail(400, '故障照片必须为图片');
  return { filename, mimeType, purpose, maxBytes, sizeError };
}

export function attachmentBytes(body: Record<string, unknown>, value: Uint8Array) {
  const { filename, mimeType, purpose, maxBytes, sizeError } = attachmentMetadata(body);
  const bytes = Buffer.from(value);
  if (!bytes.length) fail(400, '附件格式不正确');
  if (bytes.length > maxBytes) fail(400, sizeError);
  const valid = {
    'image/jpeg': () => bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255,
    'image/png': () => bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
    'image/webp': () => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP',
    'application/pdf': () => bytes.toString('ascii', 0, 5) === '%PDF-',
    'text/plain': () => { try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes); return !bytes.includes(0); } catch { return false; } }
  };
  if (!valid[mimeType]()) fail(400, '附件内容与文件类型不匹配');
  return { filename, mimeType, bytes, purpose };
}

export async function readAttachment(request: Request) {
  // Keep cached/older clients working during the binary upload rollout.
  if (request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json'))
    return attachmentInput(await readBody(request, 8 * 1024 * 1024));
  let filename;
  try { filename = decodeURIComponent(request.headers.get('X-Attachment-Filename') || ''); }
  catch { fail(400, '附件文件名编码不正确'); }
  const metadata = attachmentMetadata({ filename,
    mimeType: request.headers.get('Content-Type')?.split(';')[0].trim() || '',
    purpose: request.headers.get('X-Attachment-Purpose') || 'general' });
  return attachmentBytes(metadata, await readBytes(request, metadata.maxBytes));
}
