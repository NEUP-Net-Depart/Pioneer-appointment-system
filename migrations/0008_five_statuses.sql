-- Promote cancellation and expiration to primary states without changing historical identifiers or event times.

DROP TRIGGER appointment_active_insert;
DROP TRIGGER appointment_active_update;
DROP TRIGGER appointment_active_delete;
DROP TRIGGER appointment_capacity_insert;
DROP TRIGGER appointment_capacity_update;
DROP TRIGGER attachment_storage_release;
DROP TABLE active_repairs;

CREATE TABLE appointments_new (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL, name TEXT NOT NULL,
  college TEXT NOT NULL DEFAULT '', campus TEXT NOT NULL CHECK(campus IN ('南湖','浑南')),
  phone TEXT NOT NULL DEFAULT '', social TEXT NOT NULL,
  device_type TEXT NOT NULL, brand TEXT NOT NULL, device_model TEXT NOT NULL,
  serial TEXT NOT NULL DEFAULT '', warranty TEXT NOT NULL, fault_type TEXT NOT NULL,
  issue TEXT NOT NULL DEFAULT '', liquid_drop TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL, time_slot TEXT NOT NULL CHECK(time_slot IN ('19:00–20:00','20:00–21:00')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('booked','in_progress','completed','cancelled','expired')),
  outcome TEXT CHECK(outcome IN ('repaired','unrepaired','not_needed','legacy_unknown')),
  started_at TEXT, completed_at TEXT,
  expires_at TEXT NOT NULL CHECK(length(expires_at)=24 AND substr(expires_at,24,1)='Z' AND julianday(expires_at) IS NOT NULL),
  assigned_to TEXT REFERENCES staff_accounts(account), repair_note TEXT NOT NULL DEFAULT '',
  access_token_hash TEXT NOT NULL UNIQUE CHECK(length(access_token_hash)=64),
  credential_rotated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  agreement_at TEXT NOT NULL, agreement_version TEXT NOT NULL,
  signature TEXT NOT NULL DEFAULT '', repair_number TEXT,
  front_photo_id TEXT, back_photo_id TEXT,
  source TEXT NOT NULL DEFAULT 'booking' CHECK(source IN ('booking','onsite')),
  registered_by TEXT REFERENCES staff_accounts(account), registration_key TEXT,
  CHECK((status='completed' AND outcome IS NOT NULL) OR (status<>'completed' AND outcome IS NULL))
);

INSERT INTO appointments_new
  (id,student_id,name,college,campus,phone,social,device_type,brand,device_model,serial,warranty,fault_type,issue,liquid_drop,date,time_slot,note,status,outcome,started_at,completed_at,assigned_to,repair_note,access_token_hash,credential_rotated_at,revision,created_at,agreement_at,agreement_version,signature,repair_number,front_photo_id,back_photo_id,source,registered_by,registration_key,expires_at)
SELECT id,student_id,name,college,campus,phone,social,device_type,brand,device_model,serial,warranty,fault_type,issue,liquid_drop,date,time_slot,note,CASE WHEN status='completed' AND outcome='cancelled' THEN 'cancelled' WHEN status='completed' AND outcome IN ('no_show','expired') THEN 'expired' ELSE status END,CASE WHEN outcome IN ('cancelled','no_show','expired') THEN NULL ELSE outcome END,started_at,completed_at,assigned_to,repair_note,access_token_hash,credential_rotated_at,revision,created_at,agreement_at,agreement_version,signature,repair_number,front_photo_id,back_photo_id,source,registered_by,registration_key,date || 'T13:30:00.000Z'
FROM appointments;

CREATE TABLE appointment_attachments_new (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments_new(id),
  filename TEXT NOT NULL, mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size>0 AND size<=5242880),
  object_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'general', uploaded_by TEXT
);
INSERT INTO appointment_attachments_new SELECT * FROM appointment_attachments;

CREATE TABLE credential_recoveries_new (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments_new(id),
  actor TEXT NOT NULL REFERENCES staff_accounts(account), reason TEXT NOT NULL, created_at TEXT NOT NULL
);
INSERT INTO credential_recoveries_new SELECT * FROM credential_recoveries;

DROP TABLE appointment_attachments;
DROP TABLE credential_recoveries;
DROP TABLE appointments;
ALTER TABLE appointments_new RENAME TO appointments;
ALTER TABLE appointment_attachments_new RENAME TO appointment_attachments;
ALTER TABLE credential_recoveries_new RENAME TO credential_recoveries;

CREATE INDEX idx_active_queue ON appointments(date,campus,time_slot,created_at,id) WHERE status IN ('booked','in_progress');
CREATE INDEX idx_appointments_created ON appointments(created_at DESC,id DESC);
CREATE INDEX idx_appointments_assigned ON appointments(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_appointments_status ON appointments(status,date);
CREATE INDEX idx_appointments_fault ON appointments(fault_type);
CREATE UNIQUE INDEX idx_active_student_slot ON appointments(student_id,date,time_slot) WHERE status NOT IN ('cancelled','expired');
CREATE UNIQUE INDEX idx_repair_number ON appointments(repair_number);
CREATE UNIQUE INDEX idx_onsite_request ON appointments(registered_by,registration_key);
CREATE UNIQUE INDEX idx_one_pending_onsite_registration ON appointments(registered_by) WHERE source='onsite' AND status='booked' AND registered_by IS NOT NULL;
CREATE INDEX idx_booked_expiry ON appointments(expires_at,id) WHERE status='booked' AND started_at IS NULL;
CREATE INDEX idx_attachment_appointment ON appointment_attachments(appointment_id,created_at);
CREATE INDEX idx_attachment_expiry ON appointment_attachments(expires_at,id);

CREATE TABLE active_repairs (
  account TEXT PRIMARY KEY REFERENCES staff_accounts(account),
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE
);
INSERT INTO active_repairs(account,appointment_id)
SELECT assigned_to,MIN(id) FROM appointments
WHERE status='in_progress' AND assigned_to IS NOT NULL GROUP BY assigned_to;

CREATE TRIGGER appointment_active_insert AFTER INSERT ON appointments
WHEN NEW.status='in_progress'
BEGIN
  SELECT RAISE(ABORT,'ACTIVE_REPAIR_EXISTS') WHERE NEW.assigned_to IS NULL;
  INSERT INTO active_repairs(account,appointment_id) VALUES(NEW.assigned_to,NEW.id);
END;

CREATE TRIGGER appointment_active_update AFTER UPDATE OF status,assigned_to ON appointments
WHEN OLD.status<>NEW.status OR OLD.assigned_to IS NOT NEW.assigned_to
BEGIN
  DELETE FROM active_repairs WHERE appointment_id=OLD.id;
  INSERT INTO active_repairs(account,appointment_id)
    SELECT OLD.assigned_to,MIN(id) FROM appointments
    WHERE status='in_progress' AND assigned_to=OLD.assigned_to AND OLD.status='in_progress'
      AND (NEW.status<>'in_progress' OR OLD.assigned_to IS NOT NEW.assigned_to)
      AND NOT EXISTS(SELECT 1 FROM active_repairs WHERE account=OLD.assigned_to)
    HAVING COUNT(*)>0;
  SELECT RAISE(ABORT,'ACTIVE_REPAIR_EXISTS') WHERE NEW.status='in_progress' AND NEW.assigned_to IS NULL;
  INSERT INTO active_repairs(account,appointment_id)
    SELECT NEW.assigned_to,NEW.id WHERE NEW.status='in_progress'
      AND NOT (OLD.status='in_progress' AND OLD.assigned_to IS NEW.assigned_to);
END;

CREATE TRIGGER appointment_active_delete AFTER DELETE ON appointments
BEGIN
  INSERT INTO active_repairs(account,appointment_id)
    SELECT OLD.assigned_to,MIN(id) FROM appointments
    WHERE status='in_progress' AND assigned_to=OLD.assigned_to
      AND NOT EXISTS(SELECT 1 FROM active_repairs WHERE account=OLD.assigned_to)
    HAVING COUNT(*)>0;
END;

CREATE TRIGGER appointment_capacity_insert BEFORE INSERT ON appointments
WHEN NEW.source='booking' AND NEW.status<>'cancelled'
BEGIN
  SELECT RAISE(ABORT,'SLOT_PAUSED') WHERE (
    SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot
  ) = 0;
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE (
    SELECT COUNT(*) FROM appointments WHERE source='booking' AND date=NEW.date AND campus=NEW.campus
      AND time_slot=NEW.time_slot AND status<>'cancelled'
  ) >= COALESCE((SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot),10);
END;

CREATE TRIGGER appointment_capacity_update BEFORE UPDATE ON appointments
WHEN NEW.source='booking' AND NEW.status<>'cancelled' AND (
  (OLD.status='cancelled') OR (NEW.status='booked' AND OLD.status IN ('completed','expired')) OR NEW.date<>OLD.date
  OR NEW.campus<>OLD.campus OR NEW.time_slot<>OLD.time_slot OR OLD.source<>NEW.source
)
BEGIN
  SELECT RAISE(ABORT,'SLOT_PAUSED') WHERE (
    SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot
  ) = 0;
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE (
    SELECT COUNT(*) FROM appointments WHERE source='booking' AND date=NEW.date AND campus=NEW.campus
      AND time_slot=NEW.time_slot AND status<>'cancelled' AND id<>OLD.id
  ) >= COALESCE((SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot),10);
END;

CREATE TRIGGER attachment_storage_release AFTER DELETE ON attachment_storage
BEGIN
  DELETE FROM appointment_attachments WHERE id=OLD.id;
  UPDATE storage_quota SET used_bytes=used_bytes-OLD.size WHERE id=1;
END;

CREATE TABLE appointment_corrections (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments(id),
  actor TEXT NOT NULL REFERENCES staff_accounts(account),
  reason TEXT NOT NULL CHECK(length(reason)<=300),
  before_state TEXT NOT NULL, after_state TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_correction_appointment ON appointment_corrections(appointment_id,created_at,id);
