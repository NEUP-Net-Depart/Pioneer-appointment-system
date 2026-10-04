import assert from 'node:assert/strict';
const base = process.argv[2] || 'http://127.0.0.1:8788';
const seen = new Set();
async function get(path, status = 200) {
  const response = await fetch(new URL(path, base));
  assert.equal(response.status, status, `${path}: HTTP ${response.status}`);
  return response;
}
async function asset(path) {
  if (seen.has(path)) return;
  seen.add(path);
  const response = await get(path);
  if (path.endsWith('.js')) {
    assert.ok(response.headers.get('content-type')?.includes('javascript'), `${path} is not JavaScript`);
    for (const [, dependency] of (await response.text()).matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
      await asset(new URL(dependency, new URL(path, base)).pathname);
    }
  }
}
for (const entry of ['/','/staff/']) {
  const response = await get(entry), html = await response.text();
  assert.ok(response.headers.get('content-type')?.includes('text/html'));
  assert.ok(html.includes(entry === '/' ? 'id="booking-form"' : 'id="login-form"'));
  for (const [, path] of html.matchAll(/(?:src|href)="(\/[^"?#]+\.(?:js|css|jpg))"/g)) await asset(path);
}
for (const path of ['/user.html','/staff.html','/app.js','/src/app.js','/.dev.vars','/wrangler.jsonc']) await get(path, 404);
assert.equal((await (await get('/api/health')).json()).ok, true);
assert.ok((await (await get('/api/unknown', 404)).json()).error);
console.log(`HTTP smoke passed: both entries, ${seen.size} assets/modules, health, JSON errors and retired/private paths.`);
