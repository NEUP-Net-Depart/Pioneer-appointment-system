import assert from 'node:assert/strict';
import { readdir, readFile, access } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { root } from './cli.mjs';
import { runtimeStateErrors } from './runtime-state-audit.mjs';

async function walk(dir) {
  const paths = [];
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...await walk(path)); else paths.push(path);
  }
  return paths;
}
const runtime = (await Promise.all(['frontend','shared','src','functions'].map(walk))).flat().filter(path => /\.(?:jsx?|html|css)$/.test(path));
const { dependencies = {} } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const forbidden = /node:sqlite|http\.createServer|fs\.writeFileSync|fs\.createReadStream|ATTACHMENTS_DIR|DB_FILE|storage_path|BEGIN IMMEDIATE|[?&]mode=(?:user|staff)|nginx|systemd|dotenv/i;
const graph = new Map();
for (const path of runtime) {
  const source = await readFile(join(root, path), 'utf8');
  assert.ok(!forbidden.test(source), `Retired architecture in ${path}`);
  if (!/\.jsx?$/.test(path)) continue;
  const imports = [];
  for (const [, specifier] of source.matchAll(/(?:from\s+|import\s+)['"]([^'"]+)['"]/g)) {
    if (specifier.startsWith('node:')) {
      assert.ok(['node:crypto', 'node:buffer'].includes(specifier) && path.startsWith(join('src', 'lib')), `Unsupported runtime dependency in ${path}`);
      continue;
    }
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
      const packageName = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
      assert.ok(path.startsWith(join('frontend', 'staff-react')) && Object.hasOwn(dependencies, packageName), `Unsupported package dependency ${specifier} in ${path}`);
      import.meta.resolve(specifier);
      continue;
    }
    const dependency = resolve(root, specifier.startsWith('/') ? specifier.slice(1) : join(dirname(path), specifier));
    await access(dependency);
    assert.ok(relative(root, dependency) && !relative(root, dependency).startsWith('..'), `Import escapes repository: ${path}`);
    imports.push(dependency);
  }
  graph.set(resolve(root, path), imports);
  if (path.startsWith('src') || path.startsWith('functions')) {
    assert.ok(!/process\.env|CREATE TABLE|ALTER TABLE|CREATE TRIGGER/i.test(source), `Runtime initialization or process state in ${path}`);
    assert.deepEqual(runtimeStateErrors(source), [], `Shared runtime state in ${path}`);
    if (!path.startsWith(join('src', 'db'))) assert.ok(!/\.prepare\(|\.batch\(|SELECT\s+.+\s+FROM\s|INSERT INTO\s/i.test(source), `D1 SQL outside repositories in ${path}`);
  }
  if (path.startsWith(join('src', 'routes'))) assert.ok(!/from ['"].*\/db\//.test(source), `Route bypasses services in ${path}`);
}
const visited = new Set();
function visit(path) {
  if (visited.has(path)) return;
  visited.add(path);
  for (const dependency of graph.get(path) || []) visit(dependency);
}
for (const entry of ['frontend/user/main.js','frontend/staff/main.js','frontend/staff-react/main.jsx','functions/api/[[path]].js']) visit(resolve(root, entry));
for (const path of graph.keys()) assert.ok(visited.has(path), `Unreachable runtime module: ${relative(root, path)}`);
const { manifests, validateManifests } = await import('../src/modules/registry.js');
const manifestCheck = validateManifests(manifests);
assert.ok(manifestCheck.valid, `Invalid module manifest: ${manifestCheck.errors.join('; ')}`);
assert.ok(manifests.some(item => item.code === 'meetings' && item.releaseState === 'test'), 'Missing isolated meetings extension manifest');
for (const path of ['docs/architecture/module-map.md','docs/architecture/identity-mapping.md','docs/architecture/authorization.md','docs/architecture/attendance-policies.md','docs/contracts/staff-platform.json','docs/releases/baseline-manifest.json']) {
  await access(join(root, path));
}
for (const path of ['README.md','docs/operations.md','docs/requirements.md','wrangler.jsonc','.dev.vars.example']) {
  assert.ok(!forbidden.test(await readFile(join(root, path), 'utf8')), `Retired configuration in ${path}`);
}
console.log(`Architecture audit passed: ${graph.size} reachable modules; SQL boundaries, runtime dependencies and retired paths checked.`);
