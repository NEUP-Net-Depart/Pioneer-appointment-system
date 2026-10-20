-- Monthly attendance review is a long-term office lead responsibility.
-- Keep the member's bound campus/department scope; do not grant global exports.
CREATE TABLE _office_attendance_export AS
  SELECT id FROM roles WHERE id='role-office-lead' AND code='office_lead'
    AND NOT EXISTS(SELECT 1 FROM role_grants WHERE id='grant-office-lead-export');
INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec,validity_spec)
  SELECT 'grant-office-lead-export',id,'attendance.export','{"campuses":"bound"}','[]','{}' FROM _office_attendance_export;
UPDATE roles SET revision=revision+1,updated_at=datetime('now') WHERE id IN (SELECT id FROM _office_attendance_export);
UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1
  WHERE member_id IN (SELECT member_id FROM member_roles WHERE role_id IN (SELECT id FROM _office_attendance_export));
DROP TABLE _office_attendance_export;
