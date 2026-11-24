import type { R2Bucket } from '@cloudflare/workers-types';
import type { TelemetryEnvironment } from './environment.ts';
import type { TelemetryMetrics } from '../../shared/telemetry.ts';
import { isObject } from '../../shared/api-types.ts';

type Dependency = 'd1' | 'r2' | 'upstream';
export type Observation = ReturnType<typeof createObservation>;

import {
  cleanEvent,
  dataPoint,
  errorFields,
  rate,
  releaseId,
  routeFor,
  uuid
} from '../../shared/telemetry.ts';

export function requestTrace(request: Pick<Request, 'headers'>) {
  return uuid(request.headers.get('x-request-id')) || crypto.randomUUID();
}
export function telemetrySettings(env: TelemetryEnvironment) {
  return {
    enabled: env.TELEMETRY_ENABLED === 'true',
    logs: env.OBSERVABILITY_LOGS === 'true',
    environment: env.TELEMETRY_ENVIRONMENT === 'production' || env.TELEMETRY_ENVIRONMENT === 'preview'
      ? env.TELEMETRY_ENVIRONMENT
      : 'local',
    release: releaseId(env.TELEMETRY_RELEASE),
    sampleRate: rate(env.TELEMETRY_SAMPLE_RATE),
    pollRate: rate(env.TELEMETRY_POLL_SAMPLE_RATE, 0.01)
  };
}
export function emitEvent(env: TelemetryEnvironment, event: unknown, context: { method?: string } = {}, metrics: TelemetryMetrics = {}) {
  try {
    const settings = telemetrySettings(env);
    if (!settings.enabled) return;
    const safe = cleanEvent(event);
    if (!safe) return;
    const point = dataPoint(safe, { ...settings, ...context }, metrics);
    if (settings.logs) {
      const record = {
        schema: '1',
        ...safe,
        environment: settings.environment,
        release: settings.release,
        ...metrics
      };
      if (safe.result === 'error') console.error(record);
      else console.log(record);
    }
    // Synchronous binding: Cloudflare schedules writes without waitUntil/await.
    env.ANALYTICS?.writeDataPoint(point);
  } catch {
    /* Telemetry never replaces a business response or error. */
  }
}
export function createObservation(request: Request, env: TelemetryEnvironment, { clock = Date.now, random = Math.random } = {}) {
  const started = clock(),
    requestId = requestTrace(request),
    metrics: TelemetryMetrics = {};
  let recorded = false;
  const observation = {
    requestId,
    metrics,
    enabled: env.TELEMETRY_ENABLED === 'true',
    failure(code: string) {
      if (
        ['ATTACHMENT_COMPENSATION', 'D1_FAILURE', 'R2_FAILURE', 'UPSTREAM_FAILURE'].includes(code)
      )
        metrics.failure = code;
    },
    dependency(kind: Dependency, duration: number, failed: boolean, results?: unknown) {
      if (!['d1', 'r2', 'upstream'].includes(kind)) return;
      metrics[`${kind}Calls`] = (metrics[`${kind}Calls`] || 0) + 1;
      metrics[`${kind}Ms`] = (metrics[`${kind}Ms`] || 0) + Math.max(0, duration);
      if (failed) {
        metrics[`${kind}Failures`] = (metrics[`${kind}Failures`] || 0) + 1;
        observation.failure(`${kind.toUpperCase()}_FAILURE`);
      }
      if (kind === 'd1')
        for (const result of Array.isArray(results) ? results : [results]) {
          if (
            !isObject(result) || !isObject(result.meta) ||
            typeof result.meta.rows_read !== 'number' || !Number.isFinite(result.meta.rows_read) ||
            typeof result.meta.rows_written !== 'number' || !Number.isFinite(result.meta.rows_written)
          )
            continue;
          metrics.metaCalls = (metrics.metaCalls || 0) + 1;
          metrics.rowsRead = (metrics.rowsRead || 0) + result.meta.rows_read;
          metrics.rowsWritten = (metrics.rowsWritten || 0) + result.meta.rows_written;
        }
    },
    finish(response: Response, error?: unknown) {
      if (recorded) return response;
      recorded = true;
      const headers = new Headers(response.headers);
      headers.set('X-Request-ID', requestId);
      const result = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers
      });
      try {
        if (!observation.enabled) return result;
        const path = new URL(request.url).pathname;
        if (path === '/api/health' || path === '/api/telemetry') return result;
        const settings = telemetrySettings(env);
        const failed = response.status >= 500 || !!metrics.failure;
        const sample =
          failed || response.status >= 400
            ? 1
            : request.headers.get('X-Telemetry-Poll') === '1' && request.method === 'GET'
              ? settings.pollRate
              : settings.sampleRate;
        if (!sample || random() >= sample) return result;
        emitEvent(
          env,
          {
            name: 'api.request',
            route: routeFor(request, request.method),
            result:
              response.status >= 500
                ? 'error'
                : response.status >= 400
                  ? 'rejected'
                  : metrics.failure
                    ? 'error'
                    : 'ok',
            status: response.status,
            count: 1,
            durationMs: Math.max(0, clock() - started),
            sampleWeight: 1 / sample,
            at: started,
            ...(error ? errorFields(error) : {}),
            errorCode: errorFields(error).errorCode || metrics.failure,
            requestId
          },
          { method: request.method },
          metrics
        );
      } catch {
        /* Preserve the response and its stream. */
      }
      return result;
    }
  };
  return observation;
}
export function observedOperation<T>(observation: Pick<Observation, 'dependency'> | undefined, kind: Dependency, operation: () => T | PromiseLike<T>, { responseFailure = false } = {}) {
  const started = Date.now();
  return Promise.resolve()
    .then(operation)
    .then(
      (result) => {
        try {
          observation?.dependency(
            kind,
            Date.now() - started,
            responseFailure && !(isObject(result) && result.ok),
            result
          );
        } catch {
          /* Observation is optional. */
        }
        return result;
      },
      (error) => {
        try {
          observation?.dependency(kind, Date.now() - started, true);
        } catch {
          /* Preserve the original failure. */
        }
        throw error;
      }
    );
}
export function observedBucket<T extends Pick<R2Bucket, 'get' | 'put' | 'delete'>>(bucket: T, observation: Observation) {
  return new Proxy(bucket, {
    get(target, key) {
      const value: unknown = Reflect.get(target, key);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => observedOperation(observation, 'r2', () => value.apply(target, args));
    }
  });
}
