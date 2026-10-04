CREATE TABLE users (
  account TEXT PRIMARY KEY, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','technician','admin','superadmin')),
  campus TEXT NOT NULL DEFAULT '南湖 / 浑南',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  protected INTEGER NOT NULL DEFAULT 0 CHECK(protected IN (0,1)),
  password_hash TEXT NOT NULL, token_version INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE appointments (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL, name TEXT NOT NULL,
  college TEXT NOT NULL DEFAULT '', campus TEXT NOT NULL CHECK(campus IN ('南湖','浑南')),
  phone TEXT NOT NULL DEFAULT '', social TEXT NOT NULL,
  device_type TEXT NOT NULL, brand TEXT NOT NULL, device_model TEXT NOT NULL,
  serial TEXT NOT NULL DEFAULT '', warranty TEXT NOT NULL, fault_type TEXT NOT NULL,
  issue TEXT NOT NULL DEFAULT '', liquid_drop TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL, time_slot TEXT NOT NULL CHECK(time_slot IN ('19:00–20:00','20:00–21:00')),
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('pending','awaiting_claim','claimed','in_progress','completed','cancelled','no_show','no_repair')),
  assigned_to TEXT NOT NULL DEFAULT '', repair_note TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, agreement_at TEXT NOT NULL, agreement_version TEXT NOT NULL
);
CREATE INDEX idx_appointments_queue ON appointments(date,campus,time_slot,created_at);
CREATE INDEX idx_appointments_fault ON appointments(fault_type);
CREATE UNIQUE INDEX idx_active_student_slot ON appointments(student_id,date,time_slot)
  WHERE status NOT IN ('cancelled','no_show');

-- Atomic protection across Functions. Capacity changes require a new migration.
CREATE TRIGGER appointment_capacity_insert BEFORE INSERT ON appointments
WHEN NEW.status NOT IN ('cancelled','no_show')
BEGIN
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE (
    SELECT COUNT(*) FROM appointments WHERE date=NEW.date AND campus=NEW.campus
      AND time_slot=NEW.time_slot AND status NOT IN ('cancelled','no_show')
  ) >= 20;
END;
CREATE TRIGGER appointment_capacity_update BEFORE UPDATE ON appointments
WHEN NEW.status NOT IN ('cancelled','no_show')
BEGIN
  SELECT RAISE(ABORT,'SLOT_FULL') WHERE (
    SELECT COUNT(*) FROM appointments WHERE date=NEW.date AND campus=NEW.campus
      AND time_slot=NEW.time_slot AND status NOT IN ('cancelled','no_show') AND id<>OLD.id
  ) >= 20;
END;
CREATE TABLE appointment_attachments (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments(id),
  filename TEXT NOT NULL, mime_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK(size>0 AND size<=5242880),
  object_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE INDEX idx_attachment_appointment ON appointment_attachments(appointment_id,created_at);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX idx_rate_limits_expiry ON rate_limits(expires_at);
