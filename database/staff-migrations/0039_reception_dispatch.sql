-- Arrival and dispatch are separate from the five appointment statuses.
-- Historical appointments are unchanged; only explicitly received orders enter this workflow.
CREATE TABLE repair_receptions (
  appointment_id TEXT PRIMARY KEY REFERENCES appointments(id) ON UPDATE CASCADE ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('queued','assigned','started','closed')),
  received_at TEXT NOT NULL,
  received_by TEXT NOT NULL REFERENCES staff_accounts(account),
  assigned_to TEXT REFERENCES staff_accounts(account),
  assigned_member_id TEXT REFERENCES members(id),
  updated_at TEXT NOT NULL,
  CHECK((state='assigned' AND assigned_to IS NOT NULL AND assigned_member_id IS NOT NULL) OR state<>'assigned')
);
CREATE UNIQUE INDEX idx_one_pending_dispatch ON repair_receptions(assigned_member_id) WHERE state='assigned';
CREATE INDEX idx_reception_queue ON repair_receptions(state,received_at,appointment_id);

CREATE TRIGGER reception_assignment_insert BEFORE INSERT ON repair_receptions WHEN NEW.state='assigned'
BEGIN
  SELECT RAISE(ABORT,'SERVICE_DAY_PAUSED') WHERE EXISTS(SELECT 1 FROM service_day_overrides s JOIN campuses c ON c.id=s.campus_id JOIN appointments a ON a.campus=c.name WHERE a.id=NEW.appointment_id AND s.paused=1 AND s.business_date=date(NEW.updated_at,'+8 hours'));
  SELECT RAISE(ABORT,'ACTIVE_REPAIR_EXISTS') WHERE EXISTS(SELECT 1 FROM active_repairs WHERE member_id=NEW.assigned_member_id);
  SELECT RAISE(ABORT,'DISPATCH_ACCOUNT_MISMATCH') WHERE NOT EXISTS(SELECT 1 FROM staff_accounts WHERE account=NEW.assigned_to AND member_id=NEW.assigned_member_id AND status='enabled');
END;
CREATE TRIGGER reception_assignment_update BEFORE UPDATE ON repair_receptions WHEN NEW.state='assigned'
BEGIN
  SELECT RAISE(ABORT,'SERVICE_DAY_PAUSED') WHERE EXISTS(SELECT 1 FROM service_day_overrides s JOIN campuses c ON c.id=s.campus_id JOIN appointments a ON a.campus=c.name WHERE a.id=NEW.appointment_id AND s.paused=1 AND s.business_date=date(NEW.updated_at,'+8 hours'));
  SELECT RAISE(ABORT,'ACTIVE_REPAIR_EXISTS') WHERE EXISTS(SELECT 1 FROM active_repairs WHERE member_id=NEW.assigned_member_id);
  SELECT RAISE(ABORT,'DISPATCH_ACCOUNT_MISMATCH') WHERE NOT EXISTS(SELECT 1 FROM staff_accounts WHERE account=NEW.assigned_to AND member_id=NEW.assigned_member_id AND status='enabled');
END;
CREATE TRIGGER reception_arrival_guard BEFORE INSERT ON repair_receptions
WHEN NEW.state='queued' AND NOT EXISTS(SELECT 1 FROM repair_receptions r WHERE r.appointment_id=NEW.appointment_id AND r.state IN ('queued','assigned') AND r.received_at=NEW.received_at)
BEGIN
  SELECT RAISE(ABORT,'SERVICE_DAY_PAUSED') WHERE EXISTS(SELECT 1 FROM service_day_overrides s JOIN campuses c ON c.id=s.campus_id JOIN appointments a ON a.campus=c.name WHERE a.id=NEW.appointment_id AND s.paused=1 AND s.business_date=date(NEW.received_at,'+8 hours'));
END;
CREATE TRIGGER reception_start_guard BEFORE UPDATE OF status,assigned_to ON appointments WHEN NEW.status='in_progress'
BEGIN
  SELECT RAISE(ABORT,'DISPATCH_RESERVED') WHERE EXISTS(SELECT 1 FROM repair_receptions r JOIN staff_accounts sa ON sa.member_id=r.assigned_member_id WHERE r.state='assigned' AND sa.account=NEW.assigned_to AND r.appointment_id<>NEW.id);
  SELECT RAISE(ABORT,'DISPATCH_OTHER_OWNER') WHERE EXISTS(SELECT 1 FROM repair_receptions r WHERE r.appointment_id=NEW.id AND r.state='assigned' AND r.assigned_member_id<>(SELECT member_id FROM staff_accounts WHERE account=NEW.assigned_to));
END;
CREATE TRIGGER reception_presence_guard BEFORE UPDATE OF state ON staff_presence
WHEN NEW.state<>'available' AND EXISTS(SELECT 1 FROM repair_receptions WHERE assigned_member_id=NEW.member_id AND state='assigned')
BEGIN
  SELECT RAISE(ABORT,'PRESENCE_BUSY');
END;
CREATE TRIGGER reception_status_sync AFTER UPDATE OF status ON appointments
WHEN NEW.status<>'booked'
BEGIN
  UPDATE repair_receptions SET state=CASE WHEN NEW.status='in_progress' THEN 'started' ELSE 'closed' END,
    updated_at=COALESCE(NEW.completed_at,NEW.started_at,updated_at) WHERE appointment_id=NEW.id;
END;

INSERT INTO permission_definitions(code,module_code,name,description,scope_kinds,condition_kinds,sensitive)
SELECT 'repair.receive','repairs','到场接待','核验设备并加入现场队列',scope_kinds,condition_kinds,0 FROM permission_definitions WHERE code='onsite.frontdesk.create';
INSERT INTO permission_definitions(code,module_code,name,description,scope_kinds,condition_kinds,sensitive)
SELECT 'repair.dispatch','repairs','分派待维修工单','将现场工单分派给空闲人员或撤回分派',scope_kinds,condition_kinds,0 FROM permission_definitions WHERE code='repair.transfer';
INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec,validity_spec)
SELECT 'receive-'||id,role_id,'repair.receive',scope_spec,condition_spec,validity_spec FROM role_grants g WHERE permission_code IN ('onsite.frontdesk.create','repair.transfer') AND (permission_code='repair.transfer' OR NOT EXISTS(SELECT 1 FROM role_grants lead WHERE lead.role_id=g.role_id AND lead.permission_code='repair.transfer'));
INSERT INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec,validity_spec)
SELECT 'dispatch-'||id,role_id,'repair.dispatch',scope_spec,condition_spec,validity_spec FROM role_grants g WHERE permission_code IN ('onsite.frontdesk.create','repair.transfer') AND (permission_code='repair.transfer' OR NOT EXISTS(SELECT 1 FROM role_grants lead WHERE lead.role_id=g.role_id AND lead.permission_code='repair.transfer'));
INSERT INTO staff_release_markers(id,applied_at) VALUES('reception-dispatch-0039',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
