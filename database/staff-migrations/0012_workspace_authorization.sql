-- Only remove the original, overbroad reception defaults. Custom grants stay intact.
DELETE FROM role_grants WHERE role_id='role-office' AND id IN ('grant-office-members','grant-office-roles');

INSERT OR IGNORE INTO permission_definitions(code,module_code,name,description,scope_kinds,condition_kinds,sensitive) VALUES
 ('accounts.manage','identity','账号管理','维护授权校区的登录账号、激活资格与申请','["campus"]','[]',1),
 ('statistics.read','repairs','统计分析与导出','读取授权校区的统计及导出可见预约','["campus"]','[]',1);
INSERT OR IGNORE INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec) VALUES
 ('grant-superadmin-accounts','role-superadmin','accounts.manage','{"all":true}','[]'),
 ('grant-superadmin-statistics','role-superadmin','statistics.read','{"all":true}','[]');

-- All existing sessions must adopt the new access model, including legacy admins.
UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1;
