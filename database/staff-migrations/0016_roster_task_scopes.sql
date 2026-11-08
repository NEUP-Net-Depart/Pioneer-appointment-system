-- Task identity includes its duty and organization scope, not a global time slot.
-- D1 keeps foreign keys enabled. Back up the CASCADE child before rebuilding
-- its parent; non-cascading version/history references retain their original IDs.
PRAGMA defer_foreign_keys = ON;
CREATE TABLE _roster_task_scope_backup AS SELECT * FROM roster_tasks;
CREATE TABLE _roster_availability_scope_backup AS SELECT * FROM availability;
DROP TABLE roster_tasks;
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
  duty_type TEXT NOT NULL DEFAULT 'repair' CHECK(duty_type IN ('repair','office')),
  UNIQUE(week_start,slot_start,slot_end,duty_type,campus_scope)
);
INSERT INTO roster_tasks(id,week_start,campus_scope,slot_start,slot_end,member_ids,deadline,description,revision,created_by_member_id,created_at,duty_type)
  SELECT id,week_start,campus_scope,slot_start,slot_end,member_ids,deadline,description,revision,created_by_member_id,created_at,duty_type FROM _roster_task_scope_backup;
INSERT INTO availability(id,task_id,member_id,business_date,start_at,end_at,campus_id,revision)
  SELECT id,task_id,member_id,business_date,start_at,end_at,campus_id,revision FROM _roster_availability_scope_backup;
DROP TABLE _roster_availability_scope_backup;
DROP TABLE _roster_task_scope_backup;
PRAGMA defer_foreign_keys = OFF;
