-- Independent campus settings; existing appointments always display the latest location.
-- 0009 is reserved for the weekday schedule migration in PR #38.
CREATE TABLE campus_repair_locations (
  campus TEXT PRIMARY KEY CHECK(campus IN ('南湖','浑南')),
  location TEXT NOT NULL DEFAULT '' CHECK(length(location)<=200),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision>=0),
  updated_at TEXT NOT NULL DEFAULT ''
);
INSERT INTO campus_repair_locations(campus) VALUES ('南湖'),('浑南');
