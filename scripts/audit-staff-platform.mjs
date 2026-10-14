import assert from 'node:assert/strict';
import { manifests, validateManifests } from '../src/modules/registry.js';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const result = validateManifests(manifests);
assert.equal(result.valid, true, result.errors.join('; '));
const contract = JSON.parse(await readFile(new URL('../docs/contracts/staff-platform.json', import.meta.url), 'utf8'));
assert.equal(contract.schemaVersion, '0007');
assert.ok(manifests.every(item => item.requiredSchemaVersion));
const baseline = JSON.parse(await readFile(new URL('../docs/releases/baseline-manifest.json', import.meta.url), 'utf8'));
assert.equal(baseline.branch, 'next/staff-platform');
assert.equal(baseline.schemaVersion, contract.schemaVersion);
assert.deepEqual(baseline.modules.map(item => item.code).sort(), result.summary.map(item => item.code).sort());
for (const migration of baseline.migrations || []) {
  const content = await readFile(new URL(`../migrations/${migration.name}`, import.meta.url));
  assert.equal(createHash('sha256').update(content).digest('hex'), migration.sha256, `Migration hash drift: ${migration.name}`);
}
for (const module of result.summary) {
  const recorded = baseline.modules.find(item => item.code === module.code);
  assert.equal(recorded?.manifestHash, module.manifestHash, `Manifest hash drift: ${module.code}`);
  assert.equal(recorded?.releaseState, module.releaseState, `Manifest release state drift: ${module.code}`);
}
const migrationNames = (await readdir(new URL('../migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
assert.deepEqual((baseline.migrations || []).map(item => item.name).sort(), migrationNames, 'Baseline migration list is incomplete');
console.log(JSON.stringify({ contractVersion: contract.contractVersion, schemaVersion: contract.schemaVersion, modules: result.summary }, null, 2));
