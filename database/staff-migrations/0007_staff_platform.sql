-- G0 unified baseline: PR #35 scan/onsite expiration + PR #38 weekday half-hour schedules + staff platform.
-- This single migration is intentionally ordered so appointment constraints are
-- finalized before stable member/authorization tables are attached.

-- Keep temporary registrations as completed historical records with a distinct
-- outcome so they do not count as no-shows or technician work.

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
  status TEXT NOT NULL CHECK(status IN ('booked','in_progress','completed')),
  outcome TEXT CHECK(outcome IN ('repaired','unrepaired','not_needed','cancelled','no_show','expired','legacy_unknown')),
  started_at TEXT, completed_at TEXT,
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
  (id,student_id,name,college,campus,phone,social,device_type,brand,device_model,serial,warranty,fault_type,issue,liquid_drop,date,time_slot,note,status,outcome,started_at,completed_at,assigned_to,repair_note,access_token_hash,credential_rotated_at,revision,created_at,agreement_at,agreement_version,signature,repair_number,front_photo_id,back_photo_id,source,registered_by,registration_key)
SELECT id,student_id,name,college,campus,phone,social,device_type,brand,device_model,serial,warranty,fault_type,issue,liquid_drop,date,time_slot,note,status,outcome,started_at,completed_at,assigned_to,repair_note,access_token_hash,credential_rotated_at,revision,created_at,agreement_at,agreement_version,signature,repair_number,front_photo_id,back_photo_id,source,registered_by,registration_key
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

-- If a pre-migration race left several pending temporary registrations for one
-- technician, retain every record and expire the older pending entries before
-- installing the one-pending-registration constraint.
UPDATE appointments AS older SET status='completed',outcome='expired',completed_at=created_at,revision=revision+1
WHERE older.source='onsite' AND older.status='booked' AND older.registered_by IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM appointments AS newer
    WHERE newer.source='onsite' AND newer.status='booked' AND newer.registered_by=older.registered_by
      AND (newer.created_at>older.created_at OR (newer.created_at=older.created_at AND newer.id>older.id))
  );

CREATE INDEX idx_active_queue ON appointments(date,campus,time_slot,created_at,id) WHERE status IN ('booked','in_progress');
CREATE INDEX idx_appointments_created ON appointments(created_at DESC,id DESC);
CREATE INDEX idx_appointments_assigned ON appointments(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_appointments_status ON appointments(status,date);
CREATE INDEX idx_appointments_fault ON appointments(fault_type);
CREATE UNIQUE INDEX idx_active_student_slot ON appointments(student_id,date,time_slot) WHERE status<>'completed' OR outcome NOT IN ('cancelled','no_show','expired');
CREATE UNIQUE INDEX idx_repair_number ON appointments(repair_number);
CREATE UNIQUE INDEX idx_onsite_request ON appointments(registered_by,registration_key);
CREATE UNIQUE INDEX idx_one_pending_onsite_registration ON appointments(registered_by) WHERE source='onsite' AND status='booked' AND registered_by IS NOT NULL;
CREATE INDEX idx_booked_expiry ON appointments(date,id) WHERE status='booked';
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
WHEN NEW.source='booking' AND NOT (NEW.status='completed' AND NEW.outcome='cancelled')
BEGIN
  SELECT RAISE(ABORT,'SLOT_PAUSED') WHERE (
    SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot
  ) = 0;
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE (
    SELECT COUNT(*) FROM appointments WHERE source='booking' AND date=NEW.date AND campus=NEW.campus
      AND time_slot=NEW.time_slot AND NOT (status='completed' AND outcome='cancelled')
  ) >= COALESCE((SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot),10);
END;

CREATE TRIGGER appointment_capacity_update BEFORE UPDATE ON appointments
WHEN NEW.source='booking' AND NOT (NEW.status='completed' AND NEW.outcome='cancelled') AND (
  (OLD.status='completed' AND OLD.outcome='cancelled') OR NEW.date<>OLD.date
  OR NEW.campus<>OLD.campus OR NEW.time_slot<>OLD.time_slot OR OLD.source<>NEW.source
)
BEGIN
  SELECT RAISE(ABORT,'SLOT_PAUSED') WHERE (
    SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot
  ) = 0;
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE (
    SELECT COUNT(*) FROM appointments WHERE source='booking' AND date=NEW.date AND campus=NEW.campus
      AND time_slot=NEW.time_slot AND NOT (status='completed' AND outcome='cancelled') AND id<>OLD.id
  ) >= COALESCE((SELECT capacity FROM slot_capacities WHERE campus=NEW.campus AND time_slot=NEW.time_slot),10);
END;

CREATE TRIGGER attachment_storage_release AFTER DELETE ON attachment_storage
BEGIN
  DELETE FROM appointment_attachments WHERE id=OLD.id;
  UPDATE storage_quota SET used_bytes=used_bytes-OLD.size WHERE id=1;
END;


-- Preserve every appointment and its referencing rows while widening the slot constraint.
-- Old clients can still book legacy slots until the application switches.

CREATE TABLE appointments_new (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL, name TEXT NOT NULL,
  college TEXT NOT NULL DEFAULT '', campus TEXT NOT NULL CHECK(campus IN ('南湖','浑南')),
  phone TEXT NOT NULL DEFAULT '', social TEXT NOT NULL,
  device_type TEXT NOT NULL, brand TEXT NOT NULL, device_model TEXT NOT NULL,
  serial TEXT NOT NULL DEFAULT '', warranty TEXT NOT NULL, fault_type TEXT NOT NULL,
  issue TEXT NOT NULL DEFAULT '', liquid_drop TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL, time_slot TEXT NOT NULL CHECK(time_slot IN ('19:00–20:00','20:00–21:00','19:00–19:30','19:30–20:00','20:00–20:30','20:30–21:00')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('booked','in_progress','completed')),
  outcome TEXT CHECK(outcome IN ('repaired','unrepaired','not_needed','cancelled','no_show','expired','legacy_unknown')),
  started_at TEXT, completed_at TEXT,
  assigned_to TEXT REFERENCES staff_accounts(account), repair_note TEXT NOT NULL DEFAULT '',
  access_token_hash TEXT NOT NULL UNIQUE CHECK(length(access_token_hash)=64),
  credential_rotated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  agreement_at TEXT NOT NULL, agreement_version TEXT NOT NULL, signature TEXT NOT NULL DEFAULT '', repair_number TEXT, front_photo_id TEXT, back_photo_id TEXT, source TEXT NOT NULL DEFAULT 'booking' CHECK(source IN ('booking','onsite')), registered_by TEXT REFERENCES staff_accounts(account), registration_key TEXT,
  CHECK((status='completed' AND outcome IS NOT NULL) OR (status<>'completed' AND outcome IS NULL))
);

INSERT INTO appointments_new(id,student_id,name,college,campus,phone,social,device_type,brand,device_model,serial,warranty,fault_type,issue,liquid_drop,date,time_slot,note,status,outcome,started_at,completed_at,assigned_to,repair_note,access_token_hash,credential_rotated_at,revision,created_at,agreement_at,agreement_version,signature,repair_number,front_photo_id,back_photo_id,source,registered_by,registration_key) SELECT id,student_id,name,college,campus,phone,social,device_type,brand,device_model,serial,warranty,fault_type,issue,liquid_drop,date,time_slot,note,status,outcome,started_at,completed_at,assigned_to,repair_note,access_token_hash,credential_rotated_at,revision,created_at,agreement_at,agreement_version,signature,repair_number,front_photo_id,back_photo_id,source,registered_by,registration_key FROM appointments;

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
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments_new(id) ON DELETE CASCADE
);

INSERT INTO active_repairs_new(account,appointment_id) SELECT account,appointment_id FROM active_repairs;

DROP TRIGGER attachment_storage_release;

DROP TABLE active_repairs;

DROP TABLE credential_recoveries;

DROP TABLE appointment_attachments;

DROP TABLE appointments;

ALTER TABLE appointments_new RENAME TO appointments;

ALTER TABLE appointment_attachments_new RENAME TO appointment_attachments;

ALTER TABLE credential_recoveries_new RENAME TO credential_recoveries;

ALTER TABLE active_repairs_new RENAME TO active_repairs;

CREATE INDEX idx_active_queue ON appointments(date,campus,time_slot,created_at,id) WHERE status IN ('booked','in_progress');

CREATE INDEX idx_appointments_created ON appointments(created_at DESC,id DESC);

CREATE INDEX idx_appointments_assigned ON appointments(assigned_to) WHERE assigned_to IS NOT NULL;

CREATE INDEX idx_appointments_status ON appointments(status,date);

CREATE INDEX idx_appointments_fault ON appointments(fault_type);

CREATE UNIQUE INDEX idx_active_student_slot ON appointments(student_id,date,time_slot) WHERE status<>'completed' OR outcome NOT IN ('cancelled','no_show','expired');

CREATE INDEX idx_attachment_appointment ON appointment_attachments(appointment_id,created_at);

CREATE INDEX idx_attachment_expiry ON appointment_attachments(expires_at,id);

CREATE TRIGGER attachment_storage_release AFTER DELETE ON attachment_storage
BEGIN
  DELETE FROM appointment_attachments WHERE id=OLD.id;
  UPDATE storage_quota SET used_bytes=used_bytes-OLD.size WHERE id=1;
END;

CREATE INDEX idx_booked_expiry ON appointments(date,id) WHERE status='booked';

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

CREATE TABLE weekday_slot_capacities (
 campus TEXT NOT NULL CHECK(campus IN ('南湖','浑南')),
 weekday INTEGER NOT NULL CHECK(typeof(weekday)='integer' AND weekday BETWEEN 1 AND 4),
 time_slot TEXT NOT NULL CHECK(time_slot IN ('19:00–19:30','19:30–20:00','20:00–20:30','20:30–21:00')),
 capacity INTEGER NOT NULL CHECK(typeof(capacity)='integer' AND capacity BETWEEN 0 AND 9007199254740991),
 revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision BETWEEN 0 AND 9007199254740991),
 PRIMARY KEY(campus,weekday,time_slot)
);
INSERT INTO weekday_slot_capacities(campus,weekday,time_slot,capacity)
SELECT campus,weekday,slot,CASE WHEN slot IN ('19:00–19:30','20:00–20:30') THEN (capacity+1)/2 ELSE capacity/2 END
FROM slot_capacities CROSS JOIN (SELECT 1 AS weekday UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4)
JOIN (SELECT '19:00–19:30' AS slot,'19:00–20:00' AS legacy UNION ALL SELECT '19:30–20:00','19:00–20:00'
 UNION ALL SELECT '20:00–20:30','20:00–21:00' UNION ALL SELECT '20:30–21:00','20:00–21:00') ON time_slot=legacy;
CREATE TABLE booking_day_slots (
 campus TEXT NOT NULL CHECK(campus IN ('南湖','浑南')),
 date TEXT NOT NULL,
 time_slot TEXT NOT NULL CHECK(time_slot IN ('19:00–20:00','20:00–21:00','19:00–19:30','19:30–20:00','20:00–20:30','20:30–21:00')),
 capacity INTEGER NOT NULL CHECK(typeof(capacity)='integer' AND capacity BETWEEN 0 AND 9007199254740991),
 PRIMARY KEY(campus,date,time_slot)
);
-- Include cancelled bookings: once booked, a day never changes its schedule automatically.
INSERT INTO booking_day_slots(campus,date,time_slot,capacity)
SELECT a.campus,a.date,s.time_slot,s.capacity FROM (SELECT DISTINCT campus,date FROM appointments WHERE source='booking') a
JOIN slot_capacities s ON s.campus=a.campus;

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
 SELECT RAISE(ABORT,'SLOT_PAUSED') WHERE NOT (NEW.status='completed' AND NEW.outcome='cancelled') AND
 (SELECT capacity FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot)=0;
 SELECT RAISE(ABORT,'SLOT_FULL') WHERE NOT (NEW.status='completed' AND NEW.outcome='cancelled') AND
 (SELECT COUNT(*) FROM appointments WHERE source='booking' AND date=NEW.date AND campus=NEW.campus AND time_slot=NEW.time_slot
 AND NOT (status='completed' AND outcome='cancelled')) >=
 (SELECT capacity FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot);
END;

CREATE TRIGGER appointment_capacity_update BEFORE UPDATE ON appointments
WHEN NEW.source='booking' AND ((OLD.status='completed' AND OLD.outcome='cancelled') OR NEW.date<>OLD.date OR NEW.campus<>OLD.campus OR NEW.time_slot<>OLD.time_slot OR OLD.source<>NEW.source)
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
 SELECT RAISE(ABORT,'SLOT_PAUSED') WHERE NOT (NEW.status='completed' AND NEW.outcome='cancelled') AND
 (SELECT capacity FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot)=0;
 SELECT RAISE(ABORT,'SLOT_FULL') WHERE NOT (NEW.status='completed' AND NEW.outcome='cancelled') AND
 (SELECT COUNT(*) FROM appointments WHERE source='booking' AND date=NEW.date AND campus=NEW.campus AND time_slot=NEW.time_slot
 AND NOT (status='completed' AND outcome='cancelled') AND id<>OLD.id) >=
 (SELECT capacity FROM booking_day_slots WHERE campus=NEW.campus AND date=NEW.date AND time_slot=NEW.time_slot);
END;

CREATE TRIGGER appointment_overlap_insert BEFORE INSERT ON appointments
WHEN NEW.source='booking' AND NOT (NEW.status='completed' AND NEW.outcome IN ('cancelled','no_show'))
BEGIN
 SELECT RAISE(ABORT,'APPOINTMENT_OVERLAP') WHERE EXISTS(
 SELECT 1 FROM appointments WHERE source='booking' AND student_id=NEW.student_id AND date=NEW.date
 AND NOT (status='completed' AND outcome IN ('cancelled','no_show'))
 AND substr(time_slot,1,5)<substr(NEW.time_slot,7,5) AND substr(time_slot,7,5)>substr(NEW.time_slot,1,5));
END;

CREATE TRIGGER appointment_overlap_update BEFORE UPDATE ON appointments
WHEN NEW.source='booking' AND ((OLD.status='completed' AND OLD.outcome IN ('cancelled','no_show')) OR NEW.date<>OLD.date OR NEW.time_slot<>OLD.time_slot OR OLD.source<>NEW.source) AND NOT (NEW.status='completed' AND NEW.outcome IN ('cancelled','no_show'))
BEGIN
 SELECT RAISE(ABORT,'APPOINTMENT_OVERLAP') WHERE EXISTS(
 SELECT 1 FROM appointments WHERE source='booking' AND student_id=NEW.student_id AND date=NEW.date
 AND NOT (status='completed' AND outcome IN ('cancelled','no_show'))
 AND substr(time_slot,1,5)<substr(NEW.time_slot,7,5) AND substr(time_slot,7,5)>substr(NEW.time_slot,1,5) AND id<>OLD.id);
END;


-- Staff platform architecture: stable identities, organization, authorization,
-- attendance, rosters, idempotent receipts and module/rule projections.
-- This migration is additive so the existing appointment and activation history
-- remains readable while new workflows use member IDs.

CREATE TABLE members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  student_id TEXT UNIQUE,
  home_campus_id TEXT REFERENCES campuses(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','inactive')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE campuses (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)
);

CREATE TABLE departments (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)
);

CREATE TABLE locations (
  id TEXT PRIMARY KEY,
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0)
);

INSERT OR IGNORE INTO campuses(id,code,name) VALUES
  ('campus-nanhu','nanhu','南湖'),('campus-hunnan','hunnan','浑南');
INSERT OR IGNORE INTO departments(id,code,name) VALUES
  ('dept-hardware','hardware','硬件部'),('dept-network','network','网络部'),('dept-office','office','办公室');
INSERT OR IGNORE INTO locations(id,campus_id,code,name) VALUES
  ('location-nanhu-main','campus-nanhu','nanhu-main','南湖维修点'),
  ('location-hunnan-main','campus-hunnan','hunnan-main','浑南维修点');

ALTER TABLE staff_accounts ADD COLUMN member_id TEXT;
ALTER TABLE staff_accounts ADD COLUMN auth_version INTEGER NOT NULL DEFAULT 0;

INSERT OR IGNORE INTO members(id,name,student_id,home_campus_id,status,created_at,updated_at)
SELECT 'member-' || account, name,
  CASE WHEN account GLOB '[0-9]*' THEN account ELSE NULL END,
  CASE home_campus WHEN '南湖' THEN 'campus-nanhu' WHEN '浑南' THEN 'campus-hunnan' END,
  CASE status WHEN 'enabled' THEN 'active' ELSE 'inactive' END,
  created_at,created_at
FROM staff_accounts;
UPDATE staff_accounts SET member_id='member-' || account WHERE member_id IS NULL;
CREATE UNIQUE INDEX idx_staff_accounts_member_id ON staff_accounts(member_id);
CREATE INDEX idx_members_name ON members(name);
CREATE INDEX idx_members_campus ON members(home_campus_id,status);

CREATE TABLE member_department_memberships (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  department_id TEXT NOT NULL REFERENCES departments(id),
  assignment_type TEXT NOT NULL DEFAULT 'primary' CHECK(assignment_type IN ('primary','secondary','exchange','temporary')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0,1)),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  created_at TEXT NOT NULL,
  CHECK(effective_to IS NULL OR effective_to>effective_from)
);
CREATE INDEX idx_membership_member_time ON member_department_memberships(member_id,effective_from,effective_to);
CREATE UNIQUE INDEX idx_membership_primary_open ON member_department_memberships(member_id)
  WHERE is_primary=1 AND effective_to IS NULL;
CREATE TRIGGER membership_primary_overlap_guard BEFORE INSERT ON member_department_memberships
WHEN NEW.is_primary=1
BEGIN
  SELECT RAISE(ABORT,'PRIMARY_MEMBERSHIP_OVERLAP') WHERE EXISTS(
    SELECT 1 FROM member_department_memberships old
    WHERE old.member_id=NEW.member_id AND old.is_primary=1
      AND (old.effective_to IS NULL OR NEW.effective_from<old.effective_to)
      AND (NEW.effective_to IS NULL OR old.effective_from<NEW.effective_to)
  );
END;
CREATE TRIGGER membership_primary_update_guard BEFORE UPDATE OF member_id,is_primary,effective_from,effective_to ON member_department_memberships
WHEN NEW.is_primary=1
BEGIN
  SELECT RAISE(ABORT,'PRIMARY_MEMBERSHIP_OVERLAP') WHERE EXISTS(
    SELECT 1 FROM member_department_memberships old
    WHERE old.member_id=NEW.member_id AND old.is_primary=1 AND old.id<>NEW.id
      AND (old.effective_to IS NULL OR NEW.effective_from<old.effective_to)
      AND (NEW.effective_to IS NULL OR old.effective_from<NEW.effective_to)
  );
END;

CREATE TABLE member_work_profiles (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  profile_code TEXT NOT NULL CHECK(profile_code IN ('repair','exchange','office','repair_lead','office_lead')),
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  UNIQUE(member_id,profile_code,effective_from)
);
CREATE INDEX idx_work_profiles_active ON member_work_profiles(member_id,effective_from,effective_to);

INSERT OR IGNORE INTO member_department_memberships
  (id,member_id,department_id,assignment_type,is_primary,effective_from,created_at)
SELECT 'membership-'||account,member_id,
  CASE WHEN role IN ('admin','superadmin') THEN 'dept-office' ELSE 'dept-hardware' END,
  'primary',1,substr(created_at,1,10),created_at
FROM staff_accounts WHERE member_id IS NOT NULL;
INSERT OR IGNORE INTO member_work_profiles(id,member_id,profile_code,effective_from)
SELECT 'profile-repair-'||account,member_id,'repair',substr(created_at,1,10)
FROM staff_accounts WHERE role IN ('technician','superadmin');
INSERT OR IGNORE INTO member_work_profiles(id,member_id,profile_code,effective_from)
SELECT 'profile-office-'||account,member_id,'office',substr(created_at,1,10)
FROM staff_accounts WHERE role IN ('admin','superadmin');

CREATE TABLE permission_definitions (
  code TEXT PRIMARY KEY,
  module_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  scope_kinds TEXT NOT NULL DEFAULT '[]',
  condition_kinds TEXT NOT NULL DEFAULT '[]',
  sensitive INTEGER NOT NULL DEFAULT 0 CHECK(sensitive IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))
);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level INTEGER NOT NULL DEFAULT 1 CHECK(level>=0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE role_grants (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code TEXT NOT NULL REFERENCES permission_definitions(code),
  scope_spec TEXT NOT NULL DEFAULT '{}',
  condition_spec TEXT NOT NULL DEFAULT '[]',
  validity_spec TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 0,
  UNIQUE(role_id,permission_code)
);

CREATE TABLE member_roles (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id),
  scope_bindings TEXT NOT NULL DEFAULT '{}',
  effective_from TEXT NOT NULL,
  effective_to TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  UNIQUE(member_id,role_id,effective_from)
);
CREATE INDEX idx_member_roles_active ON member_roles(member_id,effective_from,effective_to);

INSERT OR IGNORE INTO permission_definitions(code,module_code,name,description,scope_kinds,condition_kinds,sensitive) VALUES
 ('repair.summary.read','repairs','查看维修概览','读取授权范围内的预约设备摘要','["campus","department"]','[]',0),
 ('repair.start','repairs','确认接单','确认核验并开始维修','["campus"]','["repairWorkEligible"]',0),
 ('repair.finish.own','repairs','结束本人维修','提交本人维修结果','["self","campus"]','["ownResource"]',0),
 ('repair.transfer','repairs','转派维修','将工单转派给合资格成员','["campus","department"]','["activeDutyRole"]',0),
 ('repair.correct','repairs','修正维修记录','修正授权范围内的维修记录','["campus"]','["activeDutyRole"]',1),
 ('customer.identity.read','repairs','查看客户身份','读取客户姓名和学号','["self","campus"]','["ownResource"]',1),
 ('customer.contact.read','repairs','查看联系方式','读取客户联系方式','["self","campus"]','["activeDutyRole"]',1),
 ('onsite.create','repairs','现场登记','创建临时维修登记','["campus"]','["activeDutyRole"]',0),
 ('onsite.frontdesk.create','repairs','前台登记','由办公前台创建临时登记','["campus"]','["activeDutyRole"]',0),
 ('attendance.self','attendance','本人签到','参加自己有资格的签到场次','["self","campus"]','["attendanceEligible"]',0),
 ('attendance.session.manage','attendance','管理签到场次','创建和刷新签到场次凭证','["campus","department"]','["activeDutyRole"]',0),
 ('attendance.correct','attendance','修正考勤','补录或修正考勤事实','["campus","department"]','["activeDutyRole"]',1),
 ('attendance.export','attendance','导出考勤','导出授权范围的考勤','["campus","department"]','[]',1),
 ('roster.read','rosters','查看排班','读取本人或管理范围的排班','["self","campus","department"]','[]',0),
 ('roster.repair.manage','rosters','维修排班管理','生成和发布维修排班','["campus","department"]','["activeDutyRole"]',0),
 ('roster.office.manage','rosters','办公排班管理','生成和发布办公排班','["campus","department"]','["activeDutyRole"]',0),
 ('leave.review','rosters','审批请假','审批授权范围内的请假','["campus","department"]','["activeDutyRole"]',1),
 ('members.manage','identity','成员管理','管理成员资料和账号映射','["campus","department"]','[]',1),
 ('roles.manage','authorization','权限身份管理','维护角色和完整授权项','["campus","department"]','[]',1),
 ('settings.manage','identity','系统设置','管理平台设置','["campus","department"]','[]',1),
 ('audit.read','audit','查看审计','查询授权范围内的操作审计','["campus","department"]','[]',1),
 ('data.delete','files','数据管理','执行受控数据清理','["campus","department"]','[]',1),
 ('meetings.read.own','meetings','查看本人会议','读取本人会议与签到','["self","event"]','["meetingParticipant"]',0),
 ('meetings.manage','meetings','管理会议','管理授权部门会议','["department","event"]','["meetingOrganizer"]',0),
 ('meetings.attendance.export','meetings','导出会议考勤','导出会议统计','["department","event"]','["meetingOrganizer"]',1);

INSERT OR IGNORE INTO roles(id,code,name,description,level,created_at,updated_at) VALUES
 ('role-technician','technician','维修人员','维修工作台与本人维修操作',1,datetime('now'),datetime('now')),
 ('role-office','office','办公人员','前台接待和办公签到',1,datetime('now'),datetime('now')),
 ('role-repair-lead','repair_lead','维修值班负责人','当日维修运行与排班管理',2,datetime('now'),datetime('now')),
 ('role-office-lead','office_lead','办公值班负责人','办公排班与请假审批',2,datetime('now'),datetime('now')),
 ('role-superadmin','superadmin','最高管理员','全局成员、权限、审计和设置',3,datetime('now'),datetime('now'));

INSERT OR IGNORE INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec) VALUES
 ('grant-technician-summary','role-technician','repair.summary.read','{"campuses":"bound"}','[]'),
 ('grant-technician-start','role-technician','repair.start','{"campuses":"bound"}','[{"code":"repairWorkEligible","version":1}]'),
 ('grant-technician-finish','role-technician','repair.finish.own','{"self":true}','[{"code":"ownResource","version":1}]'),
 ('grant-technician-onsite','role-technician','onsite.create','{"campuses":"bound"}','[]'),
 ('grant-technician-attendance','role-technician','attendance.self','{"self":true}','[{"code":"attendanceEligible","version":1}]'),
 ('grant-office-onsite','role-office','onsite.frontdesk.create','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1}]'),
 ('grant-office-summary','role-office','repair.summary.read','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1}]'),
 ('grant-office-attendance','role-office','attendance.session.manage','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1}]'),
 ('grant-office-members','role-office','members.manage','{"campuses":"bound"}','[]'),
 ('grant-office-roles','role-office','roles.manage','{"campuses":"bound"}','[]'),
 ('grant-repair-lead-summary','role-repair-lead','repair.summary.read','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1}]'),
 ('grant-repair-lead-session','role-repair-lead','attendance.session.manage','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1}]'),
 ('grant-repair-lead-correct','role-repair-lead','repair.correct','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1}]'),
 ('grant-repair-lead-transfer','role-repair-lead','repair.transfer','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1}]'),
 ('grant-repair-lead-roster','role-repair-lead','roster.repair.manage','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1}]'),
 ('grant-office-lead-summary','role-office-lead','repair.summary.read','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1}]'),
 ('grant-office-lead-session','role-office-lead','attendance.session.manage','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1}]'),
 ('grant-office-lead-correct','role-office-lead','attendance.correct','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1}]'),
 ('grant-office-lead-onsite','role-office-lead','onsite.frontdesk.create','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1}]'),
 ('grant-office-lead-roster','role-office-lead','roster.office.manage','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1}]'),
 ('grant-office-lead-leave','role-office-lead','leave.review','{"campuses":"bound"}','[{"code":"activeDutyRole","version":1}]'),
 ('grant-superadmin-members','role-superadmin','members.manage','{"all":true}','[]'),
 ('grant-superadmin-roles','role-superadmin','roles.manage','{"all":true}','[]'),
 ('grant-superadmin-audit','role-superadmin','audit.read','{"all":true}','[]'),
 ('grant-superadmin-settings','role-superadmin','settings.manage','{"all":true}','[]'),
 ('grant-superadmin-data','role-superadmin','data.delete','{"all":true}','[]');
INSERT OR IGNORE INTO role_grants(id,role_id,permission_code,scope_spec,condition_spec)
SELECT 'grant-superadmin-'||code,'role-superadmin',code,'{"all":true}','[]'
FROM permission_definitions;

INSERT OR IGNORE INTO member_roles(id,member_id,role_id,scope_bindings,effective_from)
SELECT 'member-role-'||account,member_id,
  CASE role WHEN 'technician' THEN 'role-technician' WHEN 'admin' THEN 'role-office' ELSE 'role-superadmin' END,
  CASE WHEN protected=1 THEN '{"all":true}' ELSE '{"campuses":"legacy"}' END,
  substr(created_at,1,10)
FROM staff_accounts WHERE member_id IS NOT NULL;

CREATE TABLE module_catalog (
  code TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  contract_version TEXT NOT NULL,
  required_schema_version TEXT NOT NULL,
  release_state TEXT NOT NULL CHECK(release_state IN ('test','ready','disabled')),
  manifest_json TEXT NOT NULL,
  registered_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO module_catalog(code,version,manifest_hash,contract_version,required_schema_version,release_state,manifest_json,registered_at) VALUES
 ('identity','1.0.0','f4b0b62d','1','0007','ready','{"code":"identity"}',datetime('now')),
 ('organization','1.0.0','b3f4bad4','1','0007','ready','{"code":"organization"}',datetime('now')),
 ('authorization','1.0.0','067c7c3b','1','0007','ready','{"code":"authorization"}',datetime('now')),
 ('repairs','1.0.0','e9cb1406','1','0007','ready','{"code":"repairs"}',datetime('now')),
 ('duty','1.0.0','cc8019d2','1','0007','ready','{"code":"duty"}',datetime('now')),
 ('attendance','1.0.0','a06d1395','1','0007','ready','{"code":"attendance"}',datetime('now')),
 ('rosters','1.0.0','514c6e44','1','0007','ready','{"code":"rosters"}',datetime('now')),
 ('meetings','1.0.0','068e1705','1','0007','test','{"code":"meetings"}',datetime('now')),
 ('audit','1.0.0','4c3c7c4b','1','0007','ready','{"code":"audit"}',datetime('now')),
 ('files','1.0.0','cafe3c07','1','0006','ready','{"code":"files"}',datetime('now'));

CREATE TABLE business_rule_versions (
  rule_code TEXT NOT NULL,
  version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  parameters TEXT NOT NULL DEFAULT '{}',
  effective_at TEXT NOT NULL,
  retired_at TEXT,
  PRIMARY KEY(rule_code,version)
);
INSERT OR IGNORE INTO business_rule_versions(rule_code,version,schema_version,parameters,effective_at) VALUES
 ('attendance.duty','1.0.0','0007','{"timezone":"Asia/Shanghai","dedupe":"duty:memberId:businessDate"}',datetime('now')),
 ('roster.repair','1.0.0','0007','{"maxDaysPerWeek":1,"algorithm":"deterministic-greedy-v1"}',datetime('now')),
 ('repairs.capacity','1.0.0','0006','{"source":"slot_capacities"}',datetime('now'));

CREATE TABLE attendance_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('duty','meeting')),
  policy_code TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  rule_snapshot TEXT NOT NULL DEFAULT '{}',
  campus_id TEXT REFERENCES campuses(id),
  business_date TEXT NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  source_ref TEXT NOT NULL DEFAULT '{}',
  created_by_member_id TEXT REFERENCES members(id),
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  CHECK(ends_at>starts_at)
);
CREATE INDEX idx_attendance_events_date ON attendance_events(business_date,type,campus_id);

CREATE TABLE attendance_tokens (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES attendance_events(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  version INTEGER NOT NULL DEFAULT 1,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_attendance_tokens_event ON attendance_tokens(event_id,version);

CREATE TABLE attendance_records (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  event_id TEXT NOT NULL REFERENCES attendance_events(id),
  dedupe_key TEXT NOT NULL UNIQUE,
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('qr','nfc','manual')),
  source_ref TEXT NOT NULL DEFAULT '{}',
  primary_department_id_snapshot TEXT,
  primary_department_name_snapshot TEXT,
  identity_snapshot TEXT NOT NULL DEFAULT '{}',
  non_scheduled INTEGER NOT NULL DEFAULT 0 CHECK(non_scheduled IN (0,1)),
  correction_id TEXT,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_attendance_records_member_date ON attendance_records(member_id,occurred_at);
CREATE INDEX idx_attendance_records_event ON attendance_records(event_id,recorded_at);

CREATE TABLE staff_presence (
  member_id TEXT NOT NULL REFERENCES members(id),
  business_date TEXT NOT NULL,
  campus_id TEXT REFERENCES campuses(id),
  state TEXT NOT NULL CHECK(state IN ('available','away','off_duty')),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(member_id,business_date)
);
CREATE TABLE presence_events (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  business_date TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  actor_member_id TEXT REFERENCES members(id),
  actor_account TEXT
);

CREATE TABLE roster_tasks (
  id TEXT PRIMARY KEY,
  week_start TEXT NOT NULL,
  campus_scope TEXT NOT NULL DEFAULT '{}',
  slot_start TEXT NOT NULL,
  slot_end TEXT NOT NULL,
  member_ids TEXT NOT NULL DEFAULT '[]',
  deadline TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  created_by_member_id TEXT REFERENCES members(id),
  created_at TEXT NOT NULL,
  UNIQUE(week_start,slot_start,slot_end)
);
CREATE TABLE availability (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES roster_tasks(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id),
  business_date TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  campus_id TEXT REFERENCES campuses(id),
  revision INTEGER NOT NULL DEFAULT 0,
  UNIQUE(task_id,member_id,business_date,start_at,end_at)
);
CREATE TABLE roster_versions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES roster_tasks(id),
  status TEXT NOT NULL CHECK(status IN ('draft','published','superseded')),
  version INTEGER NOT NULL,
  rule_version TEXT NOT NULL,
  algorithm_version TEXT NOT NULL,
  input_snapshot_ref TEXT NOT NULL DEFAULT '{}',
  solver_status TEXT NOT NULL DEFAULT 'feasible',
  validation_result TEXT NOT NULL DEFAULT '{}',
  published_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(task_id,version)
);
CREATE TABLE duty_assignments (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES roster_versions(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  business_date TEXT NOT NULL,
  campus_id TEXT NOT NULL REFERENCES campuses(id),
  duty_type TEXT NOT NULL CHECK(duty_type IN ('repair','office')),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  UNIQUE(version_id,member_id,business_date,duty_type)
);
CREATE INDEX idx_duty_assignments_member_date ON duty_assignments(member_id,business_date,campus_id);
CREATE TABLE duty_roles (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES duty_assignments(id) ON DELETE CASCADE,
  role_kind TEXT NOT NULL CHECK(role_kind IN ('repair_lead','office_lead','coordinator')),
  effective_range TEXT NOT NULL DEFAULT '{}',
  UNIQUE(assignment_id,role_kind)
);

CREATE TABLE leave_requests (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES duty_assignments(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','withdrawn')),
  reviewer_member_id TEXT REFERENCES members(id),
  review_note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX idx_leave_member_status ON leave_requests(member_id,status,created_at);
CREATE TABLE swap_requests (
  id TEXT PRIMARY KEY,
  from_assignment_id TEXT NOT NULL REFERENCES duty_assignments(id),
  to_assignment_id TEXT NOT NULL REFERENCES duty_assignments(id),
  from_member_id TEXT NOT NULL REFERENCES members(id),
  to_member_id TEXT NOT NULL REFERENCES members(id),
  from_revision INTEGER NOT NULL,
  to_revision INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','cancelled')),
  note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TRIGGER swap_accept_guard BEFORE UPDATE OF status ON swap_requests
WHEN OLD.status='pending' AND NEW.status='accepted'
BEGIN
  SELECT RAISE(ABORT,'REVISION_CONFLICT') WHERE
    NOT EXISTS(SELECT 1 FROM duty_assignments WHERE id=OLD.from_assignment_id AND member_id=OLD.to_member_id AND revision=OLD.from_revision+1)
    OR NOT EXISTS(SELECT 1 FROM duty_assignments WHERE id=OLD.to_assignment_id AND member_id=OLD.from_member_id AND revision=OLD.to_revision+1);
END;

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  actor_member_id TEXT REFERENCES members(id),
  actor_account TEXT,
  action TEXT NOT NULL,
  action_version TEXT NOT NULL DEFAULT '1',
  source_ref TEXT NOT NULL DEFAULT '{}',
  before_json TEXT,
  after_json TEXT,
  reason TEXT NOT NULL DEFAULT '',
  request_id TEXT,
  request_trace_id TEXT,
  occurred_at TEXT NOT NULL
);
CREATE INDEX idx_audit_events_actor_time ON audit_events(actor_member_id,occurred_at);
CREATE INDEX idx_audit_events_source_time ON audit_events(action,occurred_at);

CREATE TABLE operation_receipts (
  actor_member_id TEXT NOT NULL REFERENCES members(id),
  action TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  resource_ref TEXT NOT NULL DEFAULT '{}',
  result_json TEXT NOT NULL,
  result_status TEXT NOT NULL DEFAULT 'success',
  created_at TEXT NOT NULL,
  PRIMARY KEY(actor_member_id,action,request_id)
);

-- Accounts may be created after the migration (for example by activation). Keep
-- the stable member mapping complete for those writes as well.
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
    VALUES ('membership-'||NEW.account,'member-'||NEW.account,
      CASE NEW.role WHEN 'admin' THEN 'dept-office' WHEN 'superadmin' THEN 'dept-office' ELSE 'dept-hardware' END,
      'primary',1,substr(NEW.created_at,1,10),NEW.created_at);
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

ALTER TABLE active_repairs ADD COLUMN member_id TEXT;
UPDATE active_repairs SET member_id=(SELECT member_id FROM staff_accounts WHERE account=active_repairs.account);
CREATE UNIQUE INDEX idx_active_repairs_member ON active_repairs(member_id) WHERE member_id IS NOT NULL;
CREATE TRIGGER active_repair_member_sync AFTER INSERT ON active_repairs
BEGIN
  UPDATE active_repairs SET member_id=(SELECT member_id FROM staff_accounts WHERE account=NEW.account) WHERE account=NEW.account AND member_id IS NULL;
END;

CREATE TABLE repair_intake_records (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  member_id TEXT REFERENCES members(id),
  account TEXT NOT NULL REFERENCES staff_accounts(account),
  front_photo_id TEXT NOT NULL,
  back_photo_id TEXT NOT NULL,
  verified_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_repair_intake_appointment ON repair_intake_records(appointment_id,verified_at);
