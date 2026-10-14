-- Read-only schema and data checks.
-- Fresh database baseline: 2 protected roots, 4 grants, empty business tables,
-- used_bytes=0, all migrations recorded, no foreign key violations.
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
