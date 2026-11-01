-- One-time cutover from reviewed private input. No person identifiers belong here.
-- Private input schema only. Values are prepared outside Git by the cutover tool.
-- staff-cutover-input:start
CREATE TABLE IF NOT EXISTS _staff_cutover_batch (
 id INTEGER PRIMARY KEY CHECK(id=1),
 format_version INTEGER NOT NULL CHECK(format_version=1),
 environment TEXT NOT NULL CHECK(environment IN ('production','preview')),
 database_id TEXT NOT NULL,
 migration_sha256 TEXT NOT NULL,
 source_state TEXT NOT NULL CHECK(json_valid(source_state)),
 business_date TEXT NOT NULL,
 prepared_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS _staff_cutover_decisions (
 member_id TEXT PRIMARY KEY,
 decision TEXT NOT NULL CHECK(decision IN ('migrate','revoke')),
 department_code TEXT,
 position_code TEXT,
 effective_from TEXT,
 effective_to TEXT,
 exchange_from TEXT,
 exchange_to TEXT,
 authorizations TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(authorizations) AND json_type(authorizations)='array'),
 reason TEXT NOT NULL CHECK(length(trim(reason))>0)
);
-- staff-cutover-input:end
-- This authorization snapshot deliberately excludes passwords and contacts.
-- staff-cutover-state:start
CREATE VIEW _staff_cutover_current AS SELECT json_object(
 'accounts',(SELECT json_group_array(json_array(account,member_id,name,role,status,home_campus,protected,revision,auth_version,token_version)) FROM (SELECT * FROM staff_accounts ORDER BY account)),
 'campuses',(SELECT json_group_array(json_array(account,campus)) FROM (SELECT * FROM staff_campus_grants ORDER BY account,campus)),
 'members',(SELECT json_group_array(json_array(id,name,student_id,home_campus_id,status,revision,college,major)) FROM (SELECT * FROM members ORDER BY id)),
 'memberships',(SELECT json_group_array(json_array(id,member_id,department_id,assignment_type,is_primary,effective_from,effective_to,revision)) FROM (SELECT * FROM member_department_memberships ORDER BY id)),
 'qualifications',(SELECT json_group_array(json_array(id,member_id,profile_code,effective_from,effective_to,revision)) FROM (SELECT * FROM member_work_profiles ORDER BY id)),
 'bindings',(SELECT json_group_array(json_array(id,member_id,role_id,scope_bindings,effective_from,effective_to,revision)) FROM (SELECT * FROM member_roles ORDER BY id)),
 'departments',(SELECT json_group_array(json_array(id,code,enabled,revision)) FROM (SELECT * FROM departments ORDER BY id)),
 'roles',(SELECT json_group_array(json_array(id,code,level,enabled,revision)) FROM (SELECT * FROM roles ORDER BY id)),
 'grants',(SELECT json_group_array(json_array(id,role_id,permission_code,scope_spec,condition_spec,validity_spec,revision)) FROM (SELECT * FROM role_grants ORDER BY id)),
 'permissions',(SELECT json_group_array(json_array(code,version,enabled,scope_kinds,condition_kinds)) FROM (SELECT * FROM permission_definitions ORDER BY code))
) AS state;
-- staff-cutover-state:end
CREATE TABLE _organization_cutover_guard(valid INTEGER NOT NULL CONSTRAINT staff_cutover_ready CHECK(valid=1));
-- Empty installations need no private input. Every existing non-system member does.
INSERT INTO _organization_cutover_guard SELECT 0 WHERE EXISTS(
 SELECT 1 FROM members m WHERE NOT EXISTS(SELECT 1 FROM staff_accounts a WHERE a.member_id=m.id AND a.protected=1)
 AND NOT EXISTS(SELECT 1 FROM _staff_cutover_decisions d WHERE d.member_id=m.id));
INSERT INTO _organization_cutover_guard SELECT 0 WHERE EXISTS(
 SELECT 1 FROM _staff_cutover_decisions d LEFT JOIN members m ON m.id=d.member_id
 WHERE m.id IS NULL OR EXISTS(SELECT 1 FROM staff_accounts a WHERE a.member_id=d.member_id AND a.protected=1));
INSERT INTO _organization_cutover_guard SELECT 0 WHERE EXISTS(SELECT 1 FROM _staff_cutover_decisions) AND NOT EXISTS(
 SELECT 1 FROM _staff_cutover_batch b WHERE b.id=1 AND b.format_version=1
 AND b.business_date=date('now','+8 hours') AND b.source_state=(SELECT state FROM _staff_cutover_current));
INSERT INTO _organization_cutover_guard SELECT 0 WHERE EXISTS(
 SELECT 1 FROM _staff_cutover_decisions d WHERE
 (d.decision='revoke' AND (d.department_code IS NOT NULL OR d.position_code IS NOT NULL OR d.effective_from IS NOT NULL OR d.effective_to IS NOT NULL OR d.exchange_from IS NOT NULL OR d.exchange_to IS NOT NULL OR json_array_length(d.authorizations)>0)) OR
 (d.decision='migrate' AND d.department_code IS NULL AND d.exchange_from IS NULL AND json_array_length(d.authorizations)=0) OR
 (d.department_code IS NULL AND (d.position_code IS NOT NULL OR d.effective_from IS NOT NULL OR d.effective_to IS NOT NULL)) OR
 (d.department_code IS NOT NULL AND (d.position_code IS NULL OR d.effective_from IS NULL OR NOT (
  (d.department_code='center' AND d.position_code IN ('president','vice_president')) OR
  (d.department_code IN ('device_station','network_station','affairs_station') AND d.position_code IN ('director','deputy_director')) OR
  (d.department_code IN ('hardware','network','office','art','publicity') AND d.position_code IN ('member','head','deputy_head'))))) OR
 (d.exchange_from IS NULL AND d.exchange_to IS NOT NULL) OR (d.exchange_from IS NOT NULL AND d.department_code='hardware'));
INSERT INTO _organization_cutover_guard SELECT 0 WHERE EXISTS(
 SELECT 1 FROM _staff_cutover_decisions d, json_each(json_array(d.effective_from,d.effective_to,d.exchange_from,d.exchange_to)) v
 WHERE v.value IS NOT NULL AND (length(v.value)<>10 OR date(v.value,'+0 days') IS NULL OR date(v.value,'+0 days')<>v.value))
 OR EXISTS(SELECT 1 FROM _staff_cutover_decisions WHERE effective_to<=effective_from OR exchange_to<=exchange_from);
INSERT INTO _organization_cutover_guard SELECT 0 WHERE EXISTS(
 SELECT 1 FROM _staff_cutover_decisions d,json_each(d.authorizations) a LEFT JOIN roles r ON r.code=json_extract(a.value,'$.roleCode')
 WHERE a.type<>'object' OR r.id IS NULL OR r.level>=3 OR r.enabled<>1
 OR coalesce(json_type(a.value,'$.reason'),'')<>'text' OR length(trim(json_extract(a.value,'$.reason')))=0
 OR coalesce(json_type(a.value,'$.scope'),'')<>'object'
 OR coalesce(json_type(a.value,'$.scope.campusIds'),'')<>'array' OR json_array_length(a.value,'$.scope.campusIds')=0
 OR coalesce(json_type(a.value,'$.effectiveFrom'),'')<>'text' OR length(json_extract(a.value,'$.effectiveFrom'))<>10
 OR date(json_extract(a.value,'$.effectiveFrom'),'+0 days') IS NULL OR date(json_extract(a.value,'$.effectiveFrom'),'+0 days')<>json_extract(a.value,'$.effectiveFrom')
 OR (json_extract(a.value,'$.effectiveTo') IS NOT NULL AND (length(json_extract(a.value,'$.effectiveTo'))<>10
 OR date(json_extract(a.value,'$.effectiveTo'),'+0 days') IS NULL OR date(json_extract(a.value,'$.effectiveTo'),'+0 days')<>json_extract(a.value,'$.effectiveTo')
 OR json_extract(a.value,'$.effectiveTo')<=json_extract(a.value,'$.effectiveFrom')))
 OR EXISTS(SELECT 1 FROM json_each(a.value,'$.scope.campusIds') c WHERE c.type<>'text' OR NOT EXISTS(
 SELECT 1 FROM staff_accounts sa JOIN staff_campus_grants g ON g.account=sa.account
 WHERE sa.member_id=d.member_id AND c.value=CASE g.campus WHEN '南湖' THEN 'campus-nanhu' WHEN '浑南' THEN 'campus-hunnan' END))
 OR EXISTS(SELECT 1 FROM json_each(a.value,'$.scope') s WHERE s.key NOT IN ('campusIds','departmentIds','objectIds','self')
 OR (s.key IN ('departmentIds','objectIds') AND s.type<>'array') OR (s.key='self' AND s.type NOT IN ('true','false')))
 OR EXISTS(SELECT 1 FROM json_each(a.value,'$.scope') s,json_each(s.value) v WHERE s.key IN ('departmentIds','objectIds') AND (v.type<>'text' OR length(trim(v.value))=0))
 OR EXISTS(SELECT 1 FROM json_each(a.value) field WHERE field.key NOT IN ('roleCode','scope','effectiveFrom','effectiveTo','reason')));
INSERT INTO _organization_cutover_guard
 WITH derived(code) AS (
 SELECT 'technician' FROM _staff_cutover_decisions WHERE department_code='hardware'
 UNION SELECT 'exchange' FROM _staff_cutover_decisions WHERE exchange_from IS NOT NULL
 UNION SELECT 'repair_lead' FROM _staff_cutover_decisions WHERE
 (department_code='hardware' AND position_code IN ('head','deputy_head')) OR
 (department_code='device_station' AND position_code IN ('director','deputy_director')) OR
 (department_code='center' AND position_code IN ('president','vice_president'))
 UNION SELECT json_extract(a.value,'$.roleCode') FROM _staff_cutover_decisions d,json_each(d.authorizations) a
 ) SELECT 0 WHERE EXISTS(SELECT 1 FROM derived d LEFT JOIN roles r ON r.code=d.code WHERE r.id IS NULL OR r.enabled<>1 OR r.level>=3)
 OR EXISTS(SELECT 1 FROM derived d JOIN roles r ON r.code=d.code JOIN role_grants g ON g.role_id=r.id
 WHERE d.code IN ('technician','exchange') AND g.permission_code NOT IN
 ('repair.summary.read','repair.start','repair.finish.own','customer.identity.read','customer.contact.read','onsite.create','attendance.self','roster.read'));
INSERT INTO _organization_cutover_guard SELECT 0 WHERE
 EXISTS(SELECT 1 FROM departments WHERE code='design') AND EXISTS(SELECT 1 FROM departments WHERE code='art')
 OR EXISTS(SELECT 1 FROM departments WHERE code='promotion') AND EXISTS(SELECT 1 FROM departments WHERE code='publicity');
INSERT INTO _organization_cutover_guard
 WITH units(code) AS (
 SELECT department_code FROM _staff_cutover_decisions WHERE department_code IS NOT NULL
 UNION SELECT 'hardware' FROM _staff_cutover_decisions WHERE exchange_from IS NOT NULL
 ) SELECT 0 WHERE EXISTS(SELECT 1 FROM units u WHERE
 (u.code IN ('hardware','network','office') AND NOT EXISTS(SELECT 1 FROM departments d WHERE d.code=u.code AND d.enabled=1))
 OR EXISTS(SELECT 1 FROM departments d WHERE d.enabled=0 AND (d.code=u.code OR u.code='art' AND d.code='design' OR u.code='publicity' AND d.code='promotion')));
INSERT INTO audit_events(id,action,source_ref,before_json,after_json,reason,occurred_at)
 SELECT 'organization-code-'||id,'organization.code.normalized',json_object('module','organization','type','department','id',id),
 json_object('id',id,'code',code,'name',name,'enabled',enabled,'revision',revision),
 json_object('code',CASE code WHEN 'design' THEN 'art' ELSE 'publicity' END),
 '统一组织代码，保留原部门 ID 及全部历史引用',datetime('now') FROM departments WHERE code IN ('design','promotion');
UPDATE departments SET code='art' WHERE code='design';
UPDATE departments SET code='publicity' WHERE code='promotion';
ALTER TABLE departments ADD COLUMN kind TEXT NOT NULL DEFAULT 'department' CHECK(kind IN ('department','station','center'));
ALTER TABLE departments ADD COLUMN station_code TEXT;
UPDATE departments SET station_code=CASE code WHEN 'hardware' THEN 'device' WHEN 'network' THEN 'network' WHEN 'office' THEN 'affairs' WHEN 'art' THEN 'affairs' WHEN 'publicity' THEN 'affairs' END;
INSERT INTO departments(id,code,name,kind,station_code)
 SELECT 'dept-art','art','美工部','department','affairs' WHERE NOT EXISTS(SELECT 1 FROM departments WHERE code='art');
INSERT INTO departments(id,code,name,kind,station_code)
 SELECT 'dept-publicity','publicity','推广部','department','affairs' WHERE NOT EXISTS(SELECT 1 FROM departments WHERE code='publicity');
INSERT INTO departments(id,code,name,kind,station_code) VALUES
 ('unit-device','device_station','设备服务站','station','device'),('unit-network','network_station','网络技术站','station','network'),
 ('unit-affairs','affairs_station','基础事务站','station','affairs'),('unit-center','center','先锋网络中心','center',NULL);
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'organization-archive-'||mm.id,'organization.membership.archived',json_object('module','identity','type','member','id',mm.member_id),
 json_object('id',mm.id,'memberId',mm.member_id,'departmentId',mm.department_id,'departmentCode',d.code,'departmentName',d.name,
 'assignmentType',mm.assignment_type,'isPrimary',mm.is_primary,'effectiveFrom',mm.effective_from,'effectiveTo',mm.effective_to,'revision',mm.revision,'createdAt',mm.created_at),
 '旧任职完整归档；当前任职按私有核对决定转换',datetime('now')
 FROM member_department_memberships mm JOIN departments d ON d.id=mm.department_id;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'authorization-archive-'||mr.id,'authorization.binding.archived',json_object('module','identity','type','member','id',mr.member_id),
 json_object('id',mr.id,'memberId',mr.member_id,'roleId',mr.role_id,'scope',json(mr.scope_bindings),
 'effectiveFrom',mr.effective_from,'effectiveTo',mr.effective_to,'revision',mr.revision),
 '旧角色完整归档；当前权限按私有核对的任职、特殊授权或明确撤权决定转换',datetime('now') FROM member_roles mr;
INSERT INTO audit_events(id,action,source_ref,before_json,after_json,reason,occurred_at)
 SELECT 'qualification-archive-'||id,'identity.qualification.archived',json_object('module','identity','type','member','id',member_id),
 json_object('id',id,'memberId',member_id,'profileCode',profile_code,'effectiveFrom',effective_from,'effectiveTo',effective_to,'revision',revision),
 NULL,'工作资格历史归档；当前权限由任职及特殊授权计算',datetime('now') FROM member_work_profiles;

CREATE TABLE _organization_old_bindings AS SELECT * FROM member_roles;
DROP TRIGGER staff_account_member_sync;
DROP TRIGGER activation_approve;
DROP TABLE member_department_memberships;
CREATE TABLE member_department_memberships (
 id TEXT PRIMARY KEY,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 department_id TEXT NOT NULL REFERENCES departments(id),
 assignment_type TEXT NOT NULL DEFAULT 'primary' CHECK(assignment_type IN ('primary','exchange')),
 is_primary INTEGER NOT NULL DEFAULT 1 CHECK(is_primary IN (0,1)),
 effective_from TEXT NOT NULL,
 effective_to TEXT,
 revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
 created_at TEXT NOT NULL,
 position_code TEXT NOT NULL DEFAULT 'member' CHECK(position_code IN ('member','deputy_head','head','deputy_director','director','vice_president','president')),
 CHECK(effective_to IS NULL OR effective_to>effective_from),
 CHECK((assignment_type='primary' AND is_primary=1) OR (assignment_type='exchange' AND is_primary=0 AND position_code='member'))
);
CREATE INDEX idx_membership_member_time ON member_department_memberships(member_id,effective_from,effective_to);
CREATE UNIQUE INDEX idx_membership_primary_open ON member_department_memberships(member_id) WHERE is_primary=1 AND effective_to IS NULL;
CREATE TRIGGER membership_primary_overlap_guard BEFORE INSERT ON member_department_memberships WHEN NEW.is_primary=1 BEGIN
 SELECT RAISE(ABORT,'PRIMARY_MEMBERSHIP_OVERLAP') WHERE EXISTS(SELECT 1 FROM member_department_memberships old
 WHERE old.member_id=NEW.member_id AND old.is_primary=1 AND (old.effective_to IS NULL OR NEW.effective_from<old.effective_to)
 AND (NEW.effective_to IS NULL OR old.effective_from<NEW.effective_to));
END;
CREATE TRIGGER membership_primary_update_guard BEFORE UPDATE OF member_id,is_primary,effective_from,effective_to ON member_department_memberships WHEN NEW.is_primary=1 BEGIN
 SELECT RAISE(ABORT,'PRIMARY_MEMBERSHIP_OVERLAP') WHERE EXISTS(SELECT 1 FROM member_department_memberships old
 WHERE old.member_id=NEW.member_id AND old.is_primary=1 AND old.id<>NEW.id AND (old.effective_to IS NULL OR NEW.effective_from<old.effective_to)
 AND (NEW.effective_to IS NULL OR old.effective_from<NEW.effective_to));
END;
DROP TABLE member_roles;
CREATE TABLE member_roles (
 id TEXT PRIMARY KEY,
 member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
 role_id TEXT NOT NULL REFERENCES roles(id),
 scope_bindings TEXT NOT NULL DEFAULT '{}',
 effective_from TEXT NOT NULL,
 effective_to TEXT,
 revision INTEGER NOT NULL DEFAULT 0,
 reason TEXT NOT NULL DEFAULT '',
 CHECK(effective_to IS NULL OR effective_to>effective_from)
);
CREATE INDEX idx_member_roles_active ON member_roles(member_id,effective_from,effective_to);
INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from,effective_to,revision,reason)
 SELECT mr.id,mr.member_id,mr.role_id,mr.scope_bindings,mr.effective_from,mr.effective_to,mr.revision,'受保护系统账号'
 FROM _organization_old_bindings mr JOIN roles r ON r.id=mr.role_id AND r.code='superadmin'
 WHERE EXISTS(SELECT 1 FROM staff_accounts sa WHERE sa.member_id=mr.member_id AND sa.protected=1);

INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,effective_to,created_at)
 SELECT 'cutover-post-'||c.member_id,c.member_id,d.id,'primary',1,c.position_code,c.effective_from,c.effective_to,datetime('now')
 FROM _staff_cutover_decisions c JOIN departments d ON d.code=c.department_code WHERE c.decision='migrate';
INSERT INTO member_department_memberships(id,member_id,department_id,assignment_type,is_primary,position_code,effective_from,effective_to,created_at)
 SELECT 'cutover-exchange-'||c.member_id,c.member_id,d.id,'exchange',0,'member',c.exchange_from,c.exchange_to,datetime('now')
 FROM _staff_cutover_decisions c JOIN departments d ON d.code='hardware' WHERE c.decision='migrate' AND c.exchange_from IS NOT NULL;
INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from,effective_to,reason)
 SELECT 'cutover-authorization-'||d.member_id||'-'||a.key,d.member_id,r.id,json_extract(a.value,'$.scope'),
 json_extract(a.value,'$.effectiveFrom'),json_extract(a.value,'$.effectiveTo'),json_extract(a.value,'$.reason')
 FROM _staff_cutover_decisions d,json_each(d.authorizations) a JOIN roles r ON r.code=json_extract(a.value,'$.roleCode') WHERE d.decision='migrate';
INSERT INTO audit_events(id,action,source_ref,after_json,reason,occurred_at)
 SELECT 'organization-confirmation-'||d.member_id,'organization.cutover.confirmed',json_object('module','identity','type','member','id',d.member_id),
 json_object('decision',d.decision,'departmentCode',d.department_code,'positionCode',d.position_code,'effectiveFrom',d.effective_from,'effectiveTo',d.effective_to,
 'exchangeFrom',d.exchange_from,'exchangeTo',d.exchange_to,'authorizations',json(d.authorizations),'preparedAt',b.prepared_at),d.reason,datetime('now')
 FROM _staff_cutover_decisions d CROSS JOIN _staff_cutover_batch b;
CREATE VIEW effective_member_roles AS
 SELECT id,member_id,role_id,scope_bindings,effective_from,effective_to,revision,reason,'explicit' AS source FROM member_roles
 UNION ALL
 SELECT 'organization-'||mm.id||'-'||r.code,mm.member_id,r.id,'{"campuses":"bound"}',mm.effective_from,mm.effective_to,mm.revision,'','organization'
 FROM member_department_memberships mm JOIN departments d ON d.id=mm.department_id AND d.enabled=1
 JOIN roles r ON
 (r.code='technician' AND mm.assignment_type='primary' AND mm.is_primary=1 AND d.code='hardware' AND mm.position_code IN ('member','deputy_head','head')) OR
 (r.code='exchange' AND mm.assignment_type='exchange' AND mm.is_primary=0 AND d.code='hardware') OR
 (r.code='repair_lead' AND mm.assignment_type='primary' AND mm.is_primary=1 AND
 ((d.code='hardware' AND mm.position_code IN ('deputy_head','head')) OR
 (d.code='device_station' AND mm.position_code IN ('deputy_director','director')) OR
 (d.code='center' AND mm.position_code IN ('vice_president','president'))));

DROP TABLE _organization_old_bindings;
DROP VIEW _staff_cutover_current;
DROP TABLE _staff_cutover_decisions;
DROP TABLE _staff_cutover_batch;
DROP TABLE _organization_cutover_guard;
CREATE TRIGGER staff_account_member_sync AFTER INSERT ON staff_accounts WHEN NEW.member_id IS NULL
BEGIN
 INSERT OR IGNORE INTO members(id,name,student_id,home_campus_id,status,created_at,updated_at)
 VALUES('member-'||NEW.account,NEW.name,CASE WHEN NEW.account GLOB '[0-9]*' THEN NEW.account ELSE NULL END,
 CASE NEW.home_campus WHEN '南湖' THEN 'campus-nanhu' WHEN '浑南' THEN 'campus-hunnan' END,
 CASE NEW.status WHEN 'enabled' THEN 'active' ELSE 'inactive' END,NEW.created_at,NEW.created_at);
 -- Only protected system accounts retain an independent system identity.
 INSERT INTO member_roles(id,member_id,role_id,scope_bindings,effective_from,reason)
 SELECT 'member-role-'||NEW.account,'member-'||NEW.account,r.id,'{"all":true}',substr(NEW.created_at,1,10),'受保护系统账号'
 FROM roles r WHERE r.code='superadmin' AND NEW.protected=1 AND changes()>0;
 UPDATE staff_accounts SET member_id='member-'||NEW.account WHERE account=NEW.account AND member_id IS NULL;
END;
CREATE TRIGGER activation_approve AFTER UPDATE OF status ON activation_requests
WHEN OLD.status='pending' AND NEW.status='approved'
BEGIN
 SELECT RAISE(ABORT,'ACTIVATION_CONFLICT') WHERE NOT EXISTS(SELECT 1 FROM staff_whitelist WHERE student_id=NEW.student_id AND status='open'
 AND (expected_name='' OR expected_name=NEW.name)) OR NOT EXISTS(SELECT 1 FROM whitelist_campus_grants WHERE student_id=NEW.student_id);
 SELECT RAISE(ABORT,'ACTIVATION_QUALIFICATION_CHANGED') WHERE NOT EXISTS(
 SELECT 1 FROM activation_member_bindings b JOIN members m ON m.id=b.member_id AND m.status='active'
 JOIN effective_member_roles mr ON mr.member_id=m.id JOIN roles r ON r.id=mr.role_id AND r.enabled=1 AND r.code<>'superadmin'
 JOIN role_grants rg ON rg.role_id=r.id JOIN permission_definitions pd ON pd.code=rg.permission_code AND pd.enabled=1
 WHERE b.student_id=NEW.student_id AND mr.effective_from<=date(NEW.reviewed_at,'+8 hours') AND (mr.effective_to IS NULL OR mr.effective_to>date(NEW.reviewed_at,'+8 hours')));
 INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,member_id)
 SELECT NEW.student_id,NEW.name,expected_role,NEW.home_campus,NEW.password_hash,NEW.reviewed_at,b.member_id
 FROM staff_whitelist w JOIN activation_member_bindings b ON b.student_id=w.student_id WHERE w.student_id=NEW.student_id;
 INSERT INTO staff_campus_grants(account,campus) SELECT NEW.student_id,campus FROM whitelist_campus_grants WHERE student_id=NEW.student_id;
 UPDATE staff_whitelist SET status='activated',revision=revision+1 WHERE student_id=NEW.student_id;
 UPDATE activation_requests SET password_hash='' WHERE id=NEW.id;
END;
DROP TABLE member_work_profiles;

-- Database-side invalidation also protects direct changes and shared templates.
CREATE TRIGGER organization_authorization_insert AFTER INSERT ON member_department_memberships BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=NEW.member_id;
END;
CREATE TRIGGER organization_authorization_update AFTER UPDATE ON member_department_memberships BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (OLD.member_id,NEW.member_id);
END;
CREATE TRIGGER organization_authorization_delete AFTER DELETE ON member_department_memberships BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=OLD.member_id;
END;
CREATE TRIGGER campus_authorization_insert AFTER INSERT ON staff_campus_grants BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1,revision=revision+1 WHERE account=NEW.account;
END;
CREATE TRIGGER campus_authorization_delete AFTER DELETE ON staff_campus_grants BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1,revision=revision+1 WHERE account=OLD.account;
END;
CREATE TRIGGER campus_authorization_update AFTER UPDATE ON staff_campus_grants BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1,revision=revision+1 WHERE account IN (OLD.account,NEW.account);
END;
CREATE TRIGGER explicit_authorization_insert AFTER INSERT ON member_roles BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=NEW.member_id;
END;
CREATE TRIGGER explicit_authorization_update AFTER UPDATE ON member_roles BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (OLD.member_id,NEW.member_id);
END;
CREATE TRIGGER explicit_authorization_delete AFTER DELETE ON member_roles BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id=OLD.member_id;
END;
CREATE TRIGGER template_authorization_insert AFTER INSERT ON role_grants BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (SELECT member_id FROM effective_member_roles WHERE role_id=NEW.role_id);
END;
CREATE TRIGGER template_authorization_update AFTER UPDATE ON role_grants BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (SELECT member_id FROM effective_member_roles WHERE role_id IN (OLD.role_id,NEW.role_id));
END;
CREATE TRIGGER template_authorization_delete AFTER DELETE ON role_grants BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (SELECT member_id FROM effective_member_roles WHERE role_id=OLD.role_id);
END;
CREATE TRIGGER role_authorization_update AFTER UPDATE ON roles BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (SELECT member_id FROM effective_member_roles WHERE role_id=NEW.id);
END;
CREATE TRIGGER department_authorization_update AFTER UPDATE ON departments BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (SELECT member_id FROM member_department_memberships WHERE department_id=NEW.id);
END;
-- Previously imported invitations already point at their real member. Match
-- only exact student IDs for older invitations; never create organization facts.
INSERT OR IGNORE INTO activation_member_bindings(student_id,member_id)
 SELECT w.student_id,m.id FROM staff_whitelist w JOIN members m ON m.student_id=w.student_id WHERE w.status<>'activated';
UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1;
INSERT INTO staff_release_markers VALUES('organization-permissions-0042',datetime('now'));
