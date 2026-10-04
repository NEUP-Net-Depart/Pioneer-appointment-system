const crypto = require('node:crypto');

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

function base64url(value) {
  return Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function fromBase64url(value) {
  return Buffer.from(value.replaceAll('-', '+').replaceAll('_', '/'), 'base64');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(String(password), salt, 64, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 32 * 1024 * 1024 });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function verifyPassword(password, encoded) {
  try {
    const [algorithm, n, r, p, saltText, hashText] = String(encoded || '').split('$');
    if (algorithm !== 'scrypt' || !saltText || !hashText) return false;
    const expected = Buffer.from(hashText, 'base64');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltText, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 32 * 1024 * 1024 });
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function tokenSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set to a random value of at least 32 characters');
  return 'development-only-change-this-jwt-secret-please';
}

function signToken(user) {
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ sub: user.account, role: user.role, ver: Number(user.tokenVersion || 0), iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS }));
  const data = `${header}.${payload}`;
  const signature = base64url(crypto.createHmac('sha256', tokenSecret()).update(data).digest());
  return `${data}.${signature}`;
}

function verifyToken(token) {
  try {
    const [header, payload, signature] = String(token || '').split('.');
    if (!header || !payload || !signature) return null;
    const data = `${header}.${payload}`;
    const expected = crypto.createHmac('sha256', tokenSecret()).update(data).digest();
    const actual = fromBase64url(signature);
    if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null;
    const body = JSON.parse(fromBase64url(payload).toString('utf8'));
    if (!body.sub || !body.role || !body.exp || body.exp <= Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, TOKEN_TTL_SECONDS };
