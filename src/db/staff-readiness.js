export const STAFF_RELEASE = 'maintenance-affairs-0051';

// Prepare real projections, including empty tables. A database with only the
// old staff schema must fail readiness before CI accepts a deployment.
export async function verifyStaffSchema(db) {
  const projections = {
    staff_accounts: 'member_id,auth_version,token_version',
    appointments: 'parent_appointment_id,link_kind,access_token_hash,front_photo_id,back_photo_id,booking_notices,received_at,received_by,photo_deferred_by',
    members: 'id,status,college,major',
    member_department_memberships: 'member_id,position_code',
    staff_access_campuses: 'account,campus',
    member_roles: 'member_id,role_id,scope_bindings,reason',
    role_grants: 'permission_code,scope_spec,condition_spec',
    repair_intake_records: 'appointment_id,verification_json',
    operation_receipts: 'request_id,payload_hash,result_status',
    attendance_records: 'member_id,event_id',
    attendance_reviews: 'assignment_id,member_id,decision,revision,reviewed_by,reviewed_at',
    attendance_report_settings: 'id,count_mode,hours_per_count,merge_leaders,revision',
    roster_weeks: 'week_start,campus_id,revision',
    roster_leaves: 'assignment_id,member_id,withdrawn_at',
    roster_covers: 'assignment_id,from_member_id,to_member_id,status',
    member_availability: 'member_id,week_start,windows',
    duty_assignments: 'member_id,week_id,active',
    service_day_overrides: 'business_date,campus_id,paused',
    booking_settings: 'campus,release_time,revision',
    booking_notices: 'id,campus,revision,display_mode',
  };
  await db.batch(Object.entries(projections).map(([table, columns]) => db.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`)));
  const required = ['staff_account_member_sync', 'staff_account_member_insert_guard', 'staff_account_member_update_guard', 'activation_admin_submit_guard', 'activation_approve',   'service_day_booking_insert', 'service_day_repair_start', 'appointment_booking_notices', 'repair_link_insert','repair_link_update'];
  const result = await db.prepare(`SELECT name FROM sqlite_schema WHERE type='trigger' AND name IN (${required.map(() => '?').join(',')})`).bind(...required).all();
  if (result.results.length !== required.length) throw new Error('Staff workflow database guards are missing');
  const indexes = await db.prepare("PRAGMA index_list('staff_accounts')").all();
  if (!indexes.results.some(index => index.name === 'idx_staff_accounts_member_id' && index.unique === 1 && index.partial === 0))
    throw new Error('Staff member login uniqueness is missing');
  const loginKey = await db.prepare("PRAGMA index_info('idx_staff_accounts_member_id')").all();
  if (loginKey.results.length !== 1 || loginKey.results[0].name !== 'member_id')
    throw new Error('Staff member login uniqueness targets the wrong column');
  const retired = await db.prepare("SELECT name FROM sqlite_schema WHERE name IN ('legacy_admin_logins','legacy_admin_login_changed','member_work_profiles','repair_followups','repair_receptions','active_repairs','repair_queue_tickets','repair_queue_counters','duty_roles','availability','roster_availability_preferences','roster_preference_history','roster_collection_series','roster_staffing_requirements','roster_publication_overrides','roster_command_receipts','roster_command_guards','roster_tasks','roster_versions','roster_submissions','leave_requests','swap_requests') UNION ALL SELECT code AS name FROM roles WHERE code='legacy_admin'").all();
  if (retired.results.length) throw new Error('Retired workflow schema is still present');
  const transitional = await db.prepare("SELECT name FROM pragma_table_info('member_roles') WHERE name IN ('needs_review','participation_spec','source') UNION ALL SELECT name FROM pragma_table_info('member_department_memberships') WHERE name='needs_review'").all();
  if (transitional.results.length) throw new Error('Organization authorization cutover is incomplete');
  const retiredColumns = await db.prepare("SELECT name FROM pragma_table_info('appointments') WHERE name='registration_flow'").all();
  if (retiredColumns.results.length) throw new Error('Retired registration split is still present');
  const marker = await db.prepare('SELECT id FROM staff_release_markers WHERE id=?').bind(STAFF_RELEASE).first();
  if (!marker) throw new Error('Staff cutover migration is incomplete');
  return STAFF_RELEASE;
}
