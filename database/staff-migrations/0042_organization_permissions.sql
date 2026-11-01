-- Organization facts produce role bindings at read time. Old inferred posts are
-- retained for review, never treated as evidence of a real rank or department.
ALTER TABLE departments ADD COLUMN kind TEXT NOT NULL DEFAULT 'department' CHECK(kind IN ('department','station','center'));
ALTER TABLE departments ADD COLUMN station_code TEXT;
UPDATE departments SET station_code=CASE code WHEN 'hardware' THEN 'device' WHEN 'network' THEN 'network' WHEN 'office' THEN 'affairs' END;
INSERT INTO departments(id,code,name,kind,station_code) VALUES
 ('dept-art','art','美工部','department','affairs'),('dept-publicity','publicity','推广部','department','affairs'),
 ('unit-device','device_station','设备服务站','station','device'),('unit-network','network_station','网络技术站','station','network'),
 ('unit-affairs','affairs_station','基础事务站','station','affairs'),('unit-center','center','先锋网络中心','center',NULL);
ALTER TABLE member_department_memberships ADD COLUMN position_code TEXT NOT NULL DEFAULT 'unknown'
 CHECK(position_code IN ('unknown','member','deputy_head','head','deputy_director','director','president'));
ALTER TABLE member_department_memberships ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0 CHECK(needs_review IN (0,1));
UPDATE member_department_memberships SET needs_review=1;
ALTER TABLE member_roles ADD COLUMN reason TEXT NOT NULL DEFAULT '';
ALTER TABLE member_roles ADD COLUMN source TEXT NOT NULL DEFAULT 'explicit';
ALTER TABLE member_roles ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0 CHECK(needs_review IN (0,1));
-- NULL means a new, explicit participation grant. Arrays preserve the exact old
-- qualification intervals, including revocations, without a second live model.
ALTER TABLE member_roles ADD COLUMN participation_spec TEXT CHECK(participation_spec IS NULL OR (json_valid(participation_spec) AND json_type(participation_spec)='array'));
UPDATE member_roles SET participation_spec=(SELECT json_group_array(json_object('code',p.profile_code,'effectiveFrom',p.effective_from,'effectiveTo',p.effective_to))
 FROM member_work_profiles p WHERE p.member_id=member_roles.member_id),reason='历史显式授权迁移';
UPDATE member_roles SET source='legacy_review',needs_review=1,reason='旧系统默认编号曾用于此授权，来源及留任原因待核对'
WHERE EXISTS(SELECT 1 FROM staff_accounts sa WHERE sa.member_id=member_roles.member_id
 AND member_roles.id IN ('member-role-'||sa.account,'business-lead-'||sa.account,'business-technician-'||sa.account));

UPDATE member_roles SET source='legacy_default',reason='旧系统自动生成，组织职位及留任授权待核对'
WHERE source='legacy_review' AND revision=0 AND EXISTS(
 SELECT 1 FROM staff_accounts sa WHERE sa.member_id=member_roles.member_id AND
 ((member_roles.id='member-role-'||sa.account AND member_roles.role_id='role-technician' AND json(scope_bindings)='{"campuses":"bound"}') OR
  (member_roles.id='business-lead-'||sa.account AND member_roles.role_id='role-repair-lead') OR
  (member_roles.id='business-technician-'||sa.account AND member_roles.role_id='role-technician')));
UPDATE member_roles SET source='system',needs_review=0,reason='受保护系统账号'
WHERE role_id='role-superadmin' AND EXISTS(SELECT 1 FROM staff_accounts sa WHERE sa.member_id=member_roles.member_id AND sa.protected=1);

CREATE VIEW effective_member_roles AS
 SELECT id,member_id,role_id,scope_bindings,effective_from,effective_to,revision,reason,source,needs_review,participation_spec FROM member_roles
 UNION ALL
 SELECT 'organization-'||mm.id||'-'||r.code,mm.member_id,r.id,'{"campuses":"bound"}',mm.effective_from,mm.effective_to,mm.revision,
 '', 'organization',0,NULL
 FROM member_department_memberships mm JOIN departments d ON d.id=mm.department_id AND d.enabled=1
 JOIN roles r ON
   (r.code='technician' AND mm.assignment_type='primary' AND mm.is_primary=1 AND d.code='hardware' AND mm.position_code IN ('member','deputy_head','head')) OR
   (r.code='exchange' AND mm.assignment_type='exchange' AND mm.is_primary=0 AND d.code='hardware') OR
   (r.code='repair_lead' AND mm.assignment_type='primary' AND mm.is_primary=1 AND
    ((d.code='hardware' AND mm.position_code IN ('deputy_head','head')) OR
     (d.code='device_station' AND mm.position_code IN ('deputy_director','director')) OR
     (d.code='center' AND mm.position_code='president')))
 WHERE mm.needs_review=0;

-- Preserve the old qualification facts as immutable audit history before removal.
INSERT INTO audit_events(id,action,source_ref,before_json,after_json,reason,occurred_at)
 SELECT 'qualification-archive-'||id,'identity.qualification.archived',json_object('module','identity','type','member','id',member_id),
 json_object('id',id,'memberId',member_id,'profileCode',profile_code,'effectiveFrom',effective_from,'effectiveTo',effective_to,'revision',revision),
 NULL,'工作资格历史归档；当前权限由任职及特殊授权计算',datetime('now') FROM member_work_profiles;
DROP TRIGGER staff_account_member_sync;
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
DROP TRIGGER activation_approve;
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
