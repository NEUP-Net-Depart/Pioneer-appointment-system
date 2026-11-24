import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';

const dist = new URL('../../../dist/', import.meta.url);
const read = (path) => readFile(new URL(path, dist), 'utf8');
const exists = (path) =>
  stat(new URL(path, dist)).then(
    (item) => item.isFile(),
    () => false
  );
const refs = (html) =>
  [...html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)]
    .map((match) => match[1].slice(1))
    .filter(Boolean);

test('Vite emits independent Pages entries with shared assets and staff-only runtime resources', async () => {
  const [manifest, student, staff, headers, routes] = await Promise.all([
    read('.vite/manifest.json').then(JSON.parse),
    read('index.html'),
    read('staff/index.html'),
    read('_headers'),
    read('_routes.json').then(JSON.parse)
  ]);
  assert.deepEqual(
    Object.entries(manifest)
      .filter(([, entry]) => entry.isEntry)
      .map(([name]) => name)
      .sort(),
    ['index.html', 'staff/index.html']
  );
  const studentRefs = refs(student),
    staffRefs = refs(staff);
  assert.ok(studentRefs.includes(manifest['index.html'].file));
  assert.ok(staffRefs.includes(manifest['staff/index.html'].file));
  assert.ok(!studentRefs.includes(manifest['staff/index.html'].file));
  assert.ok(!staffRefs.includes(manifest['index.html'].file));
  const studentCss = studentRefs.find((path) => /^app-assets\/student-.*\.css$/.test(path));
  assert.ok(studentCss);
  assert.equal(
    await read(studentCss),
    await readFile(new URL('../../../frontend/user/student.css', import.meta.url), 'utf8')
  );
  assert.ok(!staffRefs.includes(studentCss));
  const staffOnly = ['staff/pwa/manifest.webmanifest', 'staff/pwa/apple-touch-icon.png'];
  for (const asset of staffOnly) {
    assert.ok(staffRefs.includes(asset));
    assert.ok(!studentRefs.includes(asset));
  }
  assert.ok(staffRefs.some((path) => path.startsWith('staff/pluginWebUpdateNotice/')));
  assert.ok(!studentRefs.some((path) => path.includes('pluginWebUpdateNotice')));
  for (const asset of new Set([...studentRefs, ...staffRefs]))
    assert.ok(await exists(asset), asset);
  for (const asset of [
    'assets/posthog.js',
    'shared/styles.css',
    'vendor/signature-pad.js',
    'vendor/zxing_writer.wasm',
    'vendor/zxing_reader.wasm',
    'vendor/ocr/worker.min.js',
    'vendor/ocr/lang/eng.traineddata.gz',
    'staff/pluginWebUpdateNotice/web_version_by_plugin.json'
  ])
    assert.ok(await exists(asset), asset);
  assert.equal(await exists('user/main.js'), false);
  const files = await readdir(dist, { recursive: true, withFileTypes: true });
  for (const file of files)
    assert.ok(!file.name.endsWith('.map'), join(file.parentPath, file.name));
  assert.deepEqual(routes.include, ['/api', '/api/*']);
  assert.match(
    headers,
    /\/app-assets\/\*\s+! Cache-Control\s+Cache-Control: public, max-age=31536000, immutable/
  );
  const [studentHeaders, staffHeaders] = headers.split('/staff/*');
  assert.match(studentHeaders, /Permissions-Policy: camera=\(\)/);
  assert.match(staffHeaders, /Permissions-Policy: camera=\(self\)/);
  assert.match(staffHeaders, /worker-src 'self'/);
});
