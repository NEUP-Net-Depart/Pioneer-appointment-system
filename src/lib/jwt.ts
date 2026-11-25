import type { AccountRecord } from '../db/records.ts';
import { isObject } from '../../shared/api-types.ts';

interface TokenClaims { sub: string; role: string; ver: number; exp: number }
import { timingSafeEqual, createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { epochSeconds } from '../../shared/time.ts';
export const TOKEN_TTL_SECONDS = 8 * 60 * 60;
export function signToken(user: Pick<AccountRecord, 'account' | 'role' | 'tokenVersion'>, secret: string) {
  const now = epochSeconds();
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub: user.account, role: user.role, ver: user.tokenVersion, iat: now, exp: now + TOKEN_TTL_SECONDS })).toString('base64url');
  const data = `${header}.${payload}`;
  return `${data}.${createHmac('sha256', secret).update(data).digest('base64url')}`;
}
export function verifyToken(token: string, secret: string): TokenClaims | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [header, payload, signature] = parts;
    const meta: unknown = JSON.parse(Buffer.from(header, 'base64url').toString());
    if (!isObject(meta) || meta.alg !== 'HS256' || meta.typ !== 'JWT') return null;
    const expected = createHmac('sha256', secret).update(`${header}.${payload}`).digest();
    const actual = Buffer.from(signature, 'base64url');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
    const body: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!isObject(body) || typeof body.sub !== 'string' || typeof body.role !== 'string' || !body.role || typeof body.ver !== 'number' || !Number.isInteger(body.ver) || typeof body.exp !== 'number' || !Number.isFinite(body.exp) || body.exp <= epochSeconds()) return null;
    return { ...body, sub: body.sub, role: body.role, ver: body.ver, exp: body.exp };
  } catch { return null; }
}
export function rateKey(secret: string, scope: string, ip: string) {
  return createHmac('sha256', secret).update(`${scope}:${ip}`).digest('hex');
}
