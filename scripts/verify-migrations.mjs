import { mkdir, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { root, wrangler } from './cli.mjs';

// Isolated workerd/D1 state; never touches the normal local or remote database.
const parent = resolve(root, '.wrangler');
const path = resolve(parent, `migration-check-${randomUUID()}`);
const inside = relative(parent, path);
if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Unsafe verification directory');
await mkdir(path, { recursive: true });
try {
  const args = ['d1','migrations','apply','DB','--local','--persist-to',path];
  wrangler(args);
  wrangler(args); // The migration ledger must make the second application a no-op.
  const [schema, keys] = JSON.parse(wrangler(['d1','execute','DB','--local','--persist-to',path,'--json','--command',
    "SELECT name FROM sqlite_schema WHERE type IN ('table','trigger','index') ORDER BY name; PRAGMA foreign_key_check;"], { capture: true }));
  assert.ok(schema.success && keys.success);
  assert.deepEqual(keys.results, [], 'D1 foreign key violations');
  const names = new Set(schema.results.map(row => row.name));
  for (const name of ['users','appointments','appointment_attachments','rate_limits','storage_quota','attachment_storage','attachment_storage_reserve','attachment_storage_release','idx_attachment_expiry','idx_storage_expiry','idx_storage_pending','appointment_capacity_insert','appointment_capacity_update','idx_active_student_slot','idx_active_queue']) assert.ok(names.has(name), `Missing D1 schema object: ${name}`);
  assert.ok(!names.has('idx_appointments_queue'), 'Superseded queue index still exists');
  console.log('All D1 migrations applied to fresh state; re-application and foreign keys verified.');
} finally { await rm(path, { recursive: true, force: true }); }
