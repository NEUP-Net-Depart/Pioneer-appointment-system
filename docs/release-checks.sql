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
