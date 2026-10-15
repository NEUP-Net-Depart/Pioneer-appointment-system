-- Forward upgrade from the deployed Staff 0007 schema.
-- Applied as database/staff-migrations/0008_five_statuses.sql.
-- Preserve existing date snapshots, members, intake records and active claims.
-- Target appointment constraints follow dev 135da288204d20a9c06d9579d7bf61813b2587fc.

CREATE TABLE appointments_new (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL, name TEXT NOT NULL,
  college TEXT NOT NULL DEFAULT '', campus TEXT NOT NULL CHECK(campus IN ('南湖','浑南')),
  phone TEXT NOT NULL DEFAULT '', social TEXT NOT NULL,
  device_type TEXT NOT NULL, brand TEXT NOT NULL, device_model TEXT NOT NULL,
  serial TEXT NOT NULL DEFAULT '', warranty TEXT NOT NULL, fault_type TEXT NOT NULL,
  issue TEXT NOT NULL DEFAULT '', liquid_drop TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL, time_slot TEXT NOT NULL CHECK(time_slot IN ('19:00–20:00','20:00–21:00','19:00–19:30','19:30–20:00','20:00–20:30','20:30–21:00')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('booked','in_progress','completed','cancelled','expired')),
  outcome TEXT CHECK(outcome IN ('repaired','unrepaired','not_needed','legacy_unknown')),
  started_at TEXT, completed_at TEXT,
  expires_at TEXT NOT NULL CHECK(length(expires_at)=24 AND substr(expires_at,24,1)='Z' AND julianday(expires_at) IS NOT NULL),
  assigned_to TEXT REFERENCES staff_accounts(account), repair_note TEXT NOT NULL DEFAULT '',
  access_token_hash TEXT NOT NULL UNIQUE CHECK(length(access_token_hash)=64),
  credential_rotated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  agreement_at TEXT NOT NULL, agreement_version TEXT NOT NULL, signature TEXT NOT NULL DEFAULT '', repair_number TEXT, front_photo_id TEXT, back_photo_id TEXT, source TEXT NOT NULL DEFAULT 'booking' CHECK(source IN ('booking','onsite')), registered_by TEXT REFERENCES staff_accounts(account), registration_key TEXT,
  CHECK((status='completed' AND outcome IS NOT NULL) OR (status<>'completed' AND outcome IS NULL))
);

INSERT INTO appointments_new(id,student_id,name,college,campus,phone,social,device_type,brand,device_model,serial,warranty,fault_type,issue,liquid_drop,date,time_slot,note,status,outcome,started_at,completed_at,assigned_to,repair_note,access_token_hash,credential_rotated_at,revision,created_at,agreement_at,agreement_version,signature,repair_number,front_photo_id,back_photo_id,source,registered_by,registration_key,expires_at) SELECT id,student_id,name,college,campus,phone,social,device_type,brand,device_model,serial,warranty,fault_type,issue,liquid_drop,date,time_slot,note,CASE WHEN status='completed' AND outcome='cancelled' THEN 'cancelled' WHEN status='completed' AND outcome IN ('no_show','expired') THEN 'expired' ELSE status END,CASE WHEN outcome IN ('cancelled','no_show','expired') THEN NULL ELSE outcome END,started_at,completed_at,assigned_to,repair_note,access_token_hash,credential_rotated_at,revision,created_at,agreement_at,agreement_version,signature,repair_number,front_photo_id,back_photo_id,source,registered_by,registration_key,date || 'T13:30:00.000Z' FROM appointments;

CREATE TABLE appointment_attachments_new (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments_new(id),
  filename TEXT NOT NULL, mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size>0 AND size<=5242880),
  object_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
, purpose TEXT NOT NULL DEFAULT 'general', uploaded_by TEXT);

INSERT INTO appointment_attachments_new(id,appointment_id,filename,mime_type,size,object_key,created_at,expires_at,purpose,uploaded_by) SELECT id,appointment_id,filename,mime_type,size,object_key,created_at,expires_at,purpose,uploaded_by FROM appointment_attachments;

CREATE TABLE credential_recoveries_new (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments_new(id),
  actor TEXT NOT NULL REFERENCES staff_accounts(account), reason TEXT NOT NULL, created_at TEXT NOT NULL
);

INSERT INTO credential_recoveries_new(id,appointment_id,actor,reason,created_at) SELECT id,appointment_id,actor,reason,created_at FROM credential_recoveries;

CREATE TABLE active_repairs_new (
  account TEXT PRIMARY KEY REFERENCES staff_accounts(account),
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments_new(id) ON DELETE CASCADE,
  member_id TEXT
);

INSERT INTO active_repairs_new(account,appointment_id,member_id) SELECT account,appointment_id,member_id FROM active_repairs;

DROP TRIGGER attachment_storage_release;

DROP TABLE active_repairs;

DROP TABLE credential_recoveries;

DROP TABLE appointment_attachments;

CREATE TABLE appointment_corrections_new (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments_new(id),
  actor TEXT NOT NULL REFERENCES staff_accounts(account),
  reason TEXT NOT NULL CHECK(length(reason)<=300),
  before_state TEXT NOT NULL, after_state TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE TABLE repair_intake_records_new (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments_new(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES members(id),
  account TEXT NOT NULL REFERENCES staff_accounts(account),
  front_photo_id TEXT NOT NULL,
  back_photo_id TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);

INSERT INTO repair_intake_records_new SELECT * FROM repair_intake_records;
DROP TABLE repair_intake_records;
DROP TABLE appointments;

ALTER TABLE appointments_new RENAME TO appointments;
ALTER TABLE repair_intake_records_new RENAME TO repair_intake_records;
CREATE INDEX idx_repair_intake_appointment ON repair_intake_records(appointment_id,verified_at);
ALTER TABLE appointment_corrections_new RENAME TO appointment_corrections;
CREATE INDEX idx_correction_appointment ON appointment_corrections(appointment_id,created_at,id);

ALTER TABLE appointment_attachments_new RENAME TO appointment_attachments;

ALTER TABLE credential_recoveries_new RENAME TO credential_recoveries;

ALTER TABLE active_repairs_new RENAME TO active_repairs;

CREATE INDEX idx_active_queue ON appointments(date,campus,time_slot,created_at,id) WHERE status IN ('booked','in_progress');

CREATE INDEX idx_appointments_created ON appointments(created_at DESC,id DESC);

CREATE INDEX idx_appointments_assigned ON appointments(assigned_to) WHERE assigned_to IS NOT NULL;

CREATE INDEX idx_appointments_status ON appointments(status,date);

CREATE INDEX idx_appointments_fault ON appointments(fault_type);

CREATE UNIQUE INDEX idx_active_student_slot ON appointments(student_id,date,time_slot) WHERE status NOT IN ('cancelled','expired');

CREATE INDEX idx_attachment_appointment ON appointment_attachments(appointment_id,created_at);

CREATE INDEX idx_attachment_expiry ON appointment_attachments(expires_at,id);

CREATE TRIGGER attachment_storage_release AFTER DELETE ON attachment_storage
BEGIN
  DELETE FROM appointment_attachments WHERE id=OLD.id;
  UPDATE storage_quota SET used_bytes=used_bytes-OLD.size WHERE id=1;
END;

CREATE INDEX idx_booked_expiry ON appointments(expires_at,id) WHERE status='booked' AND started_at IS NULL;

CREATE UNIQUE INDEX idx_repair_number ON appointments(repair_number);

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

CREATE UNIQUE INDEX idx_onsite_request ON appointments(registered_by,registration_key);
CREATE UNIQUE INDEX idx_one_pending_onsite_registration ON appointments(registered_by) WHERE source='onsite' AND status='booked' AND registered_by IS NOT NULL;

CREATE TRIGGER appointment_capacity_insert BEFORE INSERT ON appointments
WHEN NEW.source='booking'
BEGIN
 INSERT INTO booking_day_slots(campus,date,time_slot,capacity)
 SELECT NEW.campus,NEW.date,time_slot,capacity FROM slot_capacities
 WHERE campus=NEW.campus AND NEW.time_slot IN ('19:00–20:00','20:00–21:00')
 AND NOT EXISTS(SELECT 1 FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date);
 INSERT INTO booking_day_slots(campus,date,time_slot,capacity)
 SELECT NEW.campus,NEW.date,time_slot,capacity FROM weekday_slot_capacities
 WHERE campus=NEW.campus AND weekday=CAST(strftime('%w',NEW.date) AS INTEGER)
 AND NOT EXISTS(SELECT 1 FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date);
 SELECT RAISE(ABORT,'SLOT_CHANGED') WHERE NOT EXISTS(
 SELECT 1 FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot);
 SELECT RAISE(ABORT,'SLOT_PAUSED') WHERE NEW.status<>'cancelled' AND
 (SELECT capacity FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot)=0;
 SELECT RAISE(ABORT,'SLOT_FULL') WHERE NEW.status<>'cancelled' AND
 (SELECT COUNT(*) FROM appointments WHERE source='booking' AND date=NEW.date AND campus=NEW.campus AND time_slot=NEW.time_slot
 AND status<>'cancelled') >=
 (SELECT capacity FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot);
END;

CREATE TRIGGER appointment_capacity_update BEFORE UPDATE ON appointments
WHEN NEW.source='booking' AND ((OLD.status='cancelled' OR (NEW.status='booked' AND OLD.status IN ('completed','expired'))) OR NEW.date<>OLD.date OR NEW.campus<>OLD.campus OR NEW.time_slot<>OLD.time_slot OR OLD.source<>NEW.source)
BEGIN
 INSERT INTO booking_day_slots(campus,date,time_slot,capacity)
 SELECT NEW.campus,NEW.date,time_slot,capacity FROM slot_capacities
 WHERE campus=NEW.campus AND NEW.time_slot IN ('19:00–20:00','20:00–21:00')
 AND NOT EXISTS(SELECT 1 FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date);
 INSERT INTO booking_day_slots(campus,date,time_slot,capacity)
 SELECT NEW.campus,NEW.date,time_slot,capacity FROM weekday_slot_capacities
 WHERE campus=NEW.campus AND weekday=CAST(strftime('%w',NEW.date) AS INTEGER)
 AND NOT EXISTS(SELECT 1 FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date);
 SELECT RAISE(ABORT,'SLOT_CHANGED') WHERE NOT EXISTS(
 SELECT 1 FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot);
 SELECT RAISE(ABORT,'SLOT_PAUSED') WHERE NEW.status<>'cancelled' AND
 (SELECT capacity FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot)=0;
 SELECT RAISE(ABORT,'SLOT_FULL') WHERE NEW.status<>'cancelled' AND
 (SELECT COUNT(*) FROM appointments WHERE source='booking' AND date=NEW.date AND campus=NEW.campus AND time_slot=NEW.time_slot
 AND status<>'cancelled' AND id<>OLD.id) >=
 (SELECT capacity FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot);
END;

CREATE TRIGGER appointment_overlap_insert BEFORE INSERT ON appointments
WHEN NEW.source='booking' AND NEW.status NOT IN ('cancelled','expired')
BEGIN
 SELECT RAISE(ABORT,'APPOINTMENT_OVERLAP') WHERE EXISTS(
 SELECT 1 FROM appointments WHERE source='booking' AND student_id=NEW.student_id AND date=NEW.date
 AND status NOT IN ('cancelled','expired')
 AND substr(time_slot,1,5)<substr(NEW.time_slot,7,5) AND substr(time_slot,7,5)>substr(NEW.time_slot,1,5));
END;

CREATE TRIGGER appointment_overlap_update BEFORE UPDATE ON appointments
WHEN NEW.source='booking' AND (OLD.status IN ('cancelled','expired') OR NEW.date<>OLD.date OR NEW.time_slot<>OLD.time_slot OR OLD.source<>NEW.source) AND NEW.status NOT IN ('cancelled','expired')
BEGIN
 SELECT RAISE(ABORT,'APPOINTMENT_OVERLAP') WHERE EXISTS(
 SELECT 1 FROM appointments WHERE source='booking' AND student_id=NEW.student_id AND date=NEW.date
 AND status NOT IN ('cancelled','expired')
 AND substr(time_slot,1,5)<substr(NEW.time_slot,7,5) AND substr(time_slot,7,5)>substr(NEW.time_slot,1,5) AND id<>OLD.id);
END;

CREATE UNIQUE INDEX idx_active_repairs_member ON active_repairs(member_id) WHERE member_id IS NOT NULL;
CREATE TRIGGER active_repair_member_sync AFTER INSERT ON active_repairs
BEGIN
  UPDATE active_repairs SET member_id=(SELECT member_id FROM staff_accounts WHERE account=NEW.account) WHERE account=NEW.account AND member_id IS NULL;
END;

-- Account re-creation must retain the existing primary membership.
DROP TRIGGER staff_account_member_sync;
CREATE TRIGGER staff_account_member_sync AFTER INSERT ON staff_accounts
BEGIN
  INSERT OR IGNORE INTO members(id,name,student_id,home_campus_id,status,created_at,updated_at)
    VALUES ('member-'||NEW.account,NEW.name,
      CASE WHEN NEW.account GLOB '[0-9]*' THEN NEW.account ELSE NULL END,
      CASE NEW.home_campus WHEN '南湖' THEN 'campus-nanhu' WHEN '浑南' THEN 'campus-hunnan' END,
      CASE NEW.status WHEN 'enabled' THEN 'active' ELSE 'inactive' END,NEW.created_at,NEW.created_at);
  UPDATE staff_accounts SET member_id='member-'||NEW.account WHERE account=NEW.account AND member_id IS NULL;
  INSERT OR IGNORE INTO member_department_memberships
    (id,member_id,department_id,assignment_type,is_primary,effective_from,created_at)
    SELECT 'membership-'||NEW.account,'member-'||NEW.account,
      CASE NEW.role WHEN 'admin' THEN 'dept-office' WHEN 'superadmin' THEN 'dept-office' ELSE 'dept-hardware' END,
      'primary',1,substr(NEW.created_at,1,10),NEW.created_at
    WHERE NOT EXISTS(SELECT 1 FROM member_department_memberships WHERE id='membership-'||NEW.account);
  INSERT OR IGNORE INTO member_work_profiles(id,member_id,profile_code,effective_from)
    VALUES ('profile-default-'||NEW.account,'member-'||NEW.account,
      CASE NEW.role WHEN 'admin' THEN 'office' WHEN 'superadmin' THEN 'repair' ELSE 'repair' END,
      substr(NEW.created_at,1,10));
  INSERT OR IGNORE INTO member_work_profiles(id,member_id,profile_code,effective_from)
    SELECT 'profile-office-'||NEW.account,'member-'||NEW.account,'office',substr(NEW.created_at,1,10)
    WHERE NEW.role IN ('admin','superadmin');
  INSERT OR IGNORE INTO member_roles(id,member_id,role_id,scope_bindings,effective_from)
    VALUES ('member-role-'||NEW.account,'member-'||NEW.account,
      CASE NEW.role WHEN 'technician' THEN 'role-technician' WHEN 'admin' THEN 'role-office' ELSE 'role-superadmin' END,
      CASE WHEN NEW.protected=1 THEN '{"all":true}' ELSE '{"campuses":"legacy"}' END,
      substr(NEW.created_at,1,10));
END;
