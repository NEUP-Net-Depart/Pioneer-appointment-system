import { fail } from '../lib/http.js';
import { signToken, verifyToken, TOKEN_TTL_SECONDS } from '../lib/jwt.js';
import { verifyPassword } from '../lib/passwords.js';
import { account } from '../lib/validation.js';
import { roleLevel } from '../../shared/constants.js';

export function authService(users, secret) {
  return {
    async authenticate(authorization) {
      if (!authorization) return null;
      const claims = verifyToken(authorization.startsWith('Bearer ') ? authorization.slice(7) : '', secret);
      if (!claims) fail(401, '登录已失效，请重新登录');
      const user = await users.find(claims.sub);
      if (user?.status !== 'enabled' || user.role !== claims.role || user.tokenVersion !== claims.ver) fail(401, '登录已失效，请重新登录');
      return user;
    },
    async login(input) {
      const user = await users.find(account(input.account));
      if (typeof input.password !== 'string' || input.password.length > 128 || user?.status !== 'enabled' || !verifyPassword(input.password, user.passwordHash)) fail(401, '账号或密码不正确');
      return { account: user.account, role: user.role, permissions: Object.keys(roleLevel).filter(role => roleLevel[role] <= roleLevel[user.role]), token: signToken(user, secret), expiresIn: TOKEN_TTL_SECONDS };
    },
    async logout(user) { await users.revokeTokens(user.account); return { ok: true }; }
  };
}
export function requireRole(user, minimum) {
  if (!user) fail(401, '登录已失效，请重新登录');
  if ((roleLevel[user.role] ?? -1) < roleLevel[minimum]) fail(403, '没有执行此操作的权限');
  return user;
}
