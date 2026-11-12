import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanEvent, dataPoint, routeFor, safeFrames } from '../shared/telemetry.js';
import { CONTROL_IDS, ROUTE_DEFINITIONS } from '../shared/telemetry-catalog.js';
import { createObservation, observedOperation } from '../src/platform/observability.js';
import { observedDatabase } from '../src/db/observed.js';
import { createTelemetryLimiter, ingestTelemetry } from '../src/platform/telemetry-ingest.js';
import { handleRequest } from '../src/app.js';
import { createTelemetryClient } from '../shared/telemetry-client.js';
import { telemetryBuildConfig } from '../scripts/telemetry-build.mjs';
import { readFile } from 'node:fs/promises';
import { jsxControls } from '../scripts/telemetry-jsx.mjs';
import { componentControlIds, controlPart } from '../shared/telemetry-controls.js';

const id = '12345678-1234-4234-8234-123456789abc';
const event = (fields = {}) => ({
  name: 'ui.click',
  control: CONTROL_IDS[0],
  view: 'student.booking',
  ...fields
});
const env = (points = []) => ({
  TELEMETRY_ENABLED: 'true',
  TELEMETRY_ENVIRONMENT: 'production',
  ANALYTICS: {
    writeDataPoint(point) {
      points.push(point);
    }
  }
});
const request = (body, headers = {}) =>
  new Request('https://app.test/api/telemetry', {
    method: 'POST',
    headers: { Origin: 'https://app.test', 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });

test('coverage sees shared JSX controls and ARIA controls after callback expressions', () => {
  const controls = jsxControls(`const controls = <>
    <Select onChange={(event) => update(event.target.value)} data-track="staff.test.select" />
    <DateTimePicker />
    <div onKeyDown={(event) => move(event)} role="spinbutton" />
    <HelpHint label="帮助" />
    <div role="tooltip" data-track={controlPart(trackId, 'panel')} />
  </>`);
  assert.deepEqual(
    controls.map((control) => control.tag),
    ['Select', 'DateTimePicker', 'div', 'HelpHint', 'div']
  );
  assert.equal(controls[0].id, 'staff.test.select');
  assert.equal(controls[1].id, '');
  assert.equal(controls[2].attributes.role.value, 'spinbutton');
  assert.equal(controls[4].expression, "controlPart(trackId, 'panel')");
});

test('nested control parts are allowlisted without admitting input-derived identities', () => {
  const base = 'staff.bookingsettingseditor.input.12';
  for (const id of componentControlIds('DateTimePicker', base))
    assert.ok(CONTROL_IDS.includes(id), id);
  assert.equal(controlPart(base, 'date'), `${base}.date`);
  assert.equal(controlPart(`${base}.time`, 'adjust'), `${base}.time.adjust`);
  assert.equal(controlPart(base, 'private@example.com'), '');
  assert.equal(controlPart('SECRET-TOKEN', 'panel'), '');
});

function browser(options = {}) {
  let now = Date.UTC(2026, 10, 12),
    value;
  const sent = [],
    storage = {
      getItem: () => value || null,
      setItem: (key, item) => {
        value = item;
      }
    };
  const client = createTelemetryClient({
    config: { enabled: true },
    clock: () => now,
    storage,
    fetcher: (url, options) => {
      sent.push({ url, options, body: JSON.parse(options.body) });
      return Promise.resolve({ ok: true });
    },
    ...options
  });
  return {
    client,
    sent,
    next: (ms = 30000) => {
      now += ms;
    },
    storage
  };
}

test('telemetry only contains registered dimensions and code locations', () => {
  const privateValue = '张三 2026123456 private@example.com secret-access-token SN123456';
  const clean = cleanEvent(
    event({
      value: privateValue,
      href: `https://app.test/#access=${privateValue}`,
      route: privateValue,
      requestId: privateValue,
      errorName: privateValue,
      errorCode: privateValue,
      frames: `${privateValue}\n at src/app.js:12:3\n at uploads/${privateValue}.js:1:1`,
      release: privateValue
    })
  );
  assert.ok(!JSON.stringify(clean).includes(privateValue));
  assert.equal(clean.route, 'unknown');
  assert.equal(clean.frames, 'src/app.js:12:3');
  assert.equal(cleanEvent(event({ control: privateValue })), null);
  assert.equal(
    safeFrames(
      `Error: ${privateValue}\n at https://app.test/user/main.js?access=${privateValue}:1:1`
    ),
    ''
  );
  assert.equal(
    routeFor('https://app.test/api/appointments/private-id?access=secret'),
    ROUTE_DEFINITIONS.find(
      (r) => r.method === 'GET' && new RegExp(r.pattern).test('/api/appointments/private-id')
    ).id
  );
  const point = dataPoint(clean, { environment: 'production', release: 'abcdef12' });
  assert.ok(
    point.blobs.length <= 20 && point.doubles.length <= 20 && point.indexes[0].length <= 96
  );
});

test('collector has no D1/R2 dependency, bounds payloads and rejects cross-origin traffic', async () => {
  const points = [],
    runtime = env(points);
  Object.defineProperties(runtime, {
    DB: {
      get() {
        throw new Error('D1 must not be accessed');
      }
    },
    ATTACHMENTS: {
      get() {
        throw new Error('R2 must not be accessed');
      }
    }
  });
  const response = await handleRequest(
    request({ version: 1, events: [event({ requestId: id })] }),
    runtime
  );
  assert.equal(response.status, 204);
  assert.match(response.headers.get('x-request-id'), /^[a-f\d-]{36}$/);
  assert.equal(points.length, 1);
  assert.equal(points[0].blobs[6], id);
  assert.equal(
    (
      await ingestTelemetry(
        request({ version: 1, events: [event()] }, { Origin: 'https://evil.test' }),
        runtime
      )
    ).status,
    403
  );
  assert.equal(
    (await ingestTelemetry(request({ version: 1, events: Array(21).fill(event()) }), runtime))
      .status,
    400
  );
  assert.equal(
    (await ingestTelemetry(request({ version: 1, events: [{ name: 'api.request' }] }), runtime))
      .status,
    400
  );
  assert.equal((await handleRequest(request({ padding: 'x'.repeat(17000) }), runtime)).status, 413);
  assert.equal(
    (
      await handleRequest(
        request({ version: 1, events: [event()] }, { 'Content-Type': 'text/plain' }),
        runtime
      )
    ).status,
    415
  );
});

test('limiter reserves two error batches and resets, while its key set stays bounded', () => {
  let now = 0;
  const accept = createTelemetryLimiter({ clock: () => now, maxKeys: 2 });
  for (let i = 0; i < 6; i++) assert.equal(accept('one', false), true);
  assert.equal(accept('one', false), false);
  assert.equal(accept('one', true), true);
  assert.equal(accept('one', true), true);
  assert.equal(accept('one', true), false);
  now = 60000;
  assert.equal(accept('one', false), true);
  assert.equal(accept('two', false), true);
  assert.equal(accept('three', false), true);
  assert.equal(accept('one', false), true);
});

test('disabled, missing and throwing analytics bindings preserve application responses', async () => {
  for (const runtime of [
    {},
    { TELEMETRY_ENABLED: 'true' },
    {
      TELEMETRY_ENABLED: 'true',
      ANALYTICS: {
        writeDataPoint() {
          throw new Error('quota exceeded');
        }
      }
    }
  ]) {
    const response = await handleRequest(request({ version: 1, events: [event()] }), runtime);
    assert.equal(response.status, 204);
    const failure = await handleRequest(new Request('https://app.test/api/auth/me'), runtime);
    assert.equal(failure.status, 500);
    assert.equal((await failure.json()).requestId, failure.headers.get('x-request-id'));
  }
});

test('requests produce one summary, retain errors despite sampling, and preserve response streams', async () => {
  const points = [],
    runtime = { ...env(points), TELEMETRY_POLL_SAMPLE_RATE: '0.01' };
  const req = new Request('https://app.test/api/appointments/private-id', {
    headers: { 'X-Request-ID': id, 'X-Telemetry-Poll': '1' }
  });
  const skipped = createObservation(req, runtime, { random: () => 0.5 });
  const original = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('download'));
        controller.close();
      }
    }),
    { headers: { 'Content-Type': 'image/jpeg' } }
  );
  const wrapped = skipped.finish(original);
  assert.equal(wrapped.headers.get('Content-Type'), 'image/jpeg');
  assert.equal(wrapped.headers.get('X-Request-ID'), id);
  assert.equal(await wrapped.text(), 'download');
  assert.equal(points.length, 0);
  const failed = createObservation(req, runtime, { random: () => 0.5 });
  failed.dependency('r2', 12, true);
  failed.finish(new Response(null, { status: 503 }), new Error('secret detail'));
  assert.equal(points.length, 1);
  assert.equal(points[0].doubles[3], 1);
  assert.equal(points[0].doubles[12], 1);
  assert.ok(!JSON.stringify(points).includes('private-id'));
  assert.ok(!JSON.stringify(points).includes('secret detail'));
  createObservation(new Request('https://app.test/api/health'), runtime).finish(new Response('ok'));
  assert.equal(points.length, 1);
});

test('D1 instrumentation uses the same statements, batch and session without extra I/O', async () => {
  const calls = [],
    points = [],
    observation = createObservation(new Request('https://app.test/api/auth/me'), env(points));
  const native = {
    prepare(sql) {
      calls.push(['prepare', sql]);
      return {
        bind(...values) {
          calls.push(['bind', values]);
          return this;
        },
        async first() {
          calls.push(['first']);
          return { value: 'private' };
        },
        async all() {
          calls.push(['all']);
          return { results: [], meta: { rows_read: 8, rows_written: 0 } };
        }
      };
    },
    async batch(statements) {
      assert.ok(statements.every((s) => typeof s.all === 'function'));
      calls.push(['batch']);
      return Promise.all(statements.map((s) => s.all()));
    },
    getBookmark() {
      return 'bookmark';
    }
  };
  const db = observedDatabase(native, observation);
  assert.deepEqual(await db.prepare('SQL secret').bind('private').first(), { value: 'private' });
  await db.batch([db.prepare('one').bind(1), db.prepare('two')]);
  assert.deepEqual(
    calls.map((c) => c[0]),
    ['prepare', 'bind', 'first', 'prepare', 'bind', 'prepare', 'batch', 'all', 'all']
  );
  assert.equal(db.getBookmark(), 'bookmark');
  assert.equal(observation.metrics.d1Calls, 2);
  assert.equal(observation.metrics.metaCalls, 2);
  assert.equal(observation.metrics.rowsRead, 16);
  observation.finish(new Response('{}'));
  assert.ok(!JSON.stringify(points).includes('private'));
});

test('browser aggregates duplicates, keeps first correlation ID, and does not retry failures', async () => {
  const { client, sent, next } = browser();
  client.page('student.booking');
  client.track('ui.click', { control: CONTROL_IDS[0], value: 'PRIVATE' });
  client.track('ui.click', { control: CONTROL_IDS[0], value: 'PRIVATE' });
  const error = new Error('PRIVATE');
  client.report(error, 'NETWORK_ERROR', { requestId: id });
  client.report(error, 'NETWORK_ERROR');
  assert.equal(client.snapshot().find((e) => e.name === 'ui.click').count, 2);
  assert.equal(client.snapshot().filter((e) => e.name === 'client.error').length, 1);
  client.flush();
  assert.equal(sent[0].body.events[0].requestId, id);
  assert.equal(sent[0].options.credentials, 'omit');
  client.flush();
  assert.equal(sent.length, 1);
  next();
  client.flush();
  assert.equal(sent.length, 2);
  assert.ok(!JSON.stringify(sent).includes('PRIVATE'));
  const failed = browser({ fetcher: () => Promise.reject(new Error('offline')) });
  failed.client.track('ui.click', { control: CONTROL_IDS[0] });
  failed.client.flush();
  await Promise.resolve();
  assert.equal(failed.client.snapshot().length, 0);
});

test('browser bounds groups and payloads and prioritizes errors', () => {
  const { client, sent } = browser();
  for (const control of CONTROL_IDS.slice(0, 110)) client.track('ui.click', { control });
  client.report(new Error('x'), 'NETWORK_ERROR');
  assert.equal(client.snapshot().length, 100);
  assert.ok(client.snapshot().some((is) => is.name === 'client.error'));
  client.flush();
  assert.ok(sent[0].body.events.every((e) => e.name === 'client.error'));
  assert.ok(Buffer.byteLength(sent[0].options.body) <= 16384);
});

test('browser daily budgets reserve errors and reset on UTC day change', () => {
  const { client, sent, next } = browser();
  for (let i = 0; i < 130; i++) {
    client.track('ui.click', { control: CONTROL_IDS[0] });
    client.flush();
    next();
  }
  assert.equal(sent.length, 120);
  for (let i = 0; i < 25; i++) {
    client.report(new Error('error'), 'NETWORK_ERROR');
    client.flush();
    next();
  }
  assert.equal(sent.length, 140);
  next(86400000);
  client.track('ui.click', { control: CONTROL_IDS[0] });
  client.flush();
  assert.equal(sent.length, 141);
});

test('disabled collection and interaction switch avoid emitting UI batches', () => {
  const disabled = browser({ config: { enabled: false } });
  disabled.client.report(new Error('error'));
  disabled.client.track('ui.click', { control: CONTROL_IDS[0] });
  disabled.client.flush();
  assert.equal(disabled.sent.length, 0);
  const errorsOnly = browser({ config: { enabled: true, interactions: false } });
  errorsOnly.client.track('ui.click', { control: CONTROL_IDS[0] });
  errorsOnly.client.report(new Error('error'));
  errorsOnly.client.flush();
  assert.equal(errorsOnly.sent[0].body.events.length, 1);
});

test('build config separates local, preview and production and only exposes public configuration', async () => {
  const cfg = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  for (const [environment, expected] of [
    ['local', false],
    ['preview', false],
    ['production', true]
  ]) {
    const config = telemetryBuildConfig(cfg, {
      TELEMETRY_ENVIRONMENT: environment,
      TELEMETRY_RELEASE: 'abcdef12',
      JWT_SECRET: 'private'
    });
    assert.equal(config.enabled, expected);
    assert.ok(!JSON.stringify(config).includes('private'));
  }
  assert.notEqual(
    cfg.analytics_engine_datasets[0].dataset,
    cfg.env.preview.analytics_engine_datasets[0].dataset
  );
});

test('analytics query CLI only sends one bounded SELECT and never exposes a write credential', async () => {
  const { telemetryQuery, queryTelemetry } = await import('../scripts/telemetry-query.mjs');
  for (const name of ['errors', 'latency', 'funnel', 'interactions', 'dependencies', 'volume']) {
    const sql = await telemetryQuery({ name, preview: true, hours: 12 });
    assert.match(sql, /^SELECT/);
    assert.ok(sql.includes('pioneer_telemetry_preview'));
    assert.ok(sql.includes("INTERVAL '12' HOUR"));
    assert.ok(!sql.includes('__'));
    assert.ok(!sql.includes(';'));
  }
  await assert.rejects(telemetryQuery({ name: 'DROP TABLE x' }));
  await assert.rejects(telemetryQuery({ hours: 0 }));
  let calls = 0;
  const result = await queryTelemetry(
    { name: 'volume' },
    {
      env: { CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32), CLOUDFLARE_ANALYTICS_API_TOKEN: 'read-only' },
      fetcher: async (url, init) => {
        calls++;
        assert.equal(init.headers.Authorization, 'Bearer read-only');
        assert.equal(init.redirect, 'error');
        return new Response(JSON.stringify({ data: [] }), { status: 200 });
      }
    }
  );
  assert.equal(calls, 1);
  assert.deepEqual(result, { data: [] });
});

test('observation failures cannot change dependency results or replace the original exception', async () => {
  const broken = {
    dependency() {
      throw new Error('observer failed');
    }
  };
  const value = { body: new ReadableStream() };
  assert.equal(await observedOperation(broken, 'r2', () => value), value);
  const failure = new Error('original');
  await assert.rejects(
    observedOperation(broken, 'd1', () => {
      throw failure;
    }),
    (error) => error === failure
  );
});

test('expected write conflicts remain rejected outcomes, not server failures', () => {
  const points = [],
    request = new Request('https://app.test/api/appointments/x/status', { method: 'PATCH' });
  const observation = createObservation(request, { ...env(points), TELEMETRY_SAMPLE_RATE: '0' });
  observation.dependency('d1', 1, true);
  observation.finish(new Response('{}', { status: 409 }), { code: 'REVISION_CONFLICT' });
  assert.equal(points.length, 1);
  assert.equal(points[0].blobs[5], 'rejected');
  assert.equal(points[0].blobs[8], 'REVISION_CONFLICT');
  assert.equal(points[0].doubles[3], 1);
});
