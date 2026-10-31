import { contextDomain } from './staff-platform/context.js';
import { membersDomain } from './staff-platform/members.js';
import { rolesDomain } from './staff-platform/roles.js';
import { workspaceDomain } from './staff-platform/workspace.js';
import { attendanceDomain } from './staff-platform/attendance.js';
import { collectionsDomain } from './staff-platform/collections.js';
import { planningDomain } from './staff-platform/planning.js';
import { requestsDomain } from './staff-platform/requests.js';
import { attendanceReportingDomain } from './staff-platform/reporting.js';

export function staffPlatformService({
  repository,
  platform,
  manifests,
  calendarClock = () => new Date()
}) {
  const {
    collectionStatus,
    contextFor,
    scopedActor,
    evaluate,
    requirePermission,
    withReceipt,
    rosterWrite
  } = contextDomain({ repository, platform, calendarClock });
  const {
    memberTarget,
    memberList,
    memberDetail,
    saveWorkProfile,
    updateMember,
    ownProfile,
    addMembership,
    endMembership,
    importMembers,
    importEducation
  } = membersDomain({ repository, platform, contextFor, evaluate });
  const { permissions, roles, createRole, updateRole, previewRole, bindMemberRoles } = rolesDomain({
    repository,
    platform,
    contextFor,
    requirePermission,
    memberTarget,
    evaluate
  });
  const { workbench, organization, deskSummary, audit } = workspaceDomain({
    repository,
    platform,
    manifests,
    contextFor
  });
  const {
    createAttendanceEvent,
    issueAttendanceToken,
    checkIn,
    directAttendanceAction,
    directCheckIn,
    previewAttendance,
    attendanceList,
    attendanceOptions,
    attendanceExport,
    correctAttendance,
    presence
  } = attendanceDomain({
    repository,
    platform,
    contextFor,
    evaluate,
    requirePermission,
    withReceipt
  });
  const { reportSettings, saveReportSettings, volunteerReport, attendanceMatrix } =
    attendanceReportingDomain({ repository, platform, contextFor, evaluate });
  const {
    rosterOptions,
    rosterCandidates,
    commandRecord,
    collectionCommand,
    addParticipants,
    submitAvailability,
    applyAvailabilityContinuation,
    seriesCommand,
    availabilityPreferences,
    rosterTasks,
    taskAvailability,
    createRosterTask,
    rosterRequirements,
    saveAvailability
  } = collectionsDomain({
    repository,
    platform,
    calendarClock,
    collectionStatus,
    contextFor,
    requirePermission,
    rosterWrite
  });
  const { rosterTaskState, generate, reviseRoster, updateRoster, publish, importRoster } =
    planningDomain({
      repository,
      platform,
      calendarClock,
      collectionStatus,
      contextFor,
      commandRecord,
      applyAvailabilityContinuation,
      rosterWrite
    });
  const {
    rosterMine,
    leave,
    leaveDetail,
    leaves,
    leaveDecision,
    leaveWithdraw,
    swapCandidates,
    swapPreview,
    swap,
    swaps,
    swapDetail,
    swapDecision
  } = requestsDomain({ repository, platform, contextFor, evaluate, requirePermission });
  return {
    contextFor,
    requirePermission,
    scopedActor,
    evaluate,
    memberList,
    memberDetail,
    updateMember,
    ownProfile,
    addMembership,
    endMembership,
    permissions,
    roles,
    createRole,
    updateRole,
    previewRole,
    bindMemberRoles,
    organization,
    importMembers,
    importEducation,
    saveWorkProfile,
    deskSummary,
    workbench,
    createAttendanceEvent,
    issueAttendanceToken,
    checkIn,
    directCheckIn,
    directAttendanceAction,
    previewAttendance,
    attendanceList,
    attendanceOptions,
    correctAttendance,
    presence,
    rosterOptions,
    rosterTasks,
    rosterCandidates,
    collectionCommand,
    addParticipants,
    submitAvailability,
    reviseRoster,
    taskAvailability,
    createRosterTask,
    rosterRequirements,
    saveAvailability,
    rosterTaskState,
    generate,
    updateRoster,
    importRoster,
    publish,
    rosterMine,
    seriesCommand,
    availabilityPreferences,
    leave,
    leaves,
    leaveDetail,
    leaveDecision,
    leaveWithdraw,
    swapCandidates,
    swapPreview,
    swapDetail,
    swap,
    swaps,
    swapDecision,
    attendanceExport,
    reportSettings,
    saveReportSettings,
    volunteerReport,
    attendanceMatrix,
    audit,
    recordAudit: (input) => repository.audit(input)
  };
}
