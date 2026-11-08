ALTER TABLE members ADD COLUMN college TEXT NOT NULL DEFAULT '';
ALTER TABLE members ADD COLUMN major TEXT NOT NULL DEFAULT '';

CREATE TABLE attendance_report_settings (
  id INTEGER PRIMARY KEY CHECK(id=1),
  count_mode TEXT NOT NULL DEFAULT 'weekly' CHECK(count_mode IN ('weekly','actual')),
  hours_per_count REAL NOT NULL DEFAULT 4 CHECK(hours_per_count>0 AND hours_per_count<=24),
  merge_leaders INTEGER NOT NULL DEFAULT 0 CHECK(merge_leaders IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by TEXT NOT NULL DEFAULT ''
);
INSERT INTO attendance_report_settings(id) VALUES(1);
INSERT INTO staff_release_markers(id,applied_at) VALUES('attendance-reports-0041',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
