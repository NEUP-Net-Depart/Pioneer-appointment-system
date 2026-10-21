import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { migrationFingerprint } from '../scripts/migration-fingerprint.mjs';

test('deployment migrations preserve original dev history and the platform upgrade fixture', async () => {
  const dev = JSON.parse(await readFile('tests/fixtures/dev-migrations/manifest.json', 'utf8'));
  for (const item of dev.migrations) assert.equal(migrationFingerprint(await readFile(`migrations/${item.name}`)), item.sha256);
  assert.equal(migrationFingerprint(await readFile('migrations/0010_staff_platform.sql')), migrationFingerprint(await readFile('database/upgrades/dev-0009-to-staff-platform.sql')));
});
