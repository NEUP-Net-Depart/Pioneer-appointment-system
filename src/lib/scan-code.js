import { createHmac, timingSafeEqual } from 'node:crypto';
import { fail } from './http.js';

// Domain separation keeps this independent from contact encryption and staff JWTs.
export function scanCode(id, secret) {
  return `${id}.${createHmac('sha256', secret).update(`pioneer:repair-qr:v1:${id}`).digest('hex').slice(0, 12)}`;
}
export function verifyScanCode(value, secret) {
  if (typeof value !== 'string' || !/^(?:reserve|reverse)?[01]\d{8}-\d{2,}\.[a-f0-9]{12}$/.test(value)) fail(400, '不是有效的维修二维码');
  const id = value.slice(0, value.lastIndexOf('.'));
  const encode = new TextEncoder();
  const secrets = [...new Set((Array.isArray(secret) ? secret : [secret]).filter(Boolean))];
  if (!secrets.map(key => timingSafeEqual(encode.encode(value), encode.encode(scanCode(id, key)))).some(Boolean)) fail(400, '二维码校验失败');
  return id;
}
