import { execFileSync } from 'node:child_process';
import { releaseId } from '../shared/telemetry.js';

export function telemetryBuildConfig(cfg, env = process.env) {
  const environment = ['production', 'preview'].includes(env.TELEMETRY_ENVIRONMENT)
    ? env.TELEMETRY_ENVIRONMENT
    : 'local';
  const base = environment === 'preview' ? cfg.env.preview.vars : cfg.vars;
  const choose = (key, fallback) =>
    env[key] === undefined || env[key] === '' ? fallback : env[key];
  let commit = env.TELEMETRY_RELEASE;
  if (!commit) {
    try {
      commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch {
      commit = 'local';
    }
  }
  return {
    enabled:
      choose('TELEMETRY_ENABLED', environment === 'local' ? 'false' : base.TELEMETRY_ENABLED) ===
      'true',
    interactions: choose('TELEMETRY_INTERACTIONS', base.TELEMETRY_INTERACTIONS) !== 'false',
    environment,
    release: releaseId(commit),
    webAnalyticsToken: /^[a-f\d]{32}$/i.test(env.CF_WEB_ANALYTICS_TOKEN || '')
      ? env.CF_WEB_ANALYTICS_TOKEN
      : ''
  };
}
