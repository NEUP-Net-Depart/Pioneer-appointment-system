-- Read-only checks after applying the initial migration and seeding roots.
-- Expected before launch: accounts=2, enabled protected roots=2, grants=4,
-- every business count=0, used_bytes=0, one initial migration, no FK errors.
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
SELECT used_bytes FROM storage_quota WHERE id=1;
SELECT name FROM d1_migrations ORDER BY id;
PRAGMA foreign_key_check;
