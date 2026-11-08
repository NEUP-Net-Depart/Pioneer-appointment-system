-- Real appointments, membership, attendance and audit facts are retained in place.
DROP TRIGGER activation_approve;
DROP TRIGGER template_authorization_insert;
DROP TRIGGER template_authorization_update;
DROP TRIGGER template_authorization_delete;
DROP TRIGGER role_authorization_update;
DROP VIEW effective_member_roles;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-identity-roles-'||id,'identity.authorization.archived',json_object('module','identity','type','roles','id',id),json_object('id',id,'code',code,'name',name,'description',description,'level',level,'enabled',enabled,'revision',revision,'created_at',created_at,'updated_at',updated_at),
 '任职直接决定身份和管理范围；废止独立维修资格权限包',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM roles WHERE code IN ('technician','exchange','office','repair_lead','office_lead');
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-identity-member_roles-'||id,'identity.authorization.archived',json_object('module','identity','type','member_roles','id',id),json_object('id',id,'member_id',member_id,'role_id',role_id,'scope_bindings',scope_bindings,'effective_from',effective_from,'effective_to',effective_to,'revision',revision,'reason',reason),
 '任职直接决定身份和管理范围；废止独立维修资格权限包',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM member_roles WHERE role_id IN (SELECT id FROM roles WHERE code IN ('technician','exchange','office','repair_lead','office_lead'));
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
 SELECT 'v12-identity-role_grants-'||id,'identity.authorization.archived',json_object('module','identity','type','role_grants','id',id),json_object('id',id,'role_id',role_id,'permission_code',permission_code,'scope_spec',scope_spec,'condition_spec',condition_spec,'validity_spec',validity_spec,'revision',revision),
 '任职直接决定身份和管理范围；废止独立维修资格权限包',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM role_grants WHERE role_id IN (SELECT id FROM roles WHERE code IN ('technician','exchange','office','repair_lead','office_lead')) OR permission_code IN ('repair.summary.read','repair.start','repair.receive','repair.finish.own','repair.transfer','customer.identity.read','customer.contact.read','onsite.create','onsite.frontdesk.create','members.manage','repair.correct','statistics.read','roster.repair.manage','roster.repair.configure','roster.office.manage','leave.review','attendance.session.manage','attendance.correct','attendance.export','roster.read','attendance.self');
DELETE FROM member_roles WHERE role_id IN (SELECT id FROM roles WHERE code IN ('technician','exchange','office','repair_lead','office_lead'));
DELETE FROM role_grants WHERE role_id IN (SELECT id FROM roles WHERE code IN ('technician','exchange','office','repair_lead','office_lead')) OR permission_code IN ('repair.summary.read','repair.start','repair.receive','repair.finish.own','repair.transfer','customer.identity.read','customer.contact.read','onsite.create','onsite.frontdesk.create','members.manage','repair.correct','statistics.read','roster.repair.manage','roster.repair.configure','roster.office.manage','leave.review','attendance.session.manage','attendance.correct','attendance.export','roster.read','attendance.self');
DELETE FROM roles WHERE code IN ('technician','exchange','office','repair_lead','office_lead');
CREATE TRIGGER activation_approve AFTER UPDATE OF status ON activation_requests
WHEN OLD.status='pending' AND NEW.status='approved'
BEGIN
 SELECT RAISE(ABORT,'ACTIVATION_CONFLICT') WHERE NOT EXISTS(SELECT 1 FROM staff_whitelist WHERE student_id=NEW.student_id AND status='open'
 AND (expected_name='' OR expected_name=NEW.name)) OR NOT EXISTS(SELECT 1 FROM whitelist_campus_grants WHERE student_id=NEW.student_id);
 SELECT RAISE(ABORT,'ACTIVATION_MEMBER_CHANGED') WHERE NOT EXISTS(
 SELECT 1 FROM activation_member_bindings b JOIN members m ON m.id=b.member_id AND m.status='active' WHERE b.student_id=NEW.student_id);
 INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at,member_id)
 SELECT NEW.student_id,NEW.name,expected_role,NEW.home_campus,NEW.password_hash,NEW.reviewed_at,b.member_id
 FROM staff_whitelist w JOIN activation_member_bindings b ON b.student_id=w.student_id WHERE w.student_id=NEW.student_id;
 INSERT INTO staff_campus_grants(account,campus) SELECT NEW.student_id,campus FROM whitelist_campus_grants WHERE student_id=NEW.student_id;
 UPDATE staff_whitelist SET status='activated',revision=revision+1 WHERE student_id=NEW.student_id;
 UPDATE activation_requests SET password_hash='' WHERE id=NEW.id;
END;
CREATE TRIGGER template_authorization_insert AFTER INSERT ON role_grants BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (SELECT member_id FROM member_roles WHERE role_id=NEW.role_id);
END;
CREATE TRIGGER template_authorization_update AFTER UPDATE ON role_grants BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (SELECT member_id FROM member_roles WHERE role_id IN (OLD.role_id,NEW.role_id));
END;
CREATE TRIGGER template_authorization_delete AFTER DELETE ON role_grants BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (SELECT member_id FROM member_roles WHERE role_id=OLD.role_id);
END;
CREATE TRIGGER role_authorization_update AFTER UPDATE ON roles BEGIN
 UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1 WHERE member_id IN (SELECT member_id FROM member_roles WHERE role_id=NEW.id);
END;
CREATE VIEW staff_access_campuses AS
 SELECT account,campus FROM staff_campus_grants
 UNION SELECT s.account,c.name FROM staff_accounts s CROSS JOIN campuses c
 WHERE EXISTS(SELECT 1 FROM member_department_memberships mm JOIN departments d ON d.id=mm.department_id AND d.enabled=1
 WHERE mm.member_id=s.member_id AND mm.is_primary=1 AND mm.position_code IN ('deputy_director','director','vice_president','president')
 AND mm.effective_from<=date('now','+8 hours') AND (mm.effective_to IS NULL OR mm.effective_to>date('now','+8 hours')));

DROP TRIGGER repair_link_insert;
CREATE TRIGGER repair_link_insert BEFORE INSERT ON appointments WHEN NEW.parent_appointment_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'REPAIR_LINK_INVALID') WHERE NEW.id=NEW.parent_appointment_id OR NEW.link_kind IS NULL OR NEW.link_kind NOT IN ('continuation','recurrence')
 OR NOT EXISTS(SELECT 1 FROM appointments p WHERE p.id=NEW.parent_appointment_id AND p.status='completed' AND p.student_id=NEW.student_id)
 OR NOT EXISTS(SELECT 1 FROM staff_access_campuses g JOIN appointments p ON p.campus=g.campus WHERE p.id=NEW.parent_appointment_id AND g.account=NEW.linked_by)
 OR NOT EXISTS(SELECT 1 FROM staff_access_campuses g WHERE g.campus=NEW.campus AND g.account=NEW.linked_by)
 OR NOT EXISTS(SELECT 1 FROM staff_accounts s JOIN members m ON m.id=s.member_id WHERE s.account=NEW.linked_by AND s.status='enabled' AND m.status='active');
END;
DROP TRIGGER repair_link_update;
CREATE TRIGGER repair_link_update BEFORE UPDATE OF parent_appointment_id,link_kind ON appointments WHEN NEW.parent_appointment_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'REPAIR_LINK_INVALID') WHERE OLD.parent_appointment_id IS NOT NULL OR NEW.id=NEW.parent_appointment_id
 OR NEW.status NOT IN ('booked','in_progress') OR NEW.link_kind IS NULL OR NEW.link_kind NOT IN ('continuation','recurrence')
 OR NOT EXISTS(SELECT 1 FROM appointments p WHERE p.id=NEW.parent_appointment_id AND p.status='completed' AND p.student_id=NEW.student_id)
 OR NOT EXISTS(SELECT 1 FROM staff_access_campuses g JOIN appointments p ON p.campus=g.campus WHERE p.id=NEW.parent_appointment_id AND g.account=NEW.linked_by)
 OR NOT EXISTS(SELECT 1 FROM staff_access_campuses g WHERE g.campus=NEW.campus AND g.account=NEW.linked_by)
 OR NOT EXISTS(SELECT 1 FROM staff_accounts s JOIN members m ON m.id=s.member_id WHERE s.account=NEW.linked_by AND s.status='enabled' AND m.status='active');
END;
UPDATE staff_accounts SET token_version=token_version+1,auth_version=auth_version+1;
INSERT INTO staff_release_markers VALUES('membership-identity-0047',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
