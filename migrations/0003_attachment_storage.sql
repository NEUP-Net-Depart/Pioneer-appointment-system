ALTER TABLE appointment_attachments ADD COLUMN expires_at TEXT;
UPDATE appointment_attachments
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+180 days');
CREATE INDEX idx_attachment_expiry ON appointment_attachments(expires_at, id);

-- Includes pending uploads and objects whose compensation has not succeeded.
CREATE TABLE storage_quota (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  used_bytes INTEGER NOT NULL DEFAULT 0 CHECK(used_bytes >= 0)
);
INSERT INTO storage_quota(id, used_bytes)
SELECT 1, COALESCE(SUM(size), 0) FROM appointment_attachments;
CREATE TABLE attachment_storage (
  id TEXT PRIMARY KEY, object_key TEXT NOT NULL UNIQUE,
  size INTEGER NOT NULL CHECK(size > 0 AND size <= 5242880),
  state TEXT NOT NULL CHECK(state IN ('pending', 'complete', 'deleting')),
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
INSERT INTO attachment_storage(id, object_key, size, state, created_at, expires_at)
SELECT id, object_key, size, 'complete', created_at, expires_at FROM appointment_attachments;
CREATE INDEX idx_storage_expiry ON attachment_storage(state, expires_at, id);
CREATE INDEX idx_storage_pending ON attachment_storage(state, created_at, id);

-- Each conditional INSERT and its quota increment are one atomic statement.
CREATE TRIGGER attachment_storage_reserve AFTER INSERT ON attachment_storage
BEGIN
  UPDATE storage_quota SET used_bytes = used_bytes + NEW.size WHERE id = 1;
END;
-- Release once, including metadata deletion, after R2 deletion is confirmed.
CREATE TRIGGER attachment_storage_release AFTER DELETE ON attachment_storage
BEGIN
  DELETE FROM appointment_attachments WHERE id = OLD.id;
  UPDATE storage_quota SET used_bytes = used_bytes - OLD.size WHERE id = 1;
END;
