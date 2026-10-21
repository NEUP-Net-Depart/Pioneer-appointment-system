ALTER TABLE roster_tasks ADD COLUMN collection_closed_at TEXT;
ALTER TABLE roster_tasks ADD COLUMN workflow_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE roster_tasks ADD COLUMN series_id TEXT;
CREATE TABLE roster_submissions (
  task_id TEXT NOT NULL REFERENCES roster_tasks(id),
  member_id TEXT NOT NULL REFERENCES members(id),
  revision INTEGER NOT NULL DEFAULT 0,
  submitted_at TEXT NOT NULL,
  unavailable INTEGER NOT NULL DEFAULT 0 CHECK(unavailable IN (0,1)),
  source TEXT NOT NULL DEFAULT 'manual' CHECK(source IN ('manual','carried')),
  PRIMARY KEY(task_id,member_id)
);
INSERT INTO roster_submissions(task_id,member_id,submitted_at)
  SELECT task_id,member_id,datetime('now') FROM availability GROUP BY task_id,member_id;
CREATE TABLE availability_workflow_backup AS SELECT * FROM availability;
DROP TABLE availability;
CREATE TABLE availability (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES roster_tasks(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id),
  business_date TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  campus_id TEXT REFERENCES campuses(id),
  revision INTEGER NOT NULL DEFAULT 0,
  UNIQUE(task_id,member_id,business_date,start_at,end_at,campus_id)
);
INSERT INTO availability SELECT * FROM availability_workflow_backup;
DROP TABLE availability_workflow_backup;
CREATE INDEX idx_availability_task_member ON availability(task_id,member_id);
CREATE TABLE roster_command_receipts (
  request_id TEXT NOT NULL,
  actor_member_id TEXT NOT NULL REFERENCES members(id),
  command TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(request_id,actor_member_id,command)
);
CREATE TABLE roster_command_guards (id TEXT PRIMARY KEY,valid INTEGER NOT NULL CHECK(valid=1));
CREATE TABLE roster_collection_series (
  id TEXT PRIMARY KEY,
  owner_member_id TEXT NOT NULL REFERENCES members(id),
  template_task_id TEXT NOT NULL REFERENCES roster_tasks(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  publish_weekday INTEGER NOT NULL CHECK(publish_weekday BETWEEN 1 AND 7),
  publish_time TEXT NOT NULL,
  deadline_weekday INTEGER NOT NULL CHECK(deadline_weekday BETWEEN 1 AND 7),
  deadline_time TEXT NOT NULL,
  next_week TEXT NOT NULL,
  next_publish_at TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX idx_roster_series_week ON roster_tasks(series_id,week_start) WHERE series_id IS NOT NULL;
CREATE TABLE roster_availability_preferences (
  member_id TEXT NOT NULL REFERENCES members(id),
  duty_type TEXT NOT NULL CHECK(duty_type IN ('repair','office')),
  enabled INTEGER NOT NULL DEFAULT 1,
  windows TEXT NOT NULL,
  unavailable INTEGER NOT NULL DEFAULT 0,
  source_task_id TEXT NOT NULL REFERENCES roster_tasks(id),
  revision INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(member_id,duty_type)
);
CREATE TRIGGER roster_task_workflow_overlap BEFORE INSERT ON roster_tasks
WHEN NEW.workflow_version=1
BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM roster_tasks old WHERE old.week_start=NEW.week_start AND old.duty_type=NEW.duty_type
    AND old.slot_start<NEW.slot_end AND NEW.slot_start<old.slot_end
    AND EXISTS(SELECT 1 FROM json_each(old.campus_scope,'$.campusIds') a JOIN json_each(NEW.campus_scope,'$.campusIds') b ON a.value=b.value)
    AND (COALESCE(json_array_length(old.campus_scope,'$.departmentIds'),0)=0 OR COALESCE(json_array_length(NEW.campus_scope,'$.departmentIds'),0)=0
      OR EXISTS(SELECT 1 FROM json_each(old.campus_scope,'$.departmentIds') a JOIN json_each(NEW.campus_scope,'$.departmentIds') b ON a.value=b.value)))
    THEN RAISE(ABORT,'ROSTER_TASK_SCOPE_OVERLAP') END;
END;
CREATE TRIGGER roster_preserve_attended BEFORE UPDATE OF status ON roster_versions
WHEN NEW.status='published' AND OLD.status='draft'
BEGIN
  SELECT CASE WHEN json_extract(NEW.input_snapshot_ref,'$.publicationBase') IS NOT NULL
    AND COALESCE((SELECT id FROM roster_versions WHERE task_id=NEW.task_id AND status='published' AND id<>NEW.id),'')<>json_extract(NEW.input_snapshot_ref,'$.publicationBase')
    THEN RAISE(ABORT,'ROSTER_PUBLICATION_BASE_CHANGED') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM duty_assignments old_assignment JOIN roster_versions previous ON previous.id=old_assignment.version_id
    WHERE previous.task_id=NEW.task_id AND previous.status='published'
      AND (old_assignment.business_date<date('now','+8 hours') OR EXISTS (
        SELECT 1 FROM attendance_records ar JOIN attendance_events ae ON ae.id=ar.event_id
        WHERE ar.member_id=old_assignment.member_id AND ae.business_date=old_assignment.business_date
          AND ae.campus_id=old_assignment.campus_id AND ae.type='duty'))
      AND NOT EXISTS (SELECT 1 FROM duty_assignments next_assignment WHERE next_assignment.version_id=NEW.id
        AND next_assignment.member_id=old_assignment.member_id AND next_assignment.business_date=old_assignment.business_date
        AND next_assignment.campus_id=old_assignment.campus_id AND next_assignment.start_at=old_assignment.start_at
        AND next_assignment.end_at=old_assignment.end_at AND next_assignment.duty_type=old_assignment.duty_type
        AND COALESCE((SELECT role_kind FROM duty_roles WHERE assignment_id=next_assignment.id),'')=
            COALESCE((SELECT role_kind FROM duty_roles WHERE assignment_id=old_assignment.id),''))
  ) THEN RAISE(ABORT,'ROSTER_ATTENDED_ASSIGNMENT_CHANGED') END;
END;
