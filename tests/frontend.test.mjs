import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';

async function files(dir) {
  const result = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await files(path)); else result.push(path);
  }
  return result;
}
test('each HTML entry contains only its own features and valid assets with unique IDs', async () => {
  const user = await readFile('dist/index.html', 'utf8'), staff = await readFile('dist/staff/index.html', 'utf8');
  assert.ok(user.includes('id="booking-form"') && user.includes('id="lookup-form"'));
  assert.ok(!user.includes('id="login-view"') && !user.includes('id="staff-view"'));
  assert.ok(staff.includes('id="login-form"') && staff.includes('id="users-table"'));
  assert.ok(!staff.includes('id="booking-form"') && !staff.includes('id="lookup-form"'));
  for (const html of [user, staff]) {
    assert.ok(!/[?&]mode=/.test(html));
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size);
    for (const [, path] of html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)) {
      await access(join('dist', path.endsWith('/') ? path + 'index.html' : path));
    }
  }
});
test('all frontend module imports resolve; user graph cannot reach staff modules', async () => {
  const graph = new Map();
  for (const path of (await files('dist')).filter(path => path.endsWith('.js'))) {
    const source = await readFile(path, 'utf8');
    const imports = [...source.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)].map(([, specifier]) => resolve(specifier.startsWith('/') ? 'dist' + specifier : join(dirname(path), specifier)));
    for (const dependency of imports) await access(dependency);
    for (const [, names, specifier] of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) {
      const dependency = resolve(specifier.startsWith('/') ? 'dist' + specifier : join(dirname(path), specifier));
      const exports = new Set([...(await readFile(dependency, 'utf8')).matchAll(/export\s+(?:(?:async\s+)?function|const|let|class)\s+([\w$]+)/g)].map(match => match[1]));
      for (const name of names.split(',').map(name => name.trim().split(/\s+as\s+/)[0])) assert.ok(exports.has(name), `${path} imports missing ${name} from ${specifier}`);
    }
    graph.set(resolve(path), imports);
  }
  const visited = new Set();
  function walk(path) {
    if (visited.has(path)) return;
    visited.add(path); assert.ok(!path.includes(join('dist', 'staff')));
    for (const dependency of graph.get(path) || []) walk(dependency);
  }
  walk(resolve('dist/user/main.js'));
  assert.ok(visited.has(resolve('dist/shared/api.js')));
});
test('frontend DOM selectors resolve only against their own HTML entry', async () => {
  for (const area of ['user','staff']) {
    const html = await readFile(`frontend/${area}/index.html`, 'utf8');
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
    for (const file of (await files(`frontend/${area}`)).filter(file => file.endsWith('.js'))) {
      const source = await readFile(file, 'utf8');
      for (const [, id] of source.matchAll(/\$\(['"]#([\w-]+)['"]\)/g)) assert.ok(ids.has(id), `${file} depends on missing #${id}`);
    }
  }
});
test('public output excludes server source, secrets, old entrypoints and build tools', async () => {
  const output = (await files('dist')).map(path => path.replaceAll('\\','/'));
  assert.ok(!output.some(path => /(?:^|\/)(?:src|server|backend|functions|scripts|node_modules|\.dev\.vars)(?:\/|$)/.test(path)));
  for (const path of ['dist/user.html','dist/staff.html','dist/app.js']) assert.ok(!output.includes(path));
  const routes = JSON.parse(await readFile('dist/_routes.json', 'utf8'));
  assert.deepEqual(routes.include, ['/api','/api/*']);
  await access('dist/404.html');
});
test('shared requests isolate guest pages from staff JWT and clear revoked sessions', async () => {
  const oldFetch = globalThis.fetch;
  const values = new Map([['pioneerToken','staff-test-token'],['pioneerAccount','123456'],['pioneerRole','technician']]);
  const events = [];
  globalThis.sessionStorage = { getItem: key => values.get(key), removeItem: key => values.delete(key) };
  globalThis.window = { dispatchEvent: event => events.push(event.type) };
  const captured = [];
  globalThis.fetch = async (_url, options) => { captured.push(options.headers.get('Authorization')); return new Response('{}', { status: captured.length === 3 ? 401 : 200 }); };
  try {
    const { apiFetch, useStaffSession } = await import('../shared/api.js');
    await apiFetch('/api/appointments'); assert.equal(captured[0], null);
    useStaffSession(); await apiFetch('/api/auth/me'); assert.equal(captured[1], 'Bearer staff-test-token');
    await apiFetch('/api/auth/me'); assert.equal(values.size, 0); assert.deepEqual(events, ['auth-expired']);
  } finally { globalThis.fetch = oldFetch; delete globalThis.sessionStorage; delete globalThis.window; }
});

test('visible polling pauses in background, refreshes on return and disposes cleanly', async () => {
  const saved = Object.fromEntries(['document','window','setInterval','clearInterval'].map(key => [key, globalThis[key]]));
  const listeners = new Map(), windowListeners = new Map(), timers = new Map();
  let nextTimer = 0, calls = 0;
  globalThis.document = { hidden: false, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) };
  globalThis.window = { addEventListener: (name, callback) => windowListeners.set(name, callback), removeEventListener: name => windowListeners.delete(name) };
  globalThis.setInterval = (callback, interval) => { assert.equal(interval, 30000); timers.set(++nextTimer, callback); return nextTimer; };
  globalThis.clearInterval = id => timers.delete(id);
  try {
    const { startVisiblePolling } = await import('../shared/polling.js');
    let dispose = startVisiblePolling(() => { calls++; });
    await Promise.resolve();
    assert.equal(calls, 1); assert.equal(timers.size, 1);
    const oldTick = [...timers.values()][0]; oldTick(); await Promise.resolve();
    assert.equal(calls, 2);
    globalThis.document.hidden = true; listeners.get('visibilitychange')();
    assert.equal(timers.size, 0); oldTick(); await Promise.resolve(); assert.equal(calls, 2);
    globalThis.document.hidden = false; listeners.get('visibilitychange')(); await Promise.resolve();
    assert.equal(calls, 3); assert.equal(timers.size, 1);
    dispose(); assert.equal(timers.size, 0); assert.equal(listeners.size, 0); assert.equal(windowListeners.size, 0);
    // Lookup replaces its previous subscription on each render.
    for (let n = 0; n < 3; n++) { dispose = startVisiblePolling(() => { calls++; }); await Promise.resolve(); dispose(); }
    assert.equal(timers.size, 0); assert.equal(listeners.size, 0);
    globalThis.document.hidden = true; dispose = startVisiblePolling(() => { calls++; });
    assert.equal(timers.size, 0); assert.equal(calls, 6); dispose();
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
});
