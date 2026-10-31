import { parseJson } from '../../platform/contracts.js';

const memberColumns = `m.id,m.name,m.student_id,m.home_campus_id,m.college,m.major,m.status,m.revision,m.created_at,m.updated_at`;

const assignmentLeaveColumn = `(SELECT lr.status FROM roster_leave_facts lr WHERE lr.origin_assignment_id=COALESCE(da.origin_assignment_id,da.id) AND lr.member_id=da.member_id
  AND lr.status IN ('pending','approved') ORDER BY CASE lr.status WHEN 'approved' THEN 0 ELSE 1 END,lr.created_at DESC,lr.id DESC LIMIT 1) AS leave_status`;

const rosterTaskColumns = `rt.*,(SELECT name FROM roster_collection_series WHERE id=rt.series_id) AS collection_name,(SELECT json_group_array(json_object('businessDate',business_date,'campusId',campus_id,'ordinaryMinimum',ordinary_minimum))
  FROM (SELECT * FROM roster_staffing_requirements WHERE task_id=rt.id ORDER BY business_date,campus_id)) AS requirements_json`;

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
    departmentName: row.department_name || '',
    assignmentType: row.assignment_type,
    isPrimary: !!row.is_primary,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || null,
    revision: row.revision
  };
}

function profile(row) {
  return {
    id: row.id,
    memberId: row.member_id,
    profileCode: row.profile_code,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to || null,
    revision: row.revision
  };
}

function assignment(row) {
  return row
    ? {
        id: row.id,
        versionId: row.version_id,
        servicePaused: !!row.service_paused,
        memberId: row.member_id,
        memberName: row.member_name || '',
        businessDate: row.business_date,
        campusId: row.campus_id,
        campusName: row.campus_name || '',
        dutyType: row.duty_type,
        startAt: row.start_at,
        endAt: row.end_at,
        revision: row.revision,
        roleKind: row.role_kind || '',
        leaveStatus: row.leave_status || '',
        versionStatus: row.version_status || '',
        originAssignmentId: row.origin_assignment_id || '',
        previousAssignmentId: row.previous_assignment_id || '',
        taskId: row.task_id || '',
        ruleVersion: row.rule_version || '',
        ordinaryMinimum: parseJson(row.input_snapshot_ref, {}).eligibility?.slots?.find(
          (slot) =>
            slot.businessDate === row.business_date &&
            slot.campusId === row.campus_id &&
            slot.startAt === row.start_at &&
            slot.endAt === row.end_at
        )?.ordinaryMinimum
      }
    : null;
}

export {
  memberColumns,
  assignmentLeaveColumn,
  rosterTaskColumns,
  rows,
  json,
  membership,
  profile,
  assignment
};
