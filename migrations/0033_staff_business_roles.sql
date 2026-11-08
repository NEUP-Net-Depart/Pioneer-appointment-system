-- Fail before changing authorization if any person has multiple logins.
-- Account/member mappings and credentials must never be silently merged.
CREATE TABLE _staff_single_login_guard (valid INTEGER NOT NULL CHECK(valid=1));
INSERT INTO _staff_single_login_guard
SELECT 0 WHERE EXISTS(SELECT 1 FROM staff_accounts GROUP BY member_id HAVING COUNT(*)>1)
  OR EXISTS(SELECT 1 FROM staff_accounts sa WHERE sa.member_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM members m WHERE m.id=sa.member_id));
DROP TABLE _staff_single_login_guard;
DROP INDEX idx_staff_accounts_member_id;
CREATE UNIQUE INDEX idx_staff_accounts_member_id ON staff_accounts(member_id);

-- Canonicalize the historical account-campus marker once; the runtime accepts
-- only the current bound scope after this migration.
UPDATE member_roles SET scope_bindings=json_set(scope_bindings,'$.campuses','bound')
  WHERE json_extract(scope_bindings,'$.campuses')='legacy';
UPDATE member_roles SET scope_bindings=json_set(scope_bindings,'$.campusIds','bound')
  WHERE json_extract(scope_bindings,'$.campusIds')='legacy';
UPDATE role_grants SET scope_spec=json_set(scope_spec,'$.campuses','bound')
  WHERE json_extract(scope_spec,'$.campuses')='legacy';
UPDATE role_grants SET scope_spec=json_set(scope_spec,'$.campusIds','bound')
  WHERE json_extract(scope_spec,'$.campusIds')='legacy';

-- repair_lead is a permanent business manager. Field work is independently
-- authorized by technician/exchange plus a work qualification and presence.
UPDATE roles SET name='维修负责人',description='部长及以上的长期业务管理角色；管理不依赖排班或签到',
  revision=revision+1,updated_at=datetime('now')
  WHERE code='repair_lead' AND name='维修值班负责人' AND description='当日维修运行与排班管理';
-- Change only untouched historical defaults. Explicit grants retain their
-- conditions, scopes and validity, including intentional duty restrictions.
UPDATE role_grants SET condition_spec='[]',revision=revision+1
WHERE role_id='role-repair-lead' AND revision=0
  AND id IN ('grant-repair-lead-summary','grant-repair-lead-session','grant-repair-lead-correct',
    'grant-repair-lead-transfer','grant-repair-lead-roster')
  AND json(scope_spec)='{"campuses":"bound"}' AND json(validity_spec)='{}'
  AND json(condition_spec) IN ('[{"code":"activeDutyRole","version":1}]',
    '[{"code":"signedDutyPresence","version":1}]');
INSERT OR IGNORE INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec)
SELECT 'grant-repair-lead-'||code,'role-repair-lead',code,'{"campuses":"bound"}','[]'
FROM permission_definitions WHERE code IN (
  'repair.summary.read','repair.correct','repair.transfer','customer.identity.read','customer.contact.read',
  'onsite.frontdesk.create','statistics.read','settings.manage','accounts.manage','members.manage','roles.manage',
  'roster.read','roster.repair.manage','roster.repair.configure','roster.office.manage','leave.review',
  'attendance.session.manage','attendance.correct','attendance.export');
INSERT OR IGNORE INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec)
VALUES('grant-repair-lead-attendance','role-repair-lead','attendance.self','{"campuses":"bound"}',
  '[{"code":"attendanceEligible","version":1}]');

-- Convert every existing admin once, using that account's current campus set.
-- All historical administrators are hardware repair leads.
-- Any existing configuration wins, including expired and future bindings.
-- Seed only missing roles at cutover; never reopen or backdate authorization.
INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from)
SELECT 'business-'||required.key||'-'||sa.account,sa.member_id,required.role_id,
  json_object('campusIds',json((SELECT json_group_array(CASE g.campus
    WHEN '南湖' THEN 'campus-nanhu' WHEN '浑南' THEN 'campus-hunnan' END)
    FROM staff_campus_grants g WHERE g.account=sa.account))),
  date('now','+8 hours')
FROM staff_accounts sa CROSS JOIN (
  SELECT 'lead' AS key,'role-repair-lead' AS role_id
  UNION ALL SELECT 'technician','role-technician'
) required WHERE sa.role='admin'
  AND NOT EXISTS(SELECT 1 FROM member_roles mr WHERE mr.member_id=sa.member_id
    AND mr.role_id=required.role_id);
INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from)
SELECT 'business-repair-'||sa.account,sa.member_id,'repair',date('now','+8 hours')
FROM staff_accounts sa WHERE sa.role='admin'
  AND NOT EXISTS(SELECT 1 FROM member_work_profiles p WHERE p.member_id=sa.member_id
    AND p.profile_code='repair');

-- Hardware affiliation is separate from any explicitly maintained office post.
-- Preserve existing appointments, qualifications and dated organization facts.
INSERT INTO member_department_memberships
  (id,member_id,department_id,assignment_type,is_primary,effective_from,created_at)
SELECT 'business-hardware-'||sa.account,sa.member_id,'dept-hardware',
  CASE WHEN EXISTS(SELECT 1 FROM member_department_memberships mm WHERE mm.member_id=sa.member_id
    AND mm.is_primary=1 AND (mm.effective_to IS NULL OR mm.effective_to>date('now','+8 hours')))
    THEN 'secondary' ELSE 'primary' END,
  CASE WHEN EXISTS(SELECT 1 FROM member_department_memberships mm WHERE mm.member_id=sa.member_id
    AND mm.is_primary=1 AND (mm.effective_to IS NULL OR mm.effective_to>date('now','+8 hours')))
    THEN 0 ELSE 1 END,date('now','+8 hours'),datetime('now')
FROM staff_accounts sa WHERE sa.role IN ('admin','technician')
  AND NOT EXISTS(SELECT 1 FROM member_department_memberships mm WHERE mm.member_id=sa.member_id
    AND mm.department_id='dept-hardware')
  -- Already configured exchange/office members retain their actual department.
  AND (sa.role='admin' OR EXISTS(SELECT 1 FROM member_work_profiles p WHERE p.member_id=sa.member_id
    AND p.profile_code='repair' AND p.effective_from<=date('now','+8 hours')
    AND (p.effective_to IS NULL OR p.effective_to>date('now','+8 hours'))));

DROP TRIGGER legacy_admin_login_changed;
DROP TABLE legacy_admin_logins;
DELETE FROM member_roles WHERE role_id IN (SELECT id FROM roles WHERE code='legacy_admin');
DELETE FROM roles WHERE code='legacy_admin';

-- Only a newly created technician receives the technician onboarding defaults.
-- Recreating a login preserves revoked grants; an admin type grants no work post.
DROP TRIGGER staff_account_member_sync;
CREATE TRIGGER staff_account_member_sync AFTER INSERT ON staff_accounts
WHEN NEW.member_id IS NULL
BEGIN
  INSERT OR IGNORE INTO members(id,name,student_id,home_campus_id,status,created_at,updated_at)
    VALUES('member-'||NEW.account,NEW.name,CASE WHEN NEW.account GLOB '[0-9]*' THEN NEW.account ELSE NULL END,
      CASE NEW.home_campus WHEN '南湖' THEN 'campus-nanhu' WHEN '浑南' THEN 'campus-hunnan' END,
      CASE NEW.status WHEN 'enabled' THEN 'active' ELSE 'inactive' END,NEW.created_at,NEW.created_at);
  INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from)
    SELECT 'member-role-'||NEW.account,'member-'||NEW.account,
      CASE NEW.role WHEN 'technician' THEN 'role-technician' ELSE 'role-superadmin' END,
      CASE WHEN NEW.protected=1 THEN '{"all":true}' ELSE '{"campuses":"bound"}' END,substr(NEW.created_at,1,10)
    WHERE changes()>0 AND (NEW.role='technician' OR NEW.protected=1);
  INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,effective_from,created_at)
    SELECT 'membership-'||NEW.account,'member-'||NEW.account,
      CASE WHEN NEW.protected=1 THEN 'dept-office' ELSE 'dept-hardware' END,
      'primary',1,substr(NEW.created_at,1,10),NEW.created_at WHERE changes()>0;
  INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from)
    SELECT 'profile-default-'||NEW.account,'member-'||NEW.account,'repair',substr(NEW.created_at,1,10) WHERE changes()>0;
  INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from)
    SELECT 'profile-office-'||NEW.account,'member-'||NEW.account,'office',substr(NEW.created_at,1,10)
    WHERE changes()>0 AND NEW.protected=1;
  UPDATE staff_accounts SET member_id='member-'||NEW.account WHERE account=NEW.account AND member_id IS NULL;
END;

-- Imported business managers need an explicit role, without a work qualification.
-- All other imported workers still require their independently stored profile.
DROP TRIGGER activation_approve;
CREATE TRIGGER activation_approve AFTER UPDATE OF status ON activation_requests
WHEN OLD.status='pending' AND NEW.status='approved'
BEGIN
  SELECT RAISE(ABORT,'ACTIVATION_CONFLICT') WHERE NOT EXISTS(
    SELECT 1 FROM staff_whitelist WHERE student_id=NEW.student_id AND status='open'
      AND (expected_name='' OR expected_name=NEW.name))
    OR NOT EXISTS(SELECT 1 FROM whitelist_campus_grants WHERE student_id=NEW.student_id);
  SELECT RAISE(ABORT,'ACTIVATION_ADMIN_AUTHORIZATION_REQUIRED') WHERE EXISTS(
    SELECT 1 FROM staff_whitelist WHERE student_id=NEW.student_id AND expected_role='admin')
    AND NOT EXISTS(SELECT 1 FROM activation_member_bindings WHERE student_id=NEW.student_id);
  SELECT RAISE(ABORT,'ACTIVATION_QUALIFICATION_CHANGED') WHERE EXISTS(
    SELECT 1 FROM activation_member_bindings b WHERE b.student_id=NEW.student_id AND NOT EXISTS(
      SELECT 1 FROM members m JOIN member_roles mr ON mr.member_id=m.id
        JOIN roles r ON r.id=mr.role_id AND r.enabled=1 AND r.code<>'superadmin'
        JOIN role_grants rg ON rg.role_id=r.id JOIN permission_definitions pd ON pd.code=rg.permission_code AND pd.enabled=1
      WHERE m.id=b.member_id AND m.status='active'
        AND mr.effective_from<=date(NEW.reviewed_at,'+8 hours') AND (mr.effective_to IS NULL OR mr.effective_to>date(NEW.reviewed_at,'+8 hours'))
        AND (rg.permission_code IN ('accounts.manage','members.manage','roles.manage','settings.manage','statistics.read','roster.repair.manage','roster.office.manage','attendance.correct') OR EXISTS(SELECT 1 FROM member_work_profiles p WHERE p.member_id=m.id
          AND p.profile_code IN ('repair','exchange','office') AND p.effective_from<=date(NEW.reviewed_at,'+8 hours')
          AND (p.effective_to IS NULL OR p.effective_to>date(NEW.reviewed_at,'+8 hours'))))));
  INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,member_id)
    SELECT NEW.student_id,NEW.name,expected_role,NEW.home_campus,NEW.password_hash,NEW.reviewed_at,
      (SELECT id FROM members WHERE student_id=NEW.student_id)
    FROM staff_whitelist WHERE student_id=NEW.student_id;
  INSERT INTO staff_campus_grants(account,campus)
    SELECT NEW.student_id,campus FROM whitelist_campus_grants WHERE student_id=NEW.student_id;
  UPDATE staff_whitelist SET status='activated',revision=revision+1 WHERE student_id=NEW.student_id;
  UPDATE activation_requests SET password_hash='' WHERE id=NEW.id;
END;
UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1;
INSERT INTO staff_release_markers(id,applied_at) VALUES('staff-business-0033',datetime('now'));
