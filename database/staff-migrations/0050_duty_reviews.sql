CREATE TABLE attendance_reviews (
  assignment_id TEXT PRIMARY KEY REFERENCES duty_assignments(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  decision TEXT NOT NULL CHECK(decision IN ('absent','cleared')),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  reason TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL REFERENCES members(id),
  reviewed_at TEXT NOT NULL
);

INSERT INTO staff_release_markers VALUES('duty-workflow-0050',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
