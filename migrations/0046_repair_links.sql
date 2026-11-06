-- Replace request/approval/scheduling with a direct relation between services.
ALTER TABLE appointments ADD COLUMN parent_appointment_id TEXT REFERENCES appointments(id);
ALTER TABLE appointments ADD COLUMN link_kind TEXT CHECK(link_kind IN ('continuation','recurrence','historical'));
ALTER TABLE appointments ADD COLUMN linked_by TEXT REFERENCES staff_accounts(account);
ALTER TABLE appointments ADD COLUMN linked_at TEXT;
CREATE INDEX idx_appointment_parent ON appointments(parent_appointment_id);
INSERT INTO audit_events(id,action,source_ref,before_json,after_json,reason,occurred_at)
SELECT 'v12-followup-'||id,'repairs.followup.migrated',json_object('module','repairs','type','appointment','id',parent_appointment_id),
json_object('id',id,'parentAppointmentId',parent_appointment_id,'status',status,'requestSource',request_source,
 'reason',reason,'requestId',request_id,'requestHash',request_hash,'requestedBy',requested_by,'requestedAt',requested_at,
 'scheduledAppointmentId',scheduled_appointment_id,'scheduledBy',scheduled_by,'scheduledAt',scheduled_at,
 'resolvedBy',resolved_by,'resolvedAt',resolved_at,'resolutionNote',resolution_note,'decisionRequestId',decision_request_id,'decisionHash',decision_hash,'revision',revision),
json_object('disposition',CASE status WHEN 'scheduled' THEN 'linked_service' WHEN 'pending' THEN 'archived_unplanned' ELSE 'archived_rejected' END),
'旧申请完整归档；已排期工单关联原单，未知到场日期不创建服务或后续安排任务',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM repair_followups;
UPDATE appointments SET parent_appointment_id=(SELECT parent_appointment_id FROM repair_followups WHERE scheduled_appointment_id=appointments.id),
 link_kind='historical',linked_by=(SELECT scheduled_by FROM repair_followups WHERE scheduled_appointment_id=appointments.id),
 linked_at=(SELECT scheduled_at FROM repair_followups WHERE scheduled_appointment_id=appointments.id)
WHERE id IN (SELECT scheduled_appointment_id FROM repair_followups WHERE status='scheduled');
UPDATE appointments SET registration_flow='frontdesk' WHERE registration_flow='repair_followup';
DROP TABLE repair_followups;
INSERT INTO audit_events(id,action,source_ref,before_json,reason,occurred_at)
SELECT 'v12-followup-grant-'||id,'authorization.retired',json_object('module','authorization','type','grant','id',id),
json_object('roleId',role_id,'permissionCode',permission_code,'scope',scope_spec,'conditions',condition_spec),
'移除返修审批权限',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM role_grants WHERE permission_code='repair.followup.manage';
DELETE FROM role_grants WHERE permission_code='repair.followup.manage';
DELETE FROM permission_definitions WHERE code='repair.followup.manage';
CREATE TRIGGER repair_link_insert BEFORE INSERT ON appointments WHEN NEW.parent_appointment_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'REPAIR_LINK_INVALID') WHERE NEW.id=NEW.parent_appointment_id OR NEW.link_kind IS NULL OR NEW.link_kind NOT IN ('continuation','recurrence')
 OR NOT EXISTS(SELECT 1 FROM appointments p WHERE p.id=NEW.parent_appointment_id AND p.status='completed' AND p.student_id=NEW.student_id)
 OR NOT EXISTS(SELECT 1 FROM staff_campus_grants g JOIN appointments p ON p.campus=g.campus WHERE p.id=NEW.parent_appointment_id AND g.account=NEW.linked_by)
 OR NOT EXISTS(SELECT 1 FROM staff_campus_grants g WHERE g.campus=NEW.campus AND g.account=NEW.linked_by)
 OR NOT EXISTS(SELECT 1 FROM staff_accounts s JOIN members m ON m.id=s.member_id WHERE s.account=NEW.linked_by AND s.status='enabled' AND m.status='active');
END;
CREATE TRIGGER repair_link_update BEFORE UPDATE OF parent_appointment_id,link_kind ON appointments WHEN NEW.parent_appointment_id IS NOT NULL BEGIN
 SELECT RAISE(ABORT,'REPAIR_LINK_INVALID') WHERE OLD.parent_appointment_id IS NOT NULL OR NEW.id=NEW.parent_appointment_id
 OR NEW.status NOT IN ('booked','in_progress') OR NEW.link_kind IS NULL OR NEW.link_kind NOT IN ('continuation','recurrence')
 OR NOT EXISTS(SELECT 1 FROM appointments p WHERE p.id=NEW.parent_appointment_id AND p.status='completed' AND p.student_id=NEW.student_id)
 OR NOT EXISTS(SELECT 1 FROM staff_campus_grants g JOIN appointments p ON p.campus=g.campus WHERE p.id=NEW.parent_appointment_id AND g.account=NEW.linked_by)
 OR NOT EXISTS(SELECT 1 FROM staff_campus_grants g WHERE g.campus=NEW.campus AND g.account=NEW.linked_by)
 OR NOT EXISTS(SELECT 1 FROM staff_accounts s JOIN members m ON m.id=s.member_id WHERE s.account=NEW.linked_by AND s.status='enabled' AND m.status='active');
END;
INSERT INTO staff_release_markers VALUES('repair-links-0046',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
