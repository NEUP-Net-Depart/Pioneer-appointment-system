-- Compatibility management belongs to each pre-cutover admin login, not every
-- login linked to the same person. Freeze each login's own campus boundary.
CREATE TABLE legacy_admin_logins (
  account TEXT PRIMARY KEY REFERENCES staff_accounts(account) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id),
  campus_ids TEXT NOT NULL CHECK(json_valid(campus_ids) AND json_type(campus_ids)='array')
);
INSERT INTO legacy_admin_logins(account,member_id,campus_ids)
SELECT sa.account,sa.member_id,json_group_array(DISTINCT CASE g.campus
  WHEN '南湖' THEN 'campus-nanhu' WHEN '浑南' THEN 'campus-hunnan' END)
FROM staff_accounts sa JOIN staff_campus_grants g ON g.account=sa.account
WHERE sa.role='admin' AND EXISTS (
  SELECT 1 FROM member_roles mr WHERE mr.member_id=sa.member_id AND mr.role_id='role-legacy-admin'
) GROUP BY sa.account,sa.member_id;

-- Changing a login's identity or base type ends its compatibility entitlement.
-- Changing it back, or recreating the login, cannot restore the snapshot.
CREATE TRIGGER legacy_admin_login_changed AFTER UPDATE OF role,member_id ON staff_accounts
WHEN NEW.role<>'admin' OR NEW.member_id IS NOT OLD.member_id
BEGIN
  DELETE FROM legacy_admin_logins WHERE account=NEW.account;
END;
UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1
WHERE member_id IN (SELECT member_id FROM legacy_admin_logins);

-- Ordinary invitations are technician-only. Imported admin invitations must
-- already have an explicit member authorization; a base account type grants none.
CREATE TRIGGER activation_admin_submit_guard BEFORE INSERT ON activation_requests
WHEN EXISTS(SELECT 1 FROM staff_whitelist WHERE student_id=NEW.student_id AND expected_role='admin')
  AND NOT EXISTS(SELECT 1 FROM activation_member_bindings WHERE student_id=NEW.student_id)
BEGIN
  SELECT RAISE(ABORT,'ACTIVATION_ADMIN_AUTHORIZATION_REQUIRED');
END;
DROP TRIGGER activation_approve;
CREATE TRIGGER activation_approve AFTER UPDATE OF status ON activation_requests
WHEN OLD.status='pending' AND NEW.status='approved'
BEGIN
  SELECT RAISE(ABORT,'ACTIVATION_CONFLICT') WHERE NOT EXISTS (
    SELECT 1 FROM staff_whitelist WHERE student_id=NEW.student_id AND status='open'
      AND (expected_name='' OR expected_name=NEW.name)
  ) OR NOT EXISTS (SELECT 1 FROM whitelist_campus_grants WHERE student_id=NEW.student_id);
  SELECT RAISE(ABORT,'ACTIVATION_ADMIN_AUTHORIZATION_REQUIRED') WHERE EXISTS (
    SELECT 1 FROM staff_whitelist WHERE student_id=NEW.student_id AND expected_role='admin'
  ) AND NOT EXISTS(SELECT 1 FROM activation_member_bindings WHERE student_id=NEW.student_id);
  SELECT RAISE(ABORT,'ACTIVATION_QUALIFICATION_CHANGED') WHERE EXISTS (
    SELECT 1 FROM activation_member_bindings b WHERE b.student_id=NEW.student_id AND NOT EXISTS (
      SELECT 1 FROM members m JOIN member_roles mr ON mr.member_id=m.id
        JOIN roles r ON r.id=mr.role_id AND r.enabled=1 AND r.code NOT IN ('legacy_admin','superadmin')
        JOIN role_grants rg ON rg.role_id=r.id JOIN permission_definitions pd ON pd.code=rg.permission_code AND pd.enabled=1
      WHERE m.id=b.member_id AND m.status='active'
        AND mr.effective_from<=date(NEW.reviewed_at,'+8 hours') AND (mr.effective_to IS NULL OR mr.effective_to>date(NEW.reviewed_at,'+8 hours'))
        AND ((SELECT expected_role FROM staff_whitelist WHERE student_id=NEW.student_id)='admin' OR EXISTS (
          SELECT 1 FROM member_work_profiles p WHERE p.member_id=m.id AND p.profile_code IN ('repair','exchange','office')
            AND p.effective_from<=date(NEW.reviewed_at,'+8 hours') AND (p.effective_to IS NULL OR p.effective_to>date(NEW.reviewed_at,'+8 hours'))
        ))
    )
  );
  INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,member_id)
    SELECT NEW.student_id,NEW.name,expected_role,NEW.home_campus,NEW.password_hash,NEW.reviewed_at,
      (SELECT id FROM members WHERE student_id=NEW.student_id)
    FROM staff_whitelist WHERE student_id=NEW.student_id;
  INSERT INTO staff_campus_grants(account,campus)
    SELECT NEW.student_id,campus FROM whitelist_campus_grants WHERE student_id=NEW.student_id;
  UPDATE staff_whitelist SET status='activated',revision=revision+1 WHERE student_id=NEW.student_id;
  UPDATE activation_requests SET password_hash='' WHERE id=NEW.id;
END;
INSERT INTO staff_release_markers(id,applied_at) VALUES('staff-react-0031',datetime('now'));
