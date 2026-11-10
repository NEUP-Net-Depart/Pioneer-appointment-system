// Keep each UNION branch scoped to the account. Filtering the combined view
// from a correlated subquery scans every account before applying the filter.
export function campusArraySql(alias, value = 'campus') {
  return `(SELECT json_group_array(${value}) FROM (
    SELECT campus FROM staff_campus_grants WHERE account=${alias}.account
    UNION
    SELECT c.name AS campus FROM campuses c WHERE EXISTS(
      SELECT 1 FROM member_department_memberships mm
      JOIN departments d ON d.id=mm.department_id AND d.enabled=1
      WHERE mm.member_id=${alias}.member_id AND mm.is_primary=1
        AND mm.position_code IN ('deputy_director','director','vice_president','president')
        AND mm.effective_from<=date('now','+8 hours')
        AND (mm.effective_to IS NULL OR mm.effective_to>date('now','+8 hours'))
    )
  ))`;
}
