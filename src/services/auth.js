import { fail } from '../lib/http.js';
import { signToken, verifyToken, TOKEN_TTL_SECONDS } from '../lib/jwt.js';
import { verifyPassword,hashPassword } from '../lib/passwords.js';
import { account,passwordInput } from '../lib/validation.js';

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
      return {account:user.account,name:user.name,role:user.role,status:user.status,homeCampus:user.homeCampus,authorizedCampuses:user.authorizedCampuses,
        token:signToken(user,secret),expiresIn:TOKEN_TTL_SECONDS};
    },
    async logout(user) { await users.revokeTokens(user.account); return { ok: true }; },
    async changePassword(input,user) {
      if (typeof input.currentPassword!=='string' || input.currentPassword.length>128 || !verifyPassword(input.currentPassword,user.passwordHash)) fail(400,'当前密码不正确');
      const password=passwordInput(input.newPassword);
      if (password===input.currentPassword) fail(400,'新密码必须与当前密码不同');
      if (!await users.update(user,{passwordHash:hashPassword(password)},{selfPassword:true})) fail(409,'账号已更新，请重新登录后重试');
      return {ok:true,message:'密码已修改，所有会话已撤销，请重新登录'};
    }
  };
}
