import { timingSafeEqual, createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { epochSeconds } from '../../shared/time.js';
export const TOKEN_TTL_SECONDS = 8 * 60 * 60;
export function signToken(user, secret) {
  const now = epochSeconds();
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: user.account, role: user.role, ver: user.tokenVersion, iat: now, exp: now + TOKEN_TTL_SECONDS })).toString('base64url');
  const data = `${header}.${payload}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}
export function verifyToken(token, secret) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const meta = JSON.parse(Buffer.from(header, 'base64url'));
    if (meta.alg !== 'HS256' || meta.typ !== 'JWT') return null;
    const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const body = JSON.parse(Buffer.from(payload, 'base64url'));
    if (typeof body.sub !== 'string' || !body.role || !Number.isInteger(body.ver) || !Number.isFinite(body.exp) || body.exp <= epochSeconds()) return null;
    return body;
  } catch { return null; }
}
export function rateKey(secret, scope, ip) {
  return createHmac('sha256', secret).update(`${scope}:${ip}`).digest('hex');
}
