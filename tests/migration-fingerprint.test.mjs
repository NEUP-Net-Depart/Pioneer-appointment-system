import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { migrationFingerprint } from '../scripts/migration-fingerprint.mjs';

test('migration baseline accepts Windows checkout without accepting SQL changes', () => {
  const sql = 'CREATE TABLE example (id TEXT PRIMARY KEY);\n';
  const expected = createHash('sha256').update(sql).digest('hex');
  assert.equal(migrationFingerprint(Buffer.from(sql)), expected);
  assert.equal(migrationFingerprint(Buffer.from(sql.replaceAll('\n', '\r\n'))), expected);
  assert.notEqual(migrationFingerprint(Buffer.from(sql.replace('TEXT', 'INTEGER'))), expected);
});
