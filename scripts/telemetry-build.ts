import { execFileSync } from 'node:child_process';
import { releaseId } from '../shared/telemetry.ts';

export function telemetryBuildConfig(env = process.env) {
  const environment = env.TELEMETRY_ENVIRONMENT === 'production' || env.TELEMETRY_ENVIRONMENT === 'preview'
    ? env.TELEMETRY_ENVIRONMENT
    : 'local';
  const choose = (key: string, fallback: string) =>
    env[key] === undefined || env[key] === '' ? fallback : env[key];
  const token = env.POSTHOG_PROJECT_TOKEN || '';
  const requested =
    choose('POSTHOG_ENABLED', environment === 'production' ? 'true' : 'false') === 'true';
  if (env.POSTHOG_ENABLED === 'true' && !token)
    throw new Error('POSTHOG_ENABLED requires POSTHOG_PROJECT_TOKEN');
  const hosts = ['https://t.ptroc.cn', 'https://us.i.posthog.com', 'https://eu.i.posthog.com'];
  const host = choose('POSTHOG_HOST', hosts[0]);
  if (!hosts.includes(host)) throw new Error(`POSTHOG_HOST must be one of: ${hosts.join(', ')}`);
  const replaySampleRate = Number(choose('POSTHOG_REPLAY_SAMPLE_RATE', '1'));
  if (!Number.isFinite(replaySampleRate) || replaySampleRate < 0 || replaySampleRate > 1)
    throw new Error('POSTHOG_REPLAY_SAMPLE_RATE must be between 0 and 1');
  let commit = env.TELEMETRY_RELEASE;
  if (!commit) {
    try {
      commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      commit = 'local';
    }
  }
  return {
    enabled: requested && !!token,
    interactions: choose('POSTHOG_INTERACTIONS', 'true') !== 'false',
    posthog: {
      token,
      host,
      uiHost:
        host === 'https://eu.i.posthog.com' ? 'https://eu.posthog.com' : 'https://us.posthog.com',
      replay: choose('POSTHOG_REPLAY_ENABLED', 'true') !== 'false',
      replaySampleRate
    },
    environment,
    release: releaseId(commit),
    webAnalyticsToken: /^[a-f\d]{32}$/i.test(env.CF_WEB_ANALYTICS_TOKEN || '')
      ? env.CF_WEB_ANALYTICS_TOKEN
      : ''
  };
}

export function posthogHeaders(headers: string, config: Pick<ReturnType<typeof telemetryBuildConfig>, 'enabled' | 'posthog'>) {
  if (!config.enabled) return headers;
  const host = config.posthog.host;
  const assets = host.replace('.i.posthog.com', '-assets.i.posthog.com');
  const connections = [...new Set([host, assets])].join(' ');
  return headers.replace(/Content-Security-Policy: ([^\n]+)/g, (_, policy: string) => {
    policy = policy
      .replace(/script-src ([^;]+)/, `$& ${assets}`)
      .replace(/connect-src ([^;]+)/, `$& ${connections}`);
    policy = /worker-src /.test(policy)
      ? policy.replace(/worker-src ([^;]+)/, '$& blob:')
      : `${policy}; worker-src 'self' blob:`;
    return `Content-Security-Policy: ${policy}`;
  });
}
