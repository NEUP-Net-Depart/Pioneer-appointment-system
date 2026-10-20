export const STAFF_RELEASE = 'staff-react-0031';

// Prepare real projections, including empty tables. A database with only the
// old staff schema must fail readiness before CI accepts a deployment.
export async function verifyStaffSchema(db) {
  const projections = {
    staff_accounts: 'member_id,auth_version,token_version',
    appointments: 'registration_flow,access_token_hash,front_photo_id,back_photo_id',
    members: 'id,status',
    member_work_profiles: 'member_id,profile_code',
    member_roles: 'member_id,role_id,scope_bindings',
    legacy_admin_logins: 'account,member_id,campus_ids',
    role_grants: 'permission_code,scope_spec,condition_spec',
    repair_intake_records: 'appointment_id,verification_json',
    operation_receipts: 'request_id,payload_hash,result_status',
    attendance_records: 'member_id,event_id',
    roster_collection_series: 'id',
    roster_submissions: 'member_id',
    duty_assignments: 'member_id,origin_assignment_id',
    service_day_overrides: 'business_date,campus_id,paused',
  };
  await db.batch(Object.entries(projections).map(([table, columns]) => db.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`)));
  const required = ['staff_account_member_sync', 'legacy_admin_login_changed', 'activation_admin_submit_guard', 'activation_approve', 'active_repair_member_sync', 'field_presence_busy_guard', 'service_day_booking_insert', 'service_day_repair_start'];
  const result = await db.prepare(`SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN (${required.map(() => '?').join(',')})`).bind(...required).all();
  if (result.results.length !== required.length) throw new Error('Staff workflow database guards are missing');
  const marker = await db.prepare('SELECT id FROM staff_release_markers WHERE id=?').bind(STAFF_RELEASE).first();
  if (!marker) throw new Error('Staff cutover migration is incomplete');
  return STAFF_RELEASE;
}
