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

test('PostHog preserves event order and each request ID across asynchronous initialization', async () => {
  const calls = [];
  let complete;
  const sdk = {
    init(token, options) {
      options.loaded(this);
    },
    register(properties) {
      calls.push(['register', properties]);
    },
    capture(name, properties) {
      calls.push([name, properties]);
    }
  };
  const client = createTelemetryClient({
    config: { enabled: true, environment: 'production', posthog: { token: 'test' } },
    loadSDK: () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  });
  client.page('student.booking');
  client.track('flow.result', { requestId: id, result: 'ok' });
  client.track('flow.result', { requestId: '22345678-1234-4234-8234-123456789abc', result: 'ok' });
  client.page('student.lookup');
  await Promise.resolve();
  complete(sdk);
  await client.ready;
  assert.deepEqual(
    calls.filter(([name]) => name === 'app.view').map(([, p]) => p.view),
    ['student.booking', 'student.lookup']
  );
  assert.deepEqual(
    calls.filter(([name]) => name === 'flow.result').map(([, p]) => p.requestId),
    [id, '22345678-1234-4234-8234-123456789abc']
  );
  for (let i = 0; i < 150; i++) client.track('flow.step', { result: 'ok' });
  assert.equal(calls.filter(([name]) => name === 'flow.step').length, 150);
  client.dispose();
});

test('PostHog deduplicates exceptions, excludes deliberate cancellations and resets staff identity', async () => {
  const calls = [];
  const sdk = Object.fromEntries(
    ['init', 'register', 'capture', 'captureException', 'identify', 'reset'].map((name) => [
      name,
      (...args) => calls.push([name, ...args])
    ])
  );
  const client = createTelemetryClient({
    config: { enabled: true, posthog: { token: 'test' } },
    loadSDK: async () => sdk
  });
  await client.ready;
  const failure = new TypeError('useful debugging message');
  client.report(failure, 'NETWORK_ERROR', { requestId: id });
  client.report(failure);
  client.report(new Error('same request reported by a boundary'), 'HTTP_ERROR', { requestId: id });
  const cancelled = new DOMException('cancelled', 'AbortError');
  client.cancel(cancelled, {});
  client.report(cancelled, 'UNHANDLED_REJECTION');
  const errors = calls.filter(([name]) => name === 'captureException');
  assert.equal(errors.length, 1);
  assert.equal(errors[0][1], failure);
  assert.equal(errors[0][2].requestId, id);
  assert.ok(
    calls.some(
      ([name, event, p]) =>
        name === 'capture' && event === 'flow.result' && p.result === 'cancelled'
    )
  );
  client.identify({ memberId: 'one', role: 'staff' });
  client.reset();
  client.identify({ memberId: 'two', role: 'admin' });
  assert.deepEqual(
    calls.filter(([name]) => ['identify', 'reset'].includes(name)).map((call) => call.slice(0, 2)),
    [
      ['identify', 'staff:one'],
      ['reset', true],
      ['identify', 'staff:two']
    ]
  );
  client.dispose();
});

test('disabled or failing PostHog cannot affect business code or load another collector', async () => {
  let loads = 0;
  const disabled = createTelemetryClient({
    config: { enabled: false, posthog: { token: 'test' } },
    loadSDK: async () => {
      loads++;
    }
  });
  disabled.track('flow.step');
  disabled.report(new Error('ignored'));
  await disabled.ready;
  assert.equal(loads, 0);
  for (const loadSDK of [
    async () => {
      throw new Error('blocked SDK');
    },
    async () => ({
      init() {},
      capture() {
        throw new Error('SDK failure');
      },
      captureException() {
        throw new Error('report failure');
      }
    })
  ]) {
    const client = createTelemetryClient({
      config: { enabled: true, posthog: { token: 'test' } },
      loadSDK
    });
    client.page('student.booking');
    await client.ready;
    assert.doesNotThrow(() => {
      client.track('flow.result', { result: 'ok' });
      client.report(new Error('test'));
    });
    client.dispose();
  }
  disabled.dispose();
});

test('build configuration isolates environments, rejects invalid destinations and never exposes upload secrets', async () => {
  const cfg = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  for (const [environment, expected] of [
    ['local', false],
    ['preview', false],
    ['production', true]
  ]) {
    const config = telemetryBuildConfig({
      TELEMETRY_ENVIRONMENT: environment,
      TELEMETRY_RELEASE: 'abcdef12',
      POSTHOG_PROJECT_TOKEN: 'phc_test',
      POSTHOG_PERSONAL_API_KEY: 'private-upload-secret'
    });
    assert.equal(config.enabled, expected);
    assert.equal(config.posthog.replaySampleRate, 1);
    assert.ok(!JSON.stringify(config).includes('private-upload-secret'));
  }
  assert.equal(telemetryBuildConfig({ TELEMETRY_ENVIRONMENT: 'production' }).enabled, false);
  for (const env of [
    { POSTHOG_ENABLED: 'true' },
    { POSTHOG_REPLAY_SAMPLE_RATE: 'NaN' },
    { POSTHOG_REPLAY_SAMPLE_RATE: '1.1' },
    { POSTHOG_HOST: 'https://bad.test; script-src *' }
  ])
    assert.throws(() => telemetryBuildConfig(env));
  assert.notEqual(
    cfg.analytics_engine_datasets[0].dataset,
    cfg.env.preview.analytics_engine_datasets[0].dataset
  );
  const { posthogHeaders } = await import('../scripts/telemetry-build.mjs');
  const { staffWarrantyHeaders } = await import('../scripts/warranty-deploy.mjs');
  const headers = staffWarrantyHeaders(
    await readFile('public/_headers', 'utf8'),
    'https://verify.test'
  );
  const config = telemetryBuildConfig({
    TELEMETRY_ENVIRONMENT: 'production',
    POSTHOG_PROJECT_TOKEN: 'phc_test',
    POSTHOG_HOST: 'https://eu.i.posthog.com'
  });
  const policies = [
    ...posthogHeaders(headers, config).matchAll(/Content-Security-Policy: ([^\n]+)/g)
  ].map((match) => match[1]);
  assert.equal(policies.length, 2);
  for (const policy of policies) {
    assert.match(policy, /script-src [^;]*https:\/\/eu-assets.i.posthog.com/);
    assert.match(policy, /connect-src [^;]*https:\/\/eu.i.posthog.com/);
    assert.match(policy, /worker-src 'self' blob:/);
    assert.equal((policy.match(/worker-src /g) || []).length, 1);
    assert.ok(!policy.includes('us.i.posthog.com'));
  }
  assert.match(policies[1], /frame-src https:\/\/verify.test/);
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

test('source maps never remain deployable when upload is skipped or misconfigured', async () => {
  const { mkdtemp, mkdir, writeFile, readdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { finishSourceMaps } = await import('../scripts/posthog-sourcemaps.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'pioneer-symbols-'));
  try {
    await mkdir(join(directory, 'assets'));
    for (const enabled of [false, true]) {
      await writeFile(
        join(directory, 'assets/app.js'),
        'window.example = true;\n//# sourceMappingURL=app.js.map\n//# chunkId=preserved\n'
      );
      await writeFile(join(directory, 'assets/app.js.map'), '{}');
      const finish = finishSourceMaps(directory, { enabled }, { POSTHOG_PROJECT_ID: '123' });
      if (enabled) await assert.rejects(finish, /requires both/);
      else await finish;
      assert.deepEqual(await readdir(join(directory, 'assets')), ['app.js']);
      const source = await readFile(join(directory, 'assets/app.js'), 'utf8');
      assert.ok(!source.includes('sourceMappingURL'));
      assert.ok(source.includes('chunkId=preserved'));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
