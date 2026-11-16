import { contextDomain } from './staff-platform/context.js';
import { membersDomain } from './staff-platform/members.js';
import { rolesDomain } from './staff-platform/roles.js';
import { workspaceDomain } from './staff-platform/workspace.js';
import { attendanceDomain } from './staff-platform/attendance.js';
import { attendanceReportingDomain } from './staff-platform/reporting.js';
import { scheduleDomain } from './staff-platform/schedule.js';
import { dutyDomain } from './staff-platform/duty.js';

export function staffPlatformService({ repository, platform, manifests }) {
  const context = contextDomain({ repository, platform });
  const deps = { repository, platform, ...context };
  const members = membersDomain(deps);
  const attendance = attendanceDomain(deps);
  return {
    ...context,
    ...members,
    ...rolesDomain({ ...deps, memberTarget: members.memberTarget }),
    ...workspaceDomain({ ...deps, manifests }),
    ...attendance,
    ...dutyDomain(deps),
    ...attendanceReportingDomain(deps),
    ...scheduleDomain(deps),
    recordAudit: (input) => repository.audit(input)
  };
}
