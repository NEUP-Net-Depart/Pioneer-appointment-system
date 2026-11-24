import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const dist = new URL('../../../dist/', import.meta.url);
const read = (path) => readFile(new URL(path, dist), 'utf8');
const refs = (html) =>
  [...html.matchAll(/(?:src|href)="(\/[^"?#]+)"/g)]
    .map((match) => match[1].slice(1))
    .filter(Boolean);

test('Vite keeps entry scripts, student styles and staff update notices scoped to their pages', async () => {
  const [manifest, student, staff] = await Promise.all([
    read('.vite/manifest.json').then(JSON.parse),
    read('index.html'),
    read('staff/index.html')
  ]);
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
  assert.ok(staffRefs.some((path) => path.startsWith('staff/pluginWebUpdateNotice/')));
  assert.ok(!studentRefs.some((path) => path.includes('pluginWebUpdateNotice')));
  assert.ok(JSON.parse(await read('staff/pluginWebUpdateNotice/web_version_by_plugin.json')).version);
});
