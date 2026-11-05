const memberColumns = `m.id,m.name,m.student_id,m.home_campus_id,m.college,m.major,m.status,m.revision,m.created_at,m.updated_at`;

const assignmentLeaveColumn = `(SELECT 'recorded' FROM roster_leaves l WHERE l.assignment_id=da.id AND l.member_id=da.member_id AND l.withdrawn_at IS NULL LIMIT 1) AS leave_status`;

function rows(result) {
  return result?.results || [];
}

function json(value, fallback) {
  return JSON.stringify(value ?? fallback);
}

function membership(row) {
  return {
    id: row.id,
    memberId: row.member_id,
    departmentId: row.department_id,
    enabled: row.department_enabled !== 0,
    departmentName: row.department_name || '',
    departmentCode: row.department_code || '',
    organizationKind: row.organization_kind || 'department',
    positionCode: row.position_code,
    assignmentType: row.assignment_type,
    isPrimary: !!row.is_primary,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || null,
    revision: row.revision
  };
}

function assignment(row) {
  return row
    ? {
        id: row.id,
        weekId: row.week_id,
        memberId: row.member_id,
        memberName: row.member_name || '',
        businessDate: row.business_date,
        campusId: row.campus_id,
        campusName: row.campus_name || '',
        dutyType: row.duty_type,
        startAt: row.start_at,
        endAt: row.end_at,
        revision: row.revision,
        active: !!row.active,
        leaveStatus: row.leave_status || '',
        servicePaused: !!row.service_paused
      }
    : null;
}

export { memberColumns, assignmentLeaveColumn, rows, json, membership, assignment };
