import { rateKey } from '../lib/jwt.js';
import { fail } from '../lib/http.js';
import { epochSeconds } from '../../shared/time.js';

const policies = {
  login: { limit: 20, seconds: 900 }, lookup: { limit: 30, seconds: 60 },
  write: { limit: 30, seconds: 60 }, upload: { limit: 15, seconds: 60 }
};
export function rateLimitService(repository, secret) {
  return {
    async check(ip, scope, { consume = true } = {}) {
      const policy = policies[scope];
      if (!policy) throw new Error('Unknown rate limit scope');
      const key = rateKey(secret, scope, ip), now = epochSeconds();
      const count = consume ? await repository.increment(key, now, policy.seconds) : await repository.count(key, now);
      if (consume ? count > policy.limit : count >= policy.limit) fail(429, '操作过于频繁，请稍后再试');
    }
  };
}
