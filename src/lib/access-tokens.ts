import { Buffer } from 'node:buffer';
import { randomBytes, createHash } from 'node:crypto';
export function issueAccessToken() {
  const token = Buffer.from(randomBytes(32)).toString('base64url');
  return { token, hash: hashAccessToken(token) };
}
export function hashAccessToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
export function bookingDigest(data: object) {
  return createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.entries(data).sort(([a],[b]) => a.localeCompare(b))))).digest('hex');
}
