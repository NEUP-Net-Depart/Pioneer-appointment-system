CREATE TABLE roster_publication_overrides (
  version_id TEXT PRIMARY KEY REFERENCES roster_versions(id),
  draft_version INTEGER NOT NULL,
  actor_member_id TEXT NOT NULL REFERENCES members(id),
  issues_json TEXT NOT NULL,
  reason TEXT NOT NULL CHECK(length(reason)>=2),
  confirmation TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
DROP TRIGGER roster_publication_schedule_guard;
CREATE TRIGGER roster_publication_schedule_guard BEFORE UPDATE OF status ON roster_versions
WHEN NEW.status='published' AND OLD.status<>'published'
BEGIN
  SELECT RAISE(ABORT,'ROSTER_SCHEDULE_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM duty_assignments a JOIN duty_assignments b ON a.member_id=b.member_id AND a.id<>b.id
    JOIN roster_versions other ON other.id=b.version_id
    WHERE a.version_id=NEW.id AND (b.version_id=NEW.id OR (other.status='published' AND other.task_id<>NEW.task_id))
    AND a.business_date=b.business_date AND a.start_at<b.end_at AND b.start_at<a.end_at
  );
  SELECT RAISE(ABORT,'ROSTER_SCHEDULE_CONFLICT') WHERE NOT EXISTS(SELECT 1 FROM roster_publication_overrides WHERE version_id=NEW.id AND draft_version=NEW.version) AND EXISTS (
    SELECT 1 FROM duty_assignments a JOIN duty_assignments b ON a.member_id=b.member_id AND a.id<>b.id
    JOIN roster_versions other ON other.id=b.version_id
    WHERE a.version_id=NEW.id AND (b.version_id=NEW.id OR (other.status='published' AND other.task_id<>NEW.task_id))
    AND ((a.duty_type='repair' AND b.duty_type='repair' AND date(a.business_date,'weekday 0','-6 day')=date(b.business_date,'weekday 0','-6 day'))
      OR (a.duty_type='office' AND b.duty_type='office' AND a.business_date=b.business_date))
  );
END;
DROP TRIGGER roster_repair_minimum_publish;
CREATE TRIGGER roster_repair_minimum_publish BEFORE UPDATE OF status ON roster_versions
WHEN NEW.status='published' AND OLD.status<>'published' AND NEW.rule_version='repair-minimum-v2' AND NOT EXISTS(SELECT 1 FROM roster_publication_overrides WHERE version_id=NEW.id AND draft_version=NEW.version)
BEGIN
  SELECT RAISE(ABORT,'ROSTER_REPAIR_MINIMUM_MISSING') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.input_snapshot_ref,'$.eligibility.slots') s WHERE
      (SELECT COUNT(*) FROM duty_assignments da JOIN duty_roles dr ON dr.assignment_id=da.id AND dr.role_kind='repair_lead'
        WHERE da.version_id=NEW.id AND da.business_date=json_extract(s.value,'$.businessDate') AND da.campus_id=json_extract(s.value,'$.campusId'))<>1
      OR (SELECT COUNT(*) FROM duty_assignments da WHERE da.version_id=NEW.id
        AND da.business_date=json_extract(s.value,'$.businessDate') AND da.campus_id=json_extract(s.value,'$.campusId')
        AND NOT EXISTS(SELECT 1 FROM duty_roles dr WHERE dr.assignment_id=da.id AND dr.role_kind='repair_lead')
        AND NOT EXISTS(SELECT 1 FROM roster_leave_facts lf WHERE lf.origin_assignment_id=COALESCE(da.origin_assignment_id,da.id) AND lf.member_id=da.member_id AND lf.status='approved'))<COALESCE(json_extract(s.value,'$.ordinaryMinimum'),1)
  );
  SELECT RAISE(ABORT,'ROSTER_CAMPUS_LEADER_CONFLICT') WHERE EXISTS (
    SELECT 1 FROM duty_assignments own JOIN duty_roles own_role ON own_role.assignment_id=own.id AND own_role.role_kind='repair_lead'
      JOIN duty_assignments other ON other.campus_id=own.campus_id AND other.business_date=own.business_date AND other.duty_type='repair'
      JOIN roster_versions rv ON rv.id=other.version_id AND rv.status='published' AND rv.task_id<>NEW.task_id
      JOIN duty_roles other_role ON other_role.assignment_id=other.id AND other_role.role_kind='repair_lead'
      WHERE own.version_id=NEW.id AND NOT EXISTS(SELECT 1 FROM roster_leave_facts lf WHERE lf.origin_assignment_id=COALESCE(other.origin_assignment_id,other.id) AND lf.member_id=other.member_id AND lf.status='approved')
  );
END;
