-- Fresh installation only. Old development migrations and data are unsupported.
CREATE TABLE staff_accounts (
  account TEXT PRIMARY KEY, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('technician','admin','superadmin')),
  status TEXT NOT NULL DEFAULT 'enabled' CHECK(status IN ('enabled','disabled')),
  home_campus TEXT NOT NULL CHECK(home_campus IN ('南湖','浑南')),
  protected INTEGER NOT NULL DEFAULT 0 CHECK(protected IN (0,1)),
  password_hash TEXT NOT NULL, token_version INTEGER NOT NULL DEFAULT 0 CHECK(token_version>=0),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), created_at TEXT NOT NULL,
  CHECK(protected=0 OR (role='superadmin' AND status='enabled')),
  CHECK((protected=1 AND account IN ('root001','root002')) OR
    (protected=0 AND length(account) BETWEEN 6 AND 20 AND account NOT GLOB '*[^0-9]*'))
);
CREATE TABLE staff_campus_grants (
  account TEXT NOT NULL REFERENCES staff_accounts(account) ON DELETE CASCADE,
  campus TEXT NOT NULL CHECK(campus IN ('南湖','浑南')), PRIMARY KEY(account,campus)
);
CREATE INDEX idx_staff_name ON staff_accounts(name);
CREATE TABLE staff_whitelist (
  student_id TEXT PRIMARY KEY CHECK(length(student_id) BETWEEN 6 AND 20 AND student_id NOT GLOB '*[^0-9]*'),
  expected_name TEXT NOT NULL DEFAULT '',
  expected_role TEXT NOT NULL CHECK(expected_role IN ('technician','admin')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','revoked','activated')),
  created_by TEXT NOT NULL REFERENCES staff_accounts(account),
  revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE whitelist_campus_grants (
  student_id TEXT NOT NULL REFERENCES staff_whitelist(student_id) ON DELETE CASCADE,
  campus TEXT NOT NULL CHECK(campus IN ('南湖','浑南')), PRIMARY KEY(student_id,campus)
);
CREATE TABLE activation_requests (
  id TEXT PRIMARY KEY, student_id TEXT NOT NULL REFERENCES staff_whitelist(student_id),
  name TEXT NOT NULL, home_campus TEXT NOT NULL CHECK(home_campus IN ('南湖','浑南')),
  contact TEXT NOT NULL, password_hash TEXT NOT NULL,
  receipt_hash TEXT NOT NULL UNIQUE CHECK(length(receipt_hash)=64),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  review_note TEXT NOT NULL DEFAULT '', reviewed_by TEXT REFERENCES staff_accounts(account),
  reviewed_at TEXT, created_at TEXT NOT NULL,
  CHECK((status='pending' AND reviewed_at IS NULL AND reviewed_by IS NULL) OR
    (status<>'pending' AND reviewed_at IS NOT NULL AND reviewed_by IS NOT NULL))
);
CREATE UNIQUE INDEX idx_one_pending_activation ON activation_requests(student_id) WHERE status='pending';
CREATE UNIQUE INDEX idx_one_approved_activation ON activation_requests(student_id) WHERE status='approved';
CREATE INDEX idx_activation_status ON activation_requests(status,created_at,id);
-- One review UPDATE atomically creates the account and its grants or rolls back.
CREATE TRIGGER activation_approve AFTER UPDATE OF status ON activation_requests
WHEN OLD.status='pending' AND NEW.status='approved'
BEGIN
  SELECT RAISE(ABORT,'ACTIVATION_CONFLICT') WHERE NOT EXISTS (
    SELECT 1 FROM staff_whitelist WHERE student_id=NEW.student_id AND status='open'
      AND (expected_name='' OR expected_name=NEW.name)
  ) OR NOT EXISTS (SELECT 1 FROM whitelist_campus_grants WHERE student_id=NEW.student_id);
  INSERT INTO staff_accounts(account,name,role,home_campus,password_hash,created_at)
    SELECT NEW.student_id,NEW.name,expected_role,NEW.home_campus,NEW.password_hash,NEW.reviewed_at
    FROM staff_whitelist WHERE student_id=NEW.student_id;
  INSERT INTO staff_campus_grants(account,campus)
    SELECT NEW.student_id,campus FROM whitelist_campus_grants WHERE student_id=NEW.student_id;
  UPDATE staff_whitelist SET status='activated',revision=revision+1 WHERE student_id=NEW.student_id;
  UPDATE activation_requests SET password_hash='' WHERE id=NEW.id;
END;
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
  assigned_to TEXT REFERENCES staff_accounts(account), repair_note TEXT NOT NULL DEFAULT '',
  access_token_hash TEXT NOT NULL UNIQUE CHECK(length(access_token_hash)=64),
  credential_rotated_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  agreement_at TEXT NOT NULL, agreement_version TEXT NOT NULL
);
CREATE INDEX idx_active_queue ON appointments(date,campus,time_slot,created_at,id) WHERE status NOT IN ('cancelled','no_show');
CREATE INDEX idx_appointments_created ON appointments(created_at DESC,id DESC);
CREATE INDEX idx_appointments_assigned ON appointments(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_appointments_status ON appointments(status,date);
CREATE INDEX idx_appointments_fault ON appointments(fault_type);
CREATE UNIQUE INDEX idx_active_student_slot ON appointments(student_id,date,time_slot) WHERE status NOT IN ('cancelled','no_show');
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
  object_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX idx_attachment_appointment ON appointment_attachments(appointment_id,created_at);
CREATE INDEX idx_attachment_expiry ON appointment_attachments(expires_at,id);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX idx_rate_limits_expiry ON rate_limits(expires_at);
CREATE TABLE storage_quota (
  id INTEGER PRIMARY KEY CHECK(id=1), used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes>=0)
);
INSERT INTO storage_quota(id,used_bytes) VALUES (1,0);
CREATE TABLE attachment_storage (
  id TEXT PRIMARY KEY, object_key TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL CHECK(size>0 AND size<=5242880),
  state TEXT NOT NULL CHECK(state IN ('pending','complete','deleting')),
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX idx_storage_expiry ON attachment_storage(state,expires_at,id);
CREATE INDEX idx_storage_pending ON attachment_storage(state,created_at,id);
CREATE TRIGGER attachment_storage_reserve AFTER INSERT ON attachment_storage
BEGIN
  UPDATE storage_quota SET used_bytes=used_bytes+NEW.size WHERE id=1;
END;
CREATE TRIGGER attachment_storage_release AFTER DELETE ON attachment_storage
BEGIN
  DELETE FROM appointment_attachments WHERE id=OLD.id;
  UPDATE storage_quota SET used_bytes=used_bytes-OLD.size WHERE id=1;
END;
-- Only identity-verified credential recovery is audited. No tokens or hashes.
CREATE TABLE credential_recoveries (
  id TEXT PRIMARY KEY, appointment_id TEXT NOT NULL REFERENCES appointments(id),
  actor TEXT NOT NULL REFERENCES staff_accounts(account), reason TEXT NOT NULL, created_at TEXT NOT NULL
);
