CREATE TABLE repair_followups (
  id TEXT PRIMARY KEY,
  parent_appointment_id TEXT NOT NULL REFERENCES appointments(id),
  status TEXT NOT NULL CHECK(status IN ('pending','scheduled','rejected')),
  request_source TEXT NOT NULL DEFAULT 'customer' CHECK(request_source IN ('customer','staff')),
  reason TEXT NOT NULL CHECK(length(reason) BETWEEN 2 AND 3000),
  request_id TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL CHECK(length(request_hash)=64),
  requested_by TEXT REFERENCES staff_accounts(account),
  requested_at TEXT NOT NULL,
  scheduled_appointment_id TEXT UNIQUE REFERENCES appointments(id),
  scheduled_by TEXT REFERENCES staff_accounts(account),
  scheduled_at TEXT,
  resolved_by TEXT REFERENCES staff_accounts(account),
  resolved_at TEXT,
  resolution_note TEXT NOT NULL DEFAULT '',
  decision_request_id TEXT UNIQUE,
  decision_hash TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  CHECK((request_source='customer' AND requested_by IS NULL) OR (request_source='staff' AND requested_by IS NOT NULL)),
  CHECK((status='pending' AND scheduled_appointment_id IS NULL AND scheduled_by IS NULL AND scheduled_at IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)
     OR (status='scheduled' AND scheduled_appointment_id IS NOT NULL AND scheduled_by IS NOT NULL AND scheduled_at IS NOT NULL AND resolved_by=scheduled_by AND resolved_at=scheduled_at)
     OR (status='rejected' AND scheduled_appointment_id IS NULL AND scheduled_by IS NULL AND scheduled_at IS NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)),
  CHECK((decision_request_id IS NULL AND decision_hash IS NULL) OR (decision_request_id IS NOT NULL AND length(decision_hash)=64))
);
CREATE INDEX idx_repair_followups_parent ON repair_followups(parent_appointment_id,requested_at,id);
CREATE INDEX idx_repair_followups_pending ON repair_followups(status,requested_at,id) WHERE status='pending';
CREATE UNIQUE INDEX idx_repair_followups_one_pending_parent ON repair_followups(parent_appointment_id) WHERE status='pending';

CREATE TRIGGER repair_followup_completed_parent_insert BEFORE INSERT ON repair_followups
BEGIN
  SELECT RAISE(ABORT,'FOLLOWUP_PARENT_NOT_COMPLETED') WHERE NOT EXISTS(
    SELECT 1 FROM appointments WHERE id=NEW.parent_appointment_id AND status='completed'
  );
END;

CREATE TRIGGER repair_followup_schedule_guard BEFORE UPDATE OF status,scheduled_appointment_id ON repair_followups
WHEN NEW.status='scheduled'
BEGIN
  SELECT RAISE(ABORT,'FOLLOWUP_APPOINTMENT_INVALID') WHERE NOT EXISTS(
    SELECT 1 FROM appointments child JOIN appointments parent ON parent.id=NEW.parent_appointment_id
    WHERE child.id=NEW.scheduled_appointment_id AND child.status='booked'
      AND child.source='onsite' AND child.registration_flow='repair_followup'
      AND child.student_id=parent.student_id AND child.campus=parent.campus
  );
END;

INSERT OR IGNORE INTO permission_definitions(code,module_code,name,description,scope_kinds,condition_kinds,sensitive)
VALUES ('repair.followup.manage','repairs','安排返修工单','查看待返修申请并安排至授权校区的维修时段','["campus"]','["activeDutyRole"]',1);

INSERT OR IGNORE INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec)
VALUES
 ('grant-office-repair-followup','role-office','repair.followup.manage','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1,"parameters":{"dutyType":"office"}}]'),
 ('grant-office-lead-repair-followup','role-office-lead','repair.followup.manage','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1,"parameters":{"dutyType":"office"}}]'),
 ('grant-repair-lead-repair-followup','role-repair-lead','repair.followup.manage','{"campuses":"bound"}','[]'),
 ('grant-superadmin-repair-followup','role-superadmin','repair.followup.manage','{"all":true}','[]');

INSERT OR IGNORE INTO staff_release_markers(id,applied_at)
VALUES ('repair-followups-0037',datetime('now'));
