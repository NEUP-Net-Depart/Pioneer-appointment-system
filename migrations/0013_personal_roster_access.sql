-- Personal schedules and requests belong to every staff workflow.
-- This grants only self access; existing role bindings and campus limits remain effective.
INSERT OR IGNORE INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec) VALUES
 ('grant-technician-roster-self','role-technician','roster.read','{"self":true}','[]'),
 ('grant-office-roster-self','role-office','roster.read','{"self":true}','[]'),
 ('grant-repair-lead-roster-self','role-repair-lead','roster.read','{"self":true}','[]'),
 ('grant-office-lead-roster-self','role-office-lead','roster.read','{"self":true}','[]');

UPDATE staff_accounts SET auth_version=auth_version+1 WHERE member_id IN (
 SELECT member_id FROM member_roles WHERE role_id IN ('role-technician','role-office','role-repair-lead','role-office-lead')
);
