import { cleanEvent, isErrorEvent, rate } from '../../shared/telemetry.js';
import { readBody, json, securityHeaders } from '../lib/http.js';
import { emitEvent, telemetrySettings } from './observability.js';

export function createTelemetryLimiter({ maxKeys = 2048, clock = Date.now } = {}) {
  const buckets = new Map();
  return (key, error) => {
    const minute = Math.floor(clock() / 60000);
    let bucket = buckets.get(key);
    if (!bucket || bucket.minute !== minute) {
      buckets.delete(key);
      if (buckets.size >= maxKeys) buckets.delete(buckets.keys().next().value);
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
export async function ingestTelemetry(request, env, { accept = acceptBatch } = {}) {
  const empty = () => new Response(null, { status: 204, headers: securityHeaders });
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (
    request.headers.get('origin') !== new URL(request.url).origin ||
    ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site'))
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
  if (events.some((event) => !event || event.name === 'api.request'))
    return json({ error: 'Invalid telemetry event' }, 400);
  const errorsOnly = events.every(isErrorEvent);
  if (!accept(request.headers.get('CF-Connecting-IP') || 'unknown', errorsOnly)) return empty();
  const sample = rate(env.TELEMETRY_SAMPLE_RATE);
  for (const event of events) {
    if (env.TELEMETRY_INTERACTIONS === 'false' && event.name.startsWith('ui.')) continue;
    const error = isErrorEvent(event);
    if (!error && (!sample || Math.random() >= sample)) continue;
    event.sampleWeight = error ? 1 : 1 / sample;
    emitEvent(env, event);
  }
  return empty();
}
