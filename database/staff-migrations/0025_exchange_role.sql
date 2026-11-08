-- Exchange is an independently configurable role. Qualification and department
-- remain separate facts; this migration never changes a member's department.
INSERT INTO roles(id,code,name,description,level,created_at,updated_at)
VALUES('role-exchange','exchange','交流人员','其他部门经培训合格的维修参与人员；到场签到后可维修，不参与维修排班',1,datetime('now'),datetime('now'));

-- Reuse the current repair command grants and their scope/conditions, excluding
-- all scheduling and management grants. Further role edits remain independent.
INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec,validity_spec)
SELECT 'grant-exchange-'||permission_code,'role-exchange',permission_code,scope_spec,condition_spec,validity_spec
FROM role_grants WHERE role_id='role-technician'
AND permission_code IN ('repair.summary.read','repair.start','repair.finish.own','onsite.create','attendance.self');

CREATE TABLE _exchange_role_bindings AS
SELECT mr.id,mr.member_id FROM member_roles mr
WHERE mr.role_id='role-technician'
AND mr.effective_from<=date('now','+8 hours') AND (mr.effective_to IS NULL OR mr.effective_to>date('now','+8 hours'))
AND EXISTS(SELECT 1 FROM member_work_profiles p WHERE p.member_id=mr.member_id AND p.profile_code='exchange'
  AND p.effective_from<=date('now','+8 hours') AND (p.effective_to IS NULL OR p.effective_to>date('now','+8 hours')))
AND NOT EXISTS(SELECT 1 FROM member_roles other WHERE other.member_id=mr.member_id
  AND other.role_id='role-exchange' AND other.effective_from=mr.effective_from);
UPDATE member_roles SET role_id='role-exchange',revision=revision+1
WHERE id IN (SELECT id FROM _exchange_role_bindings);
UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1
WHERE member_id IN (SELECT member_id FROM _exchange_role_bindings);
UPDATE members SET revision=revision+1,updated_at=datetime('now')
WHERE id IN (SELECT member_id FROM _exchange_role_bindings);
DROP TABLE _exchange_role_bindings;
