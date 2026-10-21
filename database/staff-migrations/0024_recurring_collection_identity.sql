-- The series is the persistent collection; task rows are its weekly periods.
ALTER TABLE roster_collection_series ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE roster_tasks ADD COLUMN collection_opens_at TEXT;
UPDATE roster_tasks SET collection_opens_at=(SELECT date(roster_tasks.week_start,(publish_weekday-8)||' days')||'T'||publish_time||':00+08:00' FROM roster_collection_series WHERE id=roster_tasks.series_id) WHERE series_id IS NOT NULL AND id<>series_id;
-- Resolve continuation as of a week's cutoff, even if nobody opened that week.
CREATE TABLE roster_preference_history (
  member_id TEXT NOT NULL REFERENCES members(id),
  duty_type TEXT NOT NULL,
  revision INTEGER NOT NULL,
  enabled INTEGER NOT NULL,
  windows TEXT NOT NULL,
  unavailable INTEGER NOT NULL,
  source_task_id TEXT NOT NULL REFERENCES roster_tasks(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY(member_id,duty_type,revision)
);
INSERT INTO roster_preference_history SELECT member_id,duty_type,revision,enabled,windows,unavailable,source_task_id,updated_at FROM roster_availability_preferences;
CREATE TRIGGER roster_preference_created AFTER INSERT ON roster_availability_preferences
BEGIN
  INSERT INTO roster_preference_history VALUES(NEW.member_id,NEW.duty_type,NEW.revision,NEW.enabled,NEW.windows,NEW.unavailable,NEW.source_task_id,NEW.updated_at);
END;
CREATE TRIGGER roster_preference_changed AFTER UPDATE ON roster_availability_preferences
BEGIN
  INSERT INTO roster_preference_history VALUES(NEW.member_id,NEW.duty_type,NEW.revision,NEW.enabled,NEW.windows,NEW.unavailable,NEW.source_task_id,NEW.updated_at);
END;
