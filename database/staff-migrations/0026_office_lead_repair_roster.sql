-- Office duty leaders coordinate the same repair roster workflow, within the
-- independently editable scope and validity of their existing office grant.
INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec,validity_spec)
SELECT 'grant-office-lead-repair-roster','role-office-lead','roster.repair.manage',scope_spec,condition_spec,validity_spec
FROM role_grants WHERE role_id='role-office-lead' AND permission_code='roster.office.manage'
AND NOT EXISTS(SELECT 1 FROM role_grants WHERE role_id='role-office-lead' AND permission_code='roster.repair.manage');
UPDATE roles SET revision=revision+1,updated_at=datetime('now') WHERE id='role-office-lead';
UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1
WHERE member_id IN (SELECT member_id FROM member_roles WHERE role_id='role-office-lead');
