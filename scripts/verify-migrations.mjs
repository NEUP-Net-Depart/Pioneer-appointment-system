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
 for (const config of ['wrangler.jsonc', 'wrangler.staff-staging.jsonc']) {
  const args = ['d1','migrations','apply','DB','--local','--persist-to',path,'--config',config];
  wrangler(args);
  wrangler(args); // The migration ledger must make the second application a no-op.
  const [schema, keys, capacities, weekday] = JSON.parse(wrangler(['d1','execute','DB','--local','--persist-to',path,'--config',config,'--json','--command',
    "SELECT name FROM sqlite_schema WHERE type IN ('table','trigger','index') ORDER BY name; PRAGMA foreign_key_check; SELECT campus,time_slot,capacity,revision FROM slot_capacities ORDER BY campus,time_slot; SELECT campus,weekday,time_slot,capacity,revision FROM weekday_slot_capacities ORDER BY campus,weekday,time_slot;"], { capture: true }));
  assert.ok(schema.success && keys.success && capacities.success);
  assert.deepEqual(keys.results, [], 'D1 foreign key violations');
  const names = new Set(schema.results.map(row => row.name));
  for (const name of ['staff_accounts','staff_campus_grants','staff_whitelist','whitelist_campus_grants','activation_requests','credential_recoveries','appointments','appointment_attachments','rate_limits','storage_quota','attachment_storage','attachment_storage_reserve','attachment_storage_release','idx_attachment_expiry','idx_storage_expiry','idx_storage_pending','appointment_capacity_insert','appointment_capacity_update','idx_online_student_day','appointment_student_day_insert','appointment_student_day_update','service_locations','service_location_changes','booking_requests','appointment_location_insert','appointment_new_slot_deadline','idx_pending_student_photos','idx_active_queue']) assert.ok(names.has(name), `Missing D1 schema object: ${name}`);
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
  console.log(`D1 migrations verified for ${config}: fresh state, re-application and foreign keys.`);
 }
} finally { await rm(path, { recursive: true, force: true }); }
