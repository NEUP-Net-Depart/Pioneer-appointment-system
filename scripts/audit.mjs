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
const runtime = (await Promise.all(['frontend','shared','src','functions'].map(walk))).flat().filter(path => /\.(?:[jt]sx?|html|css)$/.test(path) && !path.endsWith('.d.ts'));
const { dependencies = {} } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const forbidden = /node:sqlite|http\.createServer|fs\.writeFileSync|fs\.createReadStream|ATTACHMENTS_DIR|DB_FILE|storage_path|BEGIN IMMEDIATE|[?&]mode=(?:user|staff)|nginx|systemd|dotenv/i;
const graph = new Map();
for (const path of runtime) {
  const source = await readFile(join(root, path), 'utf8');
  assert.ok(!forbidden.test(source), `Retired architecture in ${path}`);
  if (!/\.[jt]sx?$/.test(path)) continue;
  const imports = [];
  for (const [, specifier] of source.matchAll(/(?:from\s+|import\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
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
    // These two public modules are generated from the declared zxing-wasm
    // dependency by build.mjs; all other lazy imports follow the source graph.
    if (['/vendor/zxing-reader.js', '/vendor/zxing-writer.js'].includes(specifier)) {
      assert.ok(path === join('shared', 'zxing.js') && Object.hasOwn(dependencies, 'zxing-wasm'), `Unsupported vendor import in ${path}`);
      import.meta.resolve('zxing-wasm');
      continue;
    }
    let dependency = resolve(root, specifier.startsWith('/') ? specifier.slice(1) : join(dirname(path), specifier));
    try { await access(dependency); } catch {
      let found = false;
      for (const extension of ['.ts','.tsx','.js','.jsx']) { try { await access(dependency + extension); dependency += extension; found = true; break; } catch { /* Try the next supported source suffix. */ } }
      assert.ok(found, `Unresolved import ${specifier} in ${path}`);
    }
    assert.ok(relative(root, dependency) && !relative(root, dependency).startsWith('..'), `Import escapes repository: ${path}`);
    imports.push(dependency);
  }
  graph.set(resolve(root, path), imports);
  if (path.startsWith('src') || path.startsWith('functions')) {
    assert.ok(!/process\.env|CREATE TABLE|ALTER TABLE|CREATE TRIGGER/i.test(source), `Runtime initialization or process state in ${path}`);
    assert.deepEqual(runtimeStateErrors(source, { typescript:path.endsWith('.ts') }), [], `Shared runtime state in ${path}`);
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
for (const entry of ['frontend/user/main.js','frontend/staff-react/main.jsx','functions/api/[[path]].js']) visit(resolve(root, entry));
const unreachable = [...graph.keys()].filter(path => !visited.has(path)).map(path => relative(root,path));
assert.equal(unreachable.length, 0, `Unreachable runtime modules: ${unreachable.join(', ')}`);
const { manifests, validateManifests } = await import('../src/modules/registry.js');
const manifestCheck = validateManifests(manifests);
assert.ok(manifestCheck.valid, `Invalid module manifest: ${manifestCheck.errors.join('; ')}`);
assert.ok(manifests.some(item => item.code === 'meetings' && item.releaseState === 'test'), 'Missing isolated meetings extension manifest');
for (const path of ['docs/architecture/module-map.md','docs/architecture/identity-mapping.md','docs/architecture/authorization.md','docs/architecture/attendance-policies.md','docs/contracts/staff-platform.json','docs/contracts/baseline-manifest.json']) {
  await access(join(root, path));
}
for (const path of ['README.md','docs/operations.md','docs/requirements.md','wrangler.jsonc','.dev.vars.example']) {
  assert.ok(!forbidden.test(await readFile(join(root, path), 'utf8')), `Retired configuration in ${path}`);
}
console.log(`Architecture audit passed: ${graph.size} reachable modules; SQL boundaries, runtime dependencies and retired paths checked.`);
