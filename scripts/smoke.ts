import { failureFrom, isObject } from '../shared/api-types.ts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { STAFF_RELEASE } from '../src/db/staff-readiness.ts';
import { setTimeout } from 'node:timers/promises';

const assetPaths = (html: string) => [...html.matchAll(/(?:src|href)="(\/(?!\/)[^"?#]+\.(?:m?js|css|jpg))"/g)].map(([, path]) => path);
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');

export async function smoke(base: string, fetcher = fetch, output = new URL('../dist/', import.meta.url)) {
  const seen = new Set();
  async function get(path: string, status = 200) {
    const response = await fetcher(new URL(path, base), { signal: AbortSignal.timeout(20000), redirect: 'error' });
    assert.equal(response.status, status, path + ': HTTP ' + response.status);
    return response;
  }
  async function asset(path: string) {
    if (seen.has(path)) return;
    seen.add(path);
    const response = await get(path), bytes = Buffer.from(await response.arrayBuffer());
    const type = response.headers.get('content-type') || '';
    if (/\.m?js$/.test(path)) assert.match(type, /javascript/, path + ' must be JavaScript');
    if (/\.css$/.test(path)) assert.match(type, /text\/css/, path + ' must be CSS');
    assert.doesNotMatch(bytes.toString('utf8', 0, 100), /<!doctype html/i, path + ' returned an HTML fallback');
    const local = await readFile(new URL('.' + path, output));
    assert.equal(hash(bytes), hash(local), path + ' differs from this release build');
  }
  for (const entry of ['/', '/staff/']) {
    const response = await get(entry), html = await response.text();
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    const local = await readFile(new URL(entry === '/' ? 'index.html' : 'staff/index.html', output), 'utf8');
    const expected = assetPaths(local);
    assert.ok(expected.some(path => /\.m?js$/.test(path)), entry + ' is missing script assets');
    const paths = assetPaths(html);
    assert.deepEqual(paths, expected, entry + ' does not reference the assets from this build');
    for (const path of paths) await asset(path);
  }
  await asset('/vendor/signature-pad.js');
  // Pages may retain removed static assets in CDN caches; check their absence in the build instead.
  for (const path of ['/user.html', '/staff.html', '/app.js', '/src/app.js', '/src/app.ts', '/.dev.vars', '/wrangler.jsonc']) await get(path, 404);
  const health: unknown = await (await get('/api/health')).json();
  assert.ok(isObject(health));
  assert.equal(health.ok, true); assert.equal(health.staffRelease, STAFF_RELEASE); assert.equal(health.workflow, 'staff-platform');
  for (const path of ['/api/field/home', '/api/field/board', '/api/rosters/week', '/api/me/attendance', '/api/members']) {
    const response = await get(path, 401);
    assert.match(response.headers.get('content-type') || '', /application\/json/);
    const body: unknown = await response.json();
    assert.ok(isObject(body));
    assert.equal(typeof body.error, 'string', path + ' must enforce authentication');
  }
  const missing: unknown = await (await get('/api/unknown', 404)).json();
  assert.ok(isObject(missing) && missing.error);
  return { assets: seen.size, staffRelease: health.staffRelease };
}
export async function waitForSmoke<T>(base: string, options: { verify: (base: string) => Promise<T>; pause?: (delay: number) => Promise<unknown>; attempts?: number; delayMs?: number }): Promise<T>;
export async function waitForSmoke(base: string, options?: { verify?: typeof smoke; pause?: (delay: number) => Promise<unknown>; attempts?: number; delayMs?: number }): Promise<Awaited<ReturnType<typeof smoke>>>;
export async function waitForSmoke(base: string, { verify = smoke, pause = setTimeout, attempts = 7, delayMs = 5000 }: { verify?: (base: string) => Promise<unknown>; pause?: (delay: number) => Promise<unknown>; attempts?: number; delayMs?: number } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await verify(base); }
    catch (error) {
      if (attempt === attempts) throw error;
      console.log(`Deployment verification ${attempt}/${attempts} failed: ${failureFrom(error).message}. Checking again in ${delayMs} ms.`);
      await pause(delayMs);
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await waitForSmoke(process.argv[2] || 'http://127.0.0.1:8788');
  console.log('Smoke passed: page entries, ' + result?.assets + ' release assets, staff schema/guards, workflow API authentication and private paths.');
}
