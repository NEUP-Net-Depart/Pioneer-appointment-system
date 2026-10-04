import { rateKey } from '../lib/jwt.js';
import { fail } from '../lib/http.js';
import { epochSeconds } from '../../shared/time.js';

const policies = { login: { limit: 20, seconds: 900 }, guest: { limit: 120, seconds: 60 }, upload: { limit: 30, seconds: 60 } };
export function rateLimitService(repository, secret) {
  return {
    async check(ip, scope) {
      const policy = policies[scope];
      const count = await repository.increment(rateKey(secret, scope, ip), epochSeconds(), policy.seconds);
      if (count > policy.limit) fail(429, '操作过于频繁，请稍后再试');
    }
  };
}
