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
    "SELECT name FROM sqlite_schema WHERE type IN ('table','trigger','index') ORDER BY name; PRAGMA foreign_key_check; SELECT campus,time_slot,capacity,revision FROM slot_capacities ORDER BY campus,time_slot; SELECT campus,weekday,time_slot,capacity,revision FROM weekday_slot_capacities ORDER BY campus,weekday,time_slot; SELECT id FROM staff_release_markers ORDER BY id;"], { capture: true }));
  assert.ok(schema.success && keys.success && capacities.success);
  assert.deepEqual(release.results,[{id:'booking-settings-0035'},{id:'staff-business-0033'},{id:'staff-react-0030'},{id:'staff-react-0031'}], 'The cutover migration did not complete');
  assert.deepEqual(keys.results, [], 'D1 foreign key violations');
  const names = new Set(schema.results.map(row => row.name));
  for(const name of ['booking_settings','booking_notices','appointment_booking_notices'])assert.ok(names.has(name),`Missing booking configuration schema object: ${name}`);
  for(const name of ['roster_collection_series','roster_submissions','roster_preference_history','roster_preference_created','roster_preference_changed'])assert.ok(names.has(name),`Missing persistent collection schema object: ${name}`);
  for (const name of ['staff_accounts','staff_campus_grants','staff_whitelist','whitelist_campus_grants','activation_requests','credential_recoveries','appointments','appointment_attachments','rate_limits','storage_quota','attachment_storage','attachment_storage_reserve','attachment_storage_release','idx_attachment_expiry','idx_storage_expiry','idx_storage_pending','appointment_capacity_insert','appointment_capacity_update','idx_online_student_day','appointment_student_day_insert','appointment_student_day_update','service_locations','service_location_changes','booking_requests','appointment_location_insert','appointment_new_slot_deadline','idx_pending_student_photos','idx_active_queue']) assert.ok(names.has(name), `Missing D1 schema object: ${name}`);
  for(const name of ['legacy_admin_logins','legacy_admin_login_changed'])assert.ok(!names.has(name),`Retired authorization remains: ${name}`);
  assert.ok(names.has('activation_approve'),'Missing atomic activation approval trigger');
  assert.ok(names.has('idx_one_pending_activation') && names.has('idx_one_approved_activation'),'Missing activation uniqueness constraints');
  assert.ok(names.has('idx_repair_number'), 'Missing repair number uniqueness index');
  for (const name of ['active_repairs','appointment_active_insert','appointment_active_update','appointment_active_delete','idx_onsite_request','idx_one_pending_onsite_registration']) assert.ok(names.has(name), `Missing scan workbench constraint: ${name}`);
  for (const name of ['appointment_overlap_insert','appointment_overlap_update','idx_active_student_slot']) assert.ok(!names.has(name), `Retired same-slot rule still exists: ${name}`);
  assert.ok(names.has('idx_booked_expiry'),'Missing booked expiry index');
  assert.ok(names.has('appointment_corrections'), 'Missing five-state correction history');
  assert.ok(names.has('slot_capacities') && names.has('weekday_slot_capacities') && names.has('booking_day_slots'), 'Missing campus/slot capacity settings');
  for (const name of ['members','staff_account_member_sync','departments','campuses','locations','member_department_memberships','membership_primary_overlap_guard','membership_primary_update_guard','member_work_profiles','permission_definitions','roles','role_grants','member_roles','module_catalog','business_rule_versions','attendance_events','attendance_tokens','attendance_records','staff_presence','presence_events','roster_tasks','availability','roster_versions','duty_assignments','duty_roles','leave_requests','swap_requests','swap_accept_guard','audit_events','operation_receipts','repair_intake_records','idx_repair_intake_appointment','idx_staff_accounts_member_id','idx_active_repairs_member','active_repair_member_sync']) assert.ok(names.has(name), `Missing staff platform schema object: ${name}`);
  assert.equal(capacities.results.length, 4);
  assert.ok(capacities.results.every(row => row.capacity === 10 && row.revision === 0), 'Default capacity settings changed');
  assert.equal(weekday.results.length, 32, 'Expected four weekday half-hour templates per campus');
  assert.ok(weekday.results.every(row => row.capacity === 5 && row.revision === 0), 'Default half-hour capacity settings changed');
  assert.ok(!names.has('users') && !names.has('idx_appointments_queue') && !names.has('appointments_new') && !names.has('appointment_attachments_new') && !names.has('credential_recoveries_new'),'Retired or temporary schema still exists');
  console.log(`D1 migrations verified for ${directory}: fresh state, re-application and foreign keys.`);
  }
} finally { await rm(path, { recursive: true, force: true }); }
