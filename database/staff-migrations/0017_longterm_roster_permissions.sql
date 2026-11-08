-- Scheduling and leave approval are long-term grants; field coordination
-- continues to require today's duty. Preserve customized grant conditions.
UPDATE permission_definitions SET condition_kinds='[]'
  WHERE code IN ('roster.repair.manage','roster.office.manage','leave.review');
CREATE TABLE _longterm_roster_grants AS
  SELECT id,role_id FROM role_grants WHERE
    (id='grant-repair-lead-roster' AND role_id='role-repair-lead' AND permission_code='roster.repair.manage'
      OR id='grant-office-lead-roster' AND role_id='role-office-lead' AND permission_code='roster.office.manage'
      OR id='grant-office-lead-leave' AND role_id='role-office-lead' AND permission_code='leave.review')
    AND scope_spec='{"campuses":"bound"}' AND condition_spec='[{"code":"activeDutyRole","version":1}]' AND validity_spec='{}';
UPDATE role_grants SET condition_spec='[]' WHERE id IN (SELECT id FROM _longterm_roster_grants);
UPDATE roles SET revision=revision+1,updated_at=datetime('now')
  WHERE id IN (SELECT role_id FROM _longterm_roster_grants);
UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1
  WHERE member_id IN (SELECT member_id FROM member_roles WHERE role_id IN (SELECT role_id FROM _longterm_roster_grants));
DROP TABLE _longterm_roster_grants;
