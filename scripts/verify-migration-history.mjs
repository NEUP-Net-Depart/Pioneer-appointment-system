import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { migrationFingerprint } from './migration-fingerprint.mjs';

// SQL already applied to a database is immutable. New migrations add a new entry.
const root = new URL('../', import.meta.url);
const history = JSON.parse(await readFile(new URL('database/migration-checksums.json', root), 'utf8'));
for (const directory of ['migrations', 'database/staff-migrations']) {
  const recorded = history[directory];
  const names = (await readdir(new URL(directory + '/', root))).filter(name => name.endsWith('.sql')).sort();
  assert.deepEqual(Object.keys(recorded).sort(), names, `Incomplete migration history: ${directory}`);
  for (const name of names) {
    const bytes = await readFile(new URL(`${directory}/${name}`, root));
    assert.equal(migrationFingerprint(bytes), recorded[name], `Changed migration: ${directory}/${name}`);
  }
}
console.log('Both migration histories match their recorded SQL checksums.');
