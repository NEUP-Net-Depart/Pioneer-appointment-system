-- Accounts are login identities; their member mapping becomes immutable once set.
DROP INDEX idx_staff_accounts_member_id;
CREATE INDEX idx_staff_accounts_member_id ON staff_accounts(member_id);
CREATE TRIGGER staff_account_member_insert_guard BEFORE INSERT ON staff_accounts
WHEN NEW.member_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.member_id)
BEGIN
  SELECT RAISE(ABORT,'MEMBER_NOT_FOUND');
END;
CREATE TRIGGER staff_account_member_update_guard BEFORE UPDATE OF member_id ON staff_accounts
WHEN (OLD.member_id IS NOT NULL AND NEW.member_id IS NOT OLD.member_id)
  OR (NEW.member_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM members WHERE id=NEW.member_id))
BEGIN
  SELECT RAISE(ABORT,'MEMBER_MAPPING_IMMUTABLE');
END;
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
      CASE NEW.role WHEN 'technician' THEN 'role-technician' WHEN 'admin' THEN 'role-office' ELSE 'role-superadmin' END,
      CASE WHEN NEW.protected=1 THEN '{"all":true}' ELSE '{"campuses":"legacy"}' END,substr(NEW.created_at,1,10)
    WHERE changes()>0;
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
