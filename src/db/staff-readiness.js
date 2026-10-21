export const STAFF_RELEASE = 'booking-settings-0035';

// Prepare real projections, including empty tables. A database with only the
// old staff schema must fail readiness before CI accepts a deployment.
export async function verifyStaffSchema(db) {
  const projections = {
    staff_accounts: 'member_id,auth_version,token_version',
    appointments: 'registration_flow,access_token_hash,front_photo_id,back_photo_id,booking_notices',
    members: 'id,status',
    member_work_profiles: 'member_id,profile_code',
    member_roles: 'member_id,role_id,scope_bindings',
    role_grants: 'permission_code,scope_spec,condition_spec',
    repair_intake_records: 'appointment_id,verification_json',
    operation_receipts: 'request_id,payload_hash,result_status',
    attendance_records: 'member_id,event_id',
    roster_collection_series: 'id',
    roster_submissions: 'member_id',
    duty_assignments: 'member_id,origin_assignment_id',
    service_day_overrides: 'business_date,campus_id,paused',
    booking_settings: 'campus,release_time,revision',
    booking_notices: 'id,campus,revision,display_mode',
  };
  await db.batch(Object.entries(projections).map(([table, columns]) => db.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`)));
  const required = ['staff_account_member_sync', 'staff_account_member_insert_guard', 'staff_account_member_update_guard', 'activation_admin_submit_guard', 'activation_approve', 'active_repair_member_sync', 'field_presence_busy_guard', 'service_day_booking_insert', 'service_day_repair_start', 'appointment_booking_notices'];
  const result = await db.prepare(`SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN (${required.map(() => '?').join(',')})`).bind(...required).all();
  if (result.results.length !== required.length) throw new Error('Staff workflow database guards are missing');
  const indexes = await db.prepare("PRAGMA index_list('staff_accounts')").all();
  if (!indexes.results.some(index => index.name === 'idx_staff_accounts_member_id' && index.unique === 1 && index.partial === 0))
    throw new Error('Staff member login uniqueness is missing');
  const loginKey = await db.prepare("PRAGMA index_info('idx_staff_accounts_member_id')").all();
  if (loginKey.results.length !== 1 || loginKey.results[0].name !== 'member_id')
    throw new Error('Staff member login uniqueness targets the wrong column');
  const retired = await db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('legacy_admin_logins','legacy_admin_login_changed') UNION ALL SELECT code AS name FROM roles WHERE code='legacy_admin'").all();
  if (retired.results.length) throw new Error('Retired administrator authorization is still present');
  const marker = await db.prepare('SELECT id FROM staff_release_markers WHERE id=?').bind(STAFF_RELEASE).first();
  if (!marker) throw new Error('Staff cutover migration is incomplete');
  return STAFF_RELEASE;
}
