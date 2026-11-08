-- Replace the old controller's implicit access to the technician's own customer
-- with explicit, revocable grants. Unassigned and other members' jobs stay private.
INSERT OR IGNORE INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec) VALUES
 ('grant-technician-own-identity','role-technician','customer.identity.read','{"self":true}','[{"code":"ownResource","version":1}]'),
 ('grant-technician-own-contact','role-technician','customer.contact.read','{"self":true}','[{"code":"ownResource","version":1}]');

-- Preserve existing administrators' original management capabilities within
-- their existing campus grants. This binding is created once at cutover; new
-- accounts receive management grants only through an explicit role binding.
INSERT OR IGNORE INTO roles(id,code,name,description,level,created_at,updated_at) VALUES
 ('role-legacy-admin','legacy_admin','原后台管理员','保留升级前账号的原校区管理能力；不授予维修资格或角色管理',2,datetime('now'),datetime('now'));
INSERT OR IGNORE INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec)
SELECT 'grant-legacy-admin-'||code,'role-legacy-admin',code,'{"campuses":"bound"}','[]'
FROM permission_definitions WHERE code IN
 ('repair.summary.read','repair.correct','repair.transfer','statistics.read','accounts.manage','settings.manage','customer.identity.read','customer.contact.read');
INSERT OR IGNORE INTO member_roles(id,member_id,role_id,scope_bindings,effective_from)
-- Snapshot the original administrator campus set per person. Another login's
-- campus grants must never broaden these management capabilities.
SELECT 'legacy-admin-'||sa.member_id,sa.member_id,'role-legacy-admin',
  json_object('campusIds',json((SELECT json_group_array(DISTINCT CASE g.campus
    WHEN '南湖' THEN 'campus-nanhu' WHEN '浑南' THEN 'campus-hunnan' END)
    FROM staff_campus_grants g JOIN staff_accounts administrator ON administrator.account=g.account
    WHERE administrator.member_id=sa.member_id AND administrator.role='admin'))),
  MIN(substr(sa.created_at,1,10))
FROM staff_accounts sa WHERE sa.role='admin' AND sa.member_id IS NOT NULL GROUP BY sa.member_id;
UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE role='admin';

-- Remove only untouched defaults that earlier migrations inferred from the
-- legacy login label. Explicitly edited/dated bindings and independently
-- assigned organization memberships or work profiles remain intact.
DELETE FROM member_roles
WHERE role_id='role-office' AND revision=0 AND effective_to IS NULL
  AND EXISTS(SELECT 1 FROM staff_accounts sa WHERE sa.role='admin'
    AND sa.member_id=member_roles.member_id AND member_roles.id='member-role-'||sa.account
    AND member_roles.effective_from=substr(sa.created_at,1,10)
    AND member_roles.scope_bindings=CASE WHEN sa.protected=1 THEN '{"all":true}' ELSE '{"campuses":"legacy"}' END);
DELETE FROM member_work_profiles
WHERE profile_code='office' AND revision=0 AND effective_to IS NULL
  AND EXISTS(SELECT 1 FROM staff_accounts sa WHERE sa.role='admin'
    AND sa.member_id=member_work_profiles.member_id
    AND member_work_profiles.id IN ('profile-office-'||sa.account,'profile-default-'||sa.account)
    AND member_work_profiles.effective_from=substr(sa.created_at,1,10));
DELETE FROM member_department_memberships
WHERE department_id='dept-office' AND assignment_type='primary' AND is_primary=1
  AND revision=0 AND effective_to IS NULL
  AND EXISTS(SELECT 1 FROM staff_accounts sa WHERE sa.role='admin'
    AND sa.member_id=member_department_memberships.member_id
    AND member_department_memberships.id='membership-'||sa.account
    AND member_department_memberships.effective_from=substr(sa.created_at,1,10)
    AND member_department_memberships.created_at=sa.created_at);

-- A login label does not assign an administrator's organization or work post.
-- Keep the new-person guard so recreating a login cannot restore revoked grants.
DROP TRIGGER staff_account_member_sync;
CREATE TRIGGER staff_account_member_sync AFTER INSERT ON staff_accounts
WHEN NEW.member_id IS NULL
BEGIN
  INSERT OR IGNORE INTO members(id,name,student_id,home_campus_id,status,created_at,updated_at)
    VALUES ('member-'||NEW.account,NEW.name,
      CASE WHEN NEW.account GLOB '[0-9]*' THEN NEW.account ELSE NULL END,
      CASE NEW.home_campus WHEN '南湖' THEN 'campus-nanhu' WHEN '浑南' THEN 'campus-hunnan' END,
      CASE NEW.status WHEN 'enabled' THEN 'active' ELSE 'inactive' END,NEW.created_at,NEW.created_at);
  -- Seed defaults only when the immediately preceding insert created a person.
  -- Recreating a login must not restore roles that were deliberately revoked.
  INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from)
    SELECT 'member-role-'||NEW.account,'member-'||NEW.account,
      CASE NEW.role WHEN 'technician' THEN 'role-technician' ELSE 'role-superadmin' END,
      CASE WHEN NEW.protected=1 THEN '{"all":true}' ELSE '{"campuses":"legacy"}' END,substr(NEW.created_at,1,10)
    WHERE changes()>0 AND NEW.role<>'admin';
  INSERT INTO member_department_memberships
    (id,member_id,department_id,assignment_type,is_primary,effective_from,created_at)
    SELECT 'membership-'||NEW.account,'member-'||NEW.account,
      CASE NEW.role WHEN 'admin' THEN 'dept-office' WHEN 'superadmin' THEN 'dept-office' ELSE 'dept-hardware' END,
      'primary',1,substr(NEW.created_at,1,10),NEW.created_at
    WHERE changes()>0;
  INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from)
    SELECT 'profile-default-'||NEW.account,'member-'||NEW.account,
      CASE NEW.role WHEN 'admin' THEN 'office' ELSE 'repair' END,substr(NEW.created_at,1,10)
    WHERE changes()>0;
  INSERT INTO member_work_profiles(id,member_id,profile_code,effective_from)
    SELECT 'profile-office-'||NEW.account,'member-'||NEW.account,'office',substr(NEW.created_at,1,10)
    WHERE changes()>0 AND NEW.role='superadmin';
  UPDATE staff_accounts SET member_id='member-'||NEW.account WHERE account=NEW.account AND member_id IS NULL;
END;

-- Readiness must distinguish a completed cutover from the earlier dual host schema.
CREATE TABLE staff_release_markers(id TEXT PRIMARY KEY,applied_at TEXT NOT NULL);
INSERT INTO staff_release_markers VALUES('staff-react-0030',datetime('now'));
