-- Breaking workflow migration: apply with the old API offline in a maintenance window.

-- Rebuild all referencing tables together; do not disable D1 foreign keys.

DROP TRIGGER attachment_storage_release;

CREATE TABLE appointments_new (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL, name TEXT NOT NULL,
  college TEXT NOT NULL DEFAULT '', campus TEXT NOT NULL CHECK(campus IN ('南湖','浑南')),
  phone TEXT NOT NULL DEFAULT '', social TEXT NOT NULL,
  device_type TEXT NOT NULL, brand TEXT NOT NULL, device_model TEXT NOT NULL,
  serial TEXT NOT NULL DEFAULT '', warranty TEXT NOT NULL, fault_type TEXT NOT NULL,
  issue TEXT NOT NULL DEFAULT '', liquid_drop TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL, time_slot TEXT NOT NULL CHECK(time_slot IN ('19:00–20:00','20:00–21:00')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('booked','in_progress','completed')),
  outcome TEXT CHECK(outcome IN ('repaired','unrepaired','not_needed','cancelled','no_show','legacy_unknown')),
  started_at TEXT, completed_at TEXT,
  assigned_to TEXT REFERENCES staff_accounts(account), repair_note TEXT NOT NULL DEFAULT '',
  access_token_hash TEXT NOT NULL UNIQUE CHECK(length(access_token_hash)=64),
  credential_rotated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  agreement_at TEXT NOT NULL, agreement_version TEXT NOT NULL,
  CHECK((status='completed' AND outcome IS NOT NULL) OR (status<>'completed' AND outcome IS NULL))
);

CREATE TABLE appointment_attachments_new (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments_new(id),
  filename TEXT NOT NULL, mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size>0 AND size<=5242880),
  object_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);

CREATE TABLE credential_recoveries_new (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments_new(id),
  actor TEXT NOT NULL REFERENCES staff_accounts(account), reason TEXT NOT NULL, created_at TEXT NOT NULL
);

INSERT INTO appointments_new(id,student_id,name,college,campus,phone,social,device_type,brand,device_model,serial,warranty,fault_type,issue,liquid_drop,date,time_slot,note,status,assigned_to,repair_note,access_token_hash,credential_rotated_at,revision,created_at,agreement_at,agreement_version,outcome,started_at,completed_at)
SELECT id,student_id,name,college,campus,phone,social,device_type,brand,device_model,serial,warranty,fault_type,issue,liquid_drop,date,time_slot,note,CASE WHEN status IN ('pending','awaiting_claim') THEN 'booked' WHEN status IN ('claimed','in_progress') THEN 'in_progress' ELSE 'completed' END,assigned_to,repair_note,access_token_hash,credential_rotated_at,revision,created_at,agreement_at,agreement_version,CASE status WHEN 'cancelled' THEN 'cancelled' WHEN 'no_show' THEN 'no_show' WHEN 'no_repair' THEN 'unrepaired' WHEN 'completed' THEN 'legacy_unknown' ELSE NULL END,NULL,NULL FROM appointments;

INSERT INTO appointment_attachments_new SELECT * FROM appointment_attachments;

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

CREATE UNIQUE INDEX idx_active_student_slot ON appointments(student_id,date,time_slot) WHERE status<>'completed' OR outcome NOT IN ('cancelled','no_show');

CREATE INDEX idx_attachment_appointment ON appointment_attachments(appointment_id,created_at);

CREATE INDEX idx_attachment_expiry ON appointment_attachments(expires_at,id);

CREATE TRIGGER appointment_capacity_insert BEFORE INSERT ON appointments
WHEN NOT (NEW.status='completed' AND NEW.outcome='cancelled')
BEGIN
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE (
    SELECT COUNT(*) FROM appointments WHERE date=NEW.date AND campus=NEW.campus
      AND time_slot=NEW.time_slot AND NOT (status='completed' AND outcome='cancelled')
  ) >= 10;
END;

CREATE TRIGGER appointment_capacity_update BEFORE UPDATE ON appointments
WHEN NOT (NEW.status='completed' AND NEW.outcome='cancelled') AND (
  (OLD.status='completed' AND OLD.outcome='cancelled') OR NEW.date<>OLD.date
  OR NEW.campus<>OLD.campus OR NEW.time_slot<>OLD.time_slot
)
BEGIN
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE (
    SELECT COUNT(*) FROM appointments WHERE date=NEW.date AND campus=NEW.campus
      AND time_slot=NEW.time_slot AND NOT (status='completed' AND outcome='cancelled') AND id<>OLD.id
  ) >= 10;
END;

CREATE TRIGGER attachment_storage_release AFTER DELETE ON attachment_storage
BEGIN
  DELETE FROM appointment_attachments WHERE id=OLD.id;
  UPDATE storage_quota SET used_bytes=used_bytes-OLD.size WHERE id=1;
END;

CREATE INDEX idx_booked_expiry ON appointments(date,id) WHERE status='booked';
