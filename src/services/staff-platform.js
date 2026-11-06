import { contextDomain } from './staff-platform/context.js';
import { membersDomain } from './staff-platform/members.js';
import { departmentsDomain } from './staff-platform/departments.js';
import { rolesDomain } from './staff-platform/roles.js';
import { workspaceDomain } from './staff-platform/workspace.js';
import { attendanceDomain } from './staff-platform/attendance.js';
import { attendanceReportingDomain } from './staff-platform/reporting.js';
import { scheduleDomain } from './staff-platform/schedule.js';

export function staffPlatformService({ repository, platform, manifests }) {
  const context = contextDomain({ repository, platform });
  const deps = { repository, platform, ...context };
  const members = membersDomain(deps);
  return {
    ...context,
    ...members,
    ...departmentsDomain(deps),
    ...rolesDomain({ ...deps, memberTarget: members.memberTarget }),
    ...workspaceDomain({ ...deps, manifests }),
    ...attendanceDomain(deps),
    ...attendanceReportingDomain(deps),
    ...scheduleDomain(deps),
    recordAudit: (input) => repository.audit(input)
  };
}
