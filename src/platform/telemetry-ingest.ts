import type { TelemetryEnvironment } from './environment.ts';
import type { TelemetryEvent } from '../../shared/telemetry.ts';
import { cleanEvent, isErrorEvent, rate } from '../../shared/telemetry.ts';
import { readBody, json, securityHeaders } from '../lib/http.ts';
import { emitEvent, telemetrySettings } from './observability.ts';

export function createTelemetryLimiter({ maxKeys = 2048, clock = Date.now } = {}) {
  const buckets = new Map<string, { minute: number; ordinary: number; errors: number }>();
  return (key: string, error: boolean) => {
    const minute = Math.floor(clock() / 60000);
    let bucket = buckets.get(key);
    if (!bucket || bucket.minute !== minute) {
      buckets.delete(key);
      if (buckets.size >= maxKeys) {
        const first = buckets.keys().next();
        if (!first.done) buckets.delete(first.value);
      }
      bucket = { minute, ordinary: 0, errors: 0 };
      buckets.set(key, bucket);
    }
    if (error && bucket.errors < 2) {
      bucket.errors++;
      return true;
    }
    if (bucket.ordinary >= 6) return false;
    bucket.ordinary++;
    return true;
  };
}
// Explicit bounded, ephemeral factory; not distributed quota accounting.
const acceptBatch = createTelemetryLimiter();
export async function ingestTelemetry(request: Request, env: TelemetryEnvironment, { accept = acceptBatch } = {}) {
  const empty = () => new Response(null, { status: 204, headers: securityHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (
    request.headers.get('origin') !== new URL(request.url).origin ||
    ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') || '')
  )
    return json({ error: 'Forbidden' }, 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
    return json({ error: 'JSON required' }, 415);
  if (!telemetrySettings(env).enabled) return empty();
  const body = await readBody(request, 16 * 1024);
  if (
    body.version !== 1 ||
    !Array.isArray(body.events) ||
    body.events.length < 1 ||
    body.events.length > 20
  )
    return json({ error: 'Invalid telemetry batch' }, 400);
  const events = body.events.map(cleanEvent);
  const validEvents = events.filter((event): event is TelemetryEvent => event !== null && event.name !== 'api.request');
  if (validEvents.length !== events.length)
    return json({ error: 'Invalid telemetry event' }, 400);
  const errorsOnly = validEvents.every(isErrorEvent);
  if (!accept(request.headers.get('CF-Connecting-IP') || 'unknown', errorsOnly)) return empty();
  const sample = rate(env.TELEMETRY_SAMPLE_RATE);
  for (const event of validEvents) {
    if (env.TELEMETRY_INTERACTIONS === 'false' && event.name.startsWith('ui.')) continue;
    const error = isErrorEvent(event);
    if (!error && (!sample || Math.random() >= sample)) continue;
    event.sampleWeight = error ? 1 : 1 / sample;
    emitEvent(env, event);
  }
  return empty();
}
