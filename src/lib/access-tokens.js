import { randomBytes, createHash } from 'node:crypto';
export function issueAccessToken() {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashAccessToken(token) };
}
export function hashAccessToken(token) {
  return createHash('sha256').update(token).digest('hex');
}
