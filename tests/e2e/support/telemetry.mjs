import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { expect } from './fixtures.mjs';
import { posthogHeaders } from '../../../scripts/telemetry-build.mjs';

// Run the shipped SDK and recorder. Only the external service is replaced;
// no test analytics leave this browser context.
export async function collectTelemetry(page) {
  // Present a normal visitor to the SDK; keep production bot filtering enabled.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
  });
  const events = [];
  const config = {
    enabled: true,
    interactions: true,
    environment: 'preview',
    release: 'abcdef12',
    posthog: {
      token: 'phc_e2e',
      host: 'https://us.i.posthog.com',
      replay: true,
      replaySampleRate: 1
    }
  };
  const remote = {
    supportedCompression: [],
    hasFeatureFlags: false,
    autocapture_opt_out: false,
    sessionRecording: { endpoint: '/s/', sampleRate: 1, minimumDurationMilliseconds: 0 },
    capturePerformance: true,
    heatmaps: true
  };
  await page.route('**/telemetry-config.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.pioneerTelemetry=${JSON.stringify(config)};`
    })
  );
  // Exercise the generated production CSP even though ordinary E2E builds disable analytics.
  await page.route(
    (url) => url.pathname === '/' || url.pathname === '/staff/',
    async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const response = await route.fetch();
      const template = await readFile('dist/_headers', 'utf8');
      const block = route.request().url().includes('/staff/')
        ? template.split('/staff/*')[1]
        : template;
      const policy = block.match(/Content-Security-Policy: ([^\n]+)/)[1];
      const enabled = posthogHeaders(`Content-Security-Policy: ${policy}`, config)
        .split(': ')
        .slice(1)
        .join(': ');
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'Content-Security-Policy': enabled }
      });
    }
  );
  await page.route(/^https:\/\/(?:us|eu)(?:-assets)?\.i\.posthog\.com\//, async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname.endsWith('/config.js'))
      return route.fulfill({
        contentType: 'application/javascript',
        body: `window._POSTHOG_REMOTE_CONFIG={phc_e2e:{config:${JSON.stringify(remote)}}};`,
        headers
      });
    if (url.pathname.endsWith('/config')) return route.fulfill({ json: remote, headers });
    if (url.pathname.startsWith('/static/'))
      return route.fulfill({
        contentType: 'application/javascript',
        body: await readFile(`node_modules/posthog-js/dist/${basename(url.pathname)}`, 'utf8'),
        headers
      });
    if (url.pathname.startsWith('/flags'))
      return route.fulfill({ json: { featureFlags: {}, featureFlagPayloads: {} }, headers });
    const body = request.postDataBuffer();
    if (body?.length) {
      const text =
        body[0] === 0x1f && body[1] === 0x8b
          ? gunzipSync(body).toString()
          : body.toString();
      const data = text.startsWith('data=')
        ? Buffer.from(new URLSearchParams(text).get('data'), 'base64').toString()
        : text;
      const parsed = JSON.parse(data);
      for (const event of parsed.batch || (Array.isArray(parsed) ? parsed : [parsed]))
        events.push({ ...event.properties, name: event.event, event });
    }
    return route.fulfill({ json: { status: 1 }, headers });
  });
  await page.route('**/api/telemetry', () => {
    throw new Error('New clients must not duplicate frontend events into Cloudflare');
  });
  return () => events;
}

export async function readyTelemetry(page) {
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await import('/assets/posthog.js')).default.sessionRecordingStarted()
      )
    )
    .toBe(true);
}
export async function sendPending(context) {
  await context.clock.fastForward(6000);
}
