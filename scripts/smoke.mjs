import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { STAFF_RELEASE } from '../src/db/staff-readiness.js';

export async function smoke(base, fetcher = fetch, output = new URL('../dist/', import.meta.url)) {
  const seen = new Set();
  async function get(path, status = 200) {
    const response = await fetcher(new URL(path, base), { signal: AbortSignal.timeout(20000), redirect: 'error' });
    assert.equal(response.status, status, path + ': HTTP ' + response.status);
    return response;
  }
  async function asset(path) {
    if (seen.has(path)) return;
    seen.add(path);
    const response = await get(path), bytes = Buffer.from(await response.arrayBuffer());
    const type = response.headers.get('content-type') || '';
    if (/\.m?js$/.test(path)) assert.match(type, /javascript/, path + ' must be JavaScript');
    if (/\.css$/.test(path)) assert.match(type, /text\/css/, path + ' must be CSS');
    assert.doesNotMatch(bytes.toString('utf8', 0, 100), /<!doctype html/i, path + ' returned an HTML fallback');
    if (path.startsWith('/staff/assets/')) {
      const local = await readFile(new URL('.' + path, output));
      const hash = value => createHash('sha256').update(value).digest('hex');
      assert.equal(hash(bytes), hash(local), path + ' differs from this release build');
    }
  }
  for (const entry of ['/', '/staff/']) {
    const response = await get(entry), html = await response.text();
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    assert.ok(html.includes(entry === '/' ? 'id="booking-form"' : 'id="staff-react-root"'));
    if (entry === '/staff/') {
      assert.doesNotMatch(html, /id="(?:app-shell|staff-view|users-table|login-form)"/);
      const local = await readFile(new URL('staff/index.html', output), 'utf8');
      const modules = value => [...value.matchAll(/src="(\/staff\/assets\/[^"?]+\.js)"/g)].map(match => match[1]);
      assert.ok(modules(html).length, 'React entry module is missing');
      assert.deepEqual(modules(html), modules(local), 'Deployed React entry does not match this build');
    }
    for (const [, path] of html.matchAll(/(?:src|href)="(\/[^"?#]+\.(?:m?js|css|jpg))"/g)) await asset(path);
  }
  for (const path of ['/user.html', '/staff.html', '/app.js', '/src/app.js', '/.dev.vars', '/wrangler.jsonc', '/staff/main.js', '/staff/auth.js', '/staff/scan.js']) await get(path, 404);
  const health = await (await get('/api/health')).json();
  assert.equal(health.ok, true); assert.equal(health.staffRelease, STAFF_RELEASE); assert.equal(health.workflow, 'staff-platform');
  assert.deepEqual(await (await get('/api/scan/config')).json(), { enabled: true });
  for (const path of ['/api/field/home', '/api/field/board', '/api/roster-tasks', '/api/me/attendance', '/api/members']) {
    const response = await get(path, 401);
    assert.match(response.headers.get('content-type') || '', /application\/json/);
    assert.equal(typeof (await response.json()).error, 'string', path + ' must enforce authentication');
  }
  assert.ok((await (await get('/api/unknown', 404)).json()).error);
  return { assets: seen.size, staffRelease: health.staffRelease };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await smoke(process.argv[2] || 'http://127.0.0.1:8788');
  console.log('Smoke passed: React entry and build bytes, ' + result.assets + ' assets, staff schema/guards, workflow API authentication and private paths.');
}
