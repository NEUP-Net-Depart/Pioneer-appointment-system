import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import assert from 'node:assert/strict';
import { root, wrangler } from './cli.mjs';

// Isolated workerd/D1 state; never touches the normal local or remote database.
const parent = resolve(root, '.wrangler');
await mkdir(parent, { recursive: true });
// Keep workerd's nested SQLite paths within Windows path limits.
const path = await mkdtemp(resolve(parent, 'db-'));

const inside = relative(parent, path);
if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('Unsafe verification directory');
try {
  for (const directory of ['migrations','database/staff-migrations']) {
  const config = resolve(path,directory==='migrations' ? 'main.json' : 'staff.json');
  await writeFile(config,JSON.stringify({name:'migration-verification',compatibility_date:'2026-09-01',d1_databases:[{
    binding:'DB',database_name:directory==='migrations' ? 'main-chain-verification' : 'staff-chain-verification',
    database_id:directory==='migrations' ? '11111111-1111-1111-1111-111111111111' : '22222222-2222-2222-2222-222222222222',
    migrations_dir:resolve(root,directory)
  }]}));
  const args = ['d1','migrations','apply','DB','--local','--persist-to',path,'--config',config];
  wrangler(args);
  wrangler(args); // The migration ledger must make the second application a no-op.
  const [schema, keys, capacities, weekday, release] = JSON.parse(wrangler(['d1','execute','DB','--local','--persist-to',path,'--config',config,'--json','--command',
    "SELECT name FROM sqlite_schema WHERE type IN ('table','trigger','index','view') ORDER BY name; PRAGMA foreign_key_check; SELECT campus,time_slot,capacity,revision FROM slot_capacities ORDER BY campus,time_slot; SELECT campus,weekday,time_slot,capacity,revision FROM weekday_slot_capacities ORDER BY campus,weekday,time_slot; SELECT id FROM staff_release_markers ORDER BY id;"], { capture: true }));
  assert.ok(schema.success && keys.success && capacities.success);
  assert.ok(release.results.some(row=>row.id==='repair-links-0046'), 'Direct repair migration did not complete');
  assert.deepEqual(keys.results, [], 'D1 foreign key violations');
  const names = new Set(schema.results.map(row => row.name));
  for (const name of ['staff_accounts','members','member_department_memberships','appointments',
    'appointment_attachments','attachment_storage','storage_quota','appointment_corrections',
    'repair_intake_records','audit_events','operation_receipts','attendance_records',
    'appointment_capacity_insert','appointment_capacity_update','idx_online_student_day',
    'booking_requests','booking_day_slots','weekday_slot_capacities','service_locations',
    'appointment_contact_index_pending','appointment_contact_index_tokens'])
    assert.ok(names.has(name), `Missing schema object: ${name}`);
  for (const name of ['repair_followups','active_repairs','repair_receptions','repair_queue_tickets','repair_queue_counters',
    'idx_one_pending_dispatch','reception_start_guard','field_presence_busy_guard',
    'idx_one_pending_onsite_registration','legacy_admin_logins','member_work_profiles'])
    assert.ok(!names.has(name), `Retired workflow remains: ${name}`);
  assert.equal(capacities.results.length, 4);
  assert.ok(capacities.results.every(row=>row.capacity===10 && row.revision===0));
  assert.equal(weekday.results.length, 32);
  assert.ok(weekday.results.every(row=>row.capacity===5 && row.revision===0));
  console.log(`D1 migrations verified for ${directory}: fresh state, re-application and foreign keys.`);
  }
} finally { await rm(path, { recursive: true, force: true }); }
