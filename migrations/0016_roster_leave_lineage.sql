-- Stable lineage connects unchanged assignments across published revisions.
ALTER TABLE duty_assignments ADD COLUMN origin_assignment_id TEXT REFERENCES duty_assignments(id);
CREATE INDEX idx_assignment_origin ON duty_assignments(origin_assignment_id);
UPDATE duty_assignments AS current SET origin_assignment_id=(
  SELECT COALESCE(previous.origin_assignment_id,previous.id) FROM duty_assignments previous
  JOIN roster_versions old_version ON old_version.id=previous.version_id
  JOIN roster_versions current_version ON current_version.id=current.version_id
  WHERE old_version.task_id=current_version.task_id AND old_version.version<current_version.version
    AND old_version.status IN ('published','superseded') AND previous.member_id=current.member_id
    AND previous.business_date=current.business_date AND previous.campus_id=current.campus_id
    AND previous.duty_type=current.duty_type AND previous.start_at=current.start_at AND previous.end_at=current.end_at
  ORDER BY old_version.created_at,old_version.version,old_version.id LIMIT 1
);

-- Resolve historical requests without rewriting their original assignment references.
CREATE VIEW roster_leave_facts AS
SELECT lr.*,COALESCE(da.origin_assignment_id,da.id) AS origin_assignment_id
FROM leave_requests lr JOIN duty_assignments da ON da.id=lr.assignment_id;
