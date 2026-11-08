-- Repair field management follows effective authorization plus today's campus
-- check-in. Preserve every other custom condition, scope and validity window.
CREATE TABLE _signed_repair_lead_grants AS
  SELECT DISTINCT rg.id,rg.role_id FROM role_grants rg
  WHERE rg.permission_code IN ('repair.summary.read','attendance.session.manage','repair.correct','repair.transfer')
    AND EXISTS (SELECT 1 FROM role_grants lead WHERE lead.role_id=rg.role_id
      AND lead.permission_code IN ('repair.correct','repair.transfer'))
    AND EXISTS (SELECT 1 FROM json_each(rg.condition_spec) c WHERE json_extract(c.value,'$.code')='activeDutyRole');
UPDATE role_grants SET condition_spec=(
  SELECT json_group_array(json(CASE WHEN json_extract(c.value,'$.code')='activeDutyRole'
    THEN json_object('code','signedDutyPresence','version',1) ELSE c.value END))
  FROM json_each(role_grants.condition_spec) c
) WHERE id IN (SELECT id FROM _signed_repair_lead_grants);
UPDATE permission_definitions SET condition_kinds=json_insert(condition_kinds,'$[#]','signedDutyPresence')
  WHERE code IN ('repair.summary.read','attendance.session.manage','repair.correct','repair.transfer')
    AND NOT EXISTS (SELECT 1 FROM json_each(condition_kinds) WHERE value='signedDutyPresence');
UPDATE roles SET revision=revision+1,updated_at=datetime('now')
  WHERE id IN (SELECT role_id FROM _signed_repair_lead_grants);
UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1
  WHERE member_id IN (SELECT member_id FROM member_roles WHERE role_id IN (SELECT role_id FROM _signed_repair_lead_grants));
DROP TABLE _signed_repair_lead_grants;

UPDATE role_grants SET condition_spec='[{"code":"rosterParticipantEligible","version":1}]'
  WHERE id IN ('grant-technician-roster-self','grant-office-roster-self') AND condition_spec='[]';
UPDATE permission_definitions SET condition_kinds='["rosterParticipantEligible"]' WHERE code='roster.read';
UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1
  WHERE member_id IN (SELECT member_id FROM member_roles WHERE role_id IN ('role-technician','role-office'));

-- Imported qualifications belong to the person, not a newly created login.
CREATE TABLE activation_member_bindings (
  student_id TEXT PRIMARY KEY REFERENCES staff_whitelist(student_id),
  member_id TEXT NOT NULL REFERENCES members(id)
);
DROP TRIGGER activation_approve;
CREATE TRIGGER activation_approve AFTER UPDATE OF status ON activation_requests
WHEN OLD.status='pending' AND NEW.status='approved'
BEGIN
  SELECT RAISE(ABORT,'ACTIVATION_CONFLICT') WHERE NOT EXISTS (
    SELECT 1 FROM staff_whitelist WHERE student_id=NEW.student_id AND status='open'
      AND (expected_name='' OR expected_name=NEW.name)
  ) OR NOT EXISTS (SELECT 1 FROM whitelist_campus_grants WHERE student_id=NEW.student_id);
  SELECT RAISE(ABORT,'ACTIVATION_QUALIFICATION_CHANGED') WHERE EXISTS (
    SELECT 1 FROM activation_member_bindings b WHERE b.student_id=NEW.student_id AND NOT EXISTS (
      SELECT 1 FROM members m JOIN member_work_profiles p ON p.member_id=m.id
        JOIN member_roles mr ON mr.member_id=m.id JOIN roles r ON r.id=mr.role_id AND r.enabled=1
      WHERE m.id=b.member_id AND m.status='active'
        AND p.profile_code IN ('repair','exchange','office')
        AND p.effective_from<=date(NEW.reviewed_at,'+8 hours') AND (p.effective_to IS NULL OR p.effective_to>date(NEW.reviewed_at,'+8 hours'))
        AND mr.effective_from<=date(NEW.reviewed_at,'+8 hours') AND (mr.effective_to IS NULL OR mr.effective_to>date(NEW.reviewed_at,'+8 hours'))
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
