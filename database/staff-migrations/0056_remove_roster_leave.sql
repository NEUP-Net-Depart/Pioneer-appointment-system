DELETE FROM operation_receipts WHERE action IN ('rosters.leave.recorded','rosters.leave.withdrawn');
DELETE FROM audit_events WHERE action IN ('rosters.leave.recorded','rosters.leave.withdrawn')
 OR (action='rosters.model.migrated' AND json_extract(source_ref,'$.type') IN ('leave_requests','roster_leaves'));
DROP TABLE roster_leaves;
INSERT INTO staff_release_markers VALUES('roster-cover-only-0056',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
