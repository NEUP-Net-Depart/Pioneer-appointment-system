import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { migrationFingerprint } from '../scripts/migration-fingerprint.mjs';

test('both migration chains preserve the deployed Staff baseline and original dev migrations', async () => {
  const staff = await readFile('database/staff-migrations/0007_staff_platform.sql');
  assert.equal(migrationFingerprint(staff), '2914ae0739b6496591af1f2f95aeaf83ff3daa694cc97502f001825c505c1cdd');
  const manifest = JSON.parse(await readFile('docs/releases/baseline-manifest.json', 'utf8'));
  for (const item of manifest.migrations.filter(item => item.name < '0007')) {
    assert.equal(migrationFingerprint(await readFile(`database/staff-migrations/${item.name}`)), item.sha256);
  }
  const dev = JSON.parse(await readFile('tests/fixtures/dev-migrations/manifest.json', 'utf8'));
  for (const item of dev.migrations) assert.equal(migrationFingerprint(await readFile(`migrations/${item.name}`)), item.sha256);
  assert.equal(migrationFingerprint(await readFile('migrations/0010_staff_platform.sql')), migrationFingerprint(await readFile('database/upgrades/dev-0009-to-staff-platform.sql')));
  assert.equal(migrationFingerprint(await readFile('database/staff-migrations/0008_five_statuses.sql')), migrationFingerprint(await readFile('database/upgrades/staff-0007-to-five-statuses.sql')));
});
