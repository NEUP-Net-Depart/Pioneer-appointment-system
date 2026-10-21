import assert from 'node:assert/strict';
import { manifests, validateManifests } from '../src/modules/registry.js';
import { readFile, readdir } from 'node:fs/promises';
import { migrationFingerprint } from './migration-fingerprint.mjs';

const result = validateManifests(manifests);
assert.equal(result.valid, true, result.errors.join('; '));
const contract = JSON.parse(await readFile(new URL('../docs/contracts/staff-platform.json', import.meta.url), 'utf8'));
assert.equal(contract.schemaVersion, '0022');
assert.ok(manifests.every(item => item.requiredSchemaVersion));
const baseline = JSON.parse(await readFile(new URL('../docs/contracts/baseline-manifest.json', import.meta.url), 'utf8'));
assert.equal(baseline.branch, 'dev');
assert.equal(baseline.schemaVersion, contract.schemaVersion);
assert.deepEqual(baseline.modules.map(item => item.code).sort(), result.summary.map(item => item.code).sort());
const directory = 'migrations', migrations = baseline.migrations;
assert.ok(migrations?.length, 'The deployment migration history must be recorded');
for (const migration of migrations) {
  const content = await readFile(new URL(`../${directory}/${migration.name}`, import.meta.url));
  assert.equal(migrationFingerprint(content), migration.sha256, `Migration hash drift: ${directory}/${migration.name}`);
}
const migrationNames = (await readdir(new URL(`../${directory}/`, import.meta.url))).filter(name => name.endsWith('.sql')).sort();
assert.deepEqual(migrations.map(item => item.name).sort(), migrationNames, `Baseline migration list is incomplete: ${directory}`);
for (const migration of baseline.staffMigrations || []) {
  const content = await readFile(new URL(`../database/staff-migrations/${migration.name}`, import.meta.url));
  assert.equal(migrationFingerprint(content),migration.sha256,`Staff migration hash drift: ${migration.name}`);
}
assert.deepEqual((baseline.staffMigrations || []).map(item=>item.name).sort(),
  (await readdir(new URL('../database/staff-migrations/',import.meta.url))).filter(name=>name.endsWith('.sql')).sort());
assert.equal(await readFile(new URL('../migrations/0033_staff_business_roles.sql',import.meta.url),'utf8'),
  await readFile(new URL('../database/staff-migrations/0033_staff_business_roles.sql',import.meta.url),'utf8'));
for (const module of result.summary) {
  const recorded = baseline.modules.find(item => item.code === module.code);
  assert.equal(recorded?.manifestHash, module.manifestHash, `Manifest hash drift: ${module.code}`);
  assert.equal(recorded?.releaseState, module.releaseState, `Manifest release state drift: ${module.code}`);
}
console.log(JSON.stringify({ contractVersion: contract.contractVersion, schemaVersion: contract.schemaVersion, modules: result.summary }, null, 2));
