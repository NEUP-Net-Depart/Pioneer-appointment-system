-- Read-only schema and data checks; exclude private credentials and contact values.
SELECT COUNT(*) AS staff_accounts,
  COUNT(CASE WHEN protected=1 AND role='superadmin' AND status='enabled' THEN 1 END) AS enabled_protected_roots
  FROM staff_accounts;
SELECT account,group_concat(campus,' / ') AS authorized_campuses
  FROM staff_campus_grants GROUP BY account ORDER BY account;
SELECT COUNT(*) AS campus_grants FROM staff_campus_grants;
SELECT 'appointments' AS entity,COUNT(*) AS rows FROM appointments;
SELECT 'appointment_attachments' AS entity,COUNT(*) AS rows FROM appointment_attachments;
SELECT 'attachment_storage' AS entity,COUNT(*) AS rows FROM attachment_storage;
SELECT 'staff_whitelist' AS entity,COUNT(*) AS rows FROM staff_whitelist;
SELECT 'activation_requests' AS entity,COUNT(*) AS rows FROM activation_requests;
SELECT 'credential_recoveries' AS entity,COUNT(*) AS rows FROM credential_recoveries;
SELECT 'appointment_corrections' AS entity,COUNT(*) AS rows FROM appointment_corrections;
SELECT status,COUNT(*) AS rows FROM appointments GROUP BY status;
SELECT COUNT(*) AS invalid_results FROM appointments
  WHERE (status='completed' AND outcome IS NULL) OR (status<>'completed' AND outcome IS NOT NULL);
SELECT COUNT(*) AS invalid_deadlines FROM appointments WHERE expires_at IS NULL OR julianday(expires_at) IS NULL;
SELECT used_bytes FROM storage_quota WHERE id=1;
SELECT name FROM d1_migrations ORDER BY id;
PRAGMA foreign_key_check;
SELECT campus,date,location,revision FROM service_locations ORDER BY date,campus;
SELECT student_id,date,COUNT(*) AS historical_online_duplicates FROM appointments
  WHERE source='booking' AND status IN ('booked','in_progress','completed')
  GROUP BY student_id,date HAVING COUNT(*)>1;
SELECT COUNT(*) AS booking_receipts FROM booking_requests;
SELECT COUNT(*) AS location_changes FROM service_location_changes;
SELECT COUNT(*) AS invalid_location_snapshots FROM appointments
  WHERE contact_type IN ('qq','wechat') AND source='booking' AND location_snapshot='';

-- Staff schemas only (0010 and later): no identity may have multiple logins.
SELECT member_id,COUNT(*) AS login_count FROM staff_accounts
  GROUP BY member_id HAVING COUNT(*)>1;

-- v1.2: these queries report only counts / structural errors, never contacts.
SELECT id FROM staff_release_markers WHERE id='business-model-0049';
SELECT name AS retired_schema FROM sqlite_schema WHERE name IN
 ('active_repairs','repair_receptions','repair_queue_tickets','repair_queue_counters',
 'repair_followups','effective_member_roles','roster_tasks','roster_versions','availability',
 'roster_submissions','roster_collection_series','leave_requests','swap_requests','duty_roles');
SELECT name AS retired_column FROM pragma_table_info('appointments') WHERE name='registration_flow';
SELECT action,COUNT(*) AS archived_rows FROM audit_events WHERE action IN
 ('repairs.workflow.archived','repairs.followup.migrated','identity.authorization.archived',
 'rosters.model.migrated','repairs.registration.archived','authorization.condition.archived') GROUP BY action;
SELECT action,json_extract(after_json,'$.disposition') AS disposition,COUNT(*) AS rows
 FROM audit_events WHERE action IN ('repairs.followup.migrated','rosters.model.migrated')
 GROUP BY action,json_extract(after_json,'$.disposition');
SELECT status,outcome,COUNT(*) AS orders FROM appointments GROUP BY status,outcome;
SELECT COUNT(*) AS broken_parent_links FROM appointments a LEFT JOIN appointments p ON p.id=a.parent_appointment_id
 WHERE a.parent_appointment_id IS NOT NULL AND (p.id IS NULL OR p.status<>'completed' OR p.student_id<>a.student_id);
SELECT COUNT(*) AS broken_intake_photos FROM appointments a
 WHERE (front_photo_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM appointment_attachments p WHERE p.id=a.front_photo_id AND p.appointment_id=a.id))
 OR (back_photo_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM appointment_attachments p WHERE p.id=a.back_photo_id AND p.appointment_id=a.id));
SELECT COUNT(*) AS pending_original_photos FROM appointments WHERE photo_deferred_by IS NOT NULL;
SELECT active,COUNT(*) AS duty_assignments FROM duty_assignments GROUP BY active;
SELECT COUNT(*) AS recorded_leaves FROM roster_leaves WHERE withdrawn_at IS NULL;
SELECT status,COUNT(*) AS cover_invitations FROM roster_covers GROUP BY status;
