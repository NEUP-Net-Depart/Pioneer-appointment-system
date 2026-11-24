import type { AuditRecordInput } from '../db/records.ts';
import type { StaffDomainDependencies } from './staff-platform/context.ts';

export type StaffService = ReturnType<typeof staffPlatformService>;
import { contextDomain } from './staff-platform/context.ts';
import { membersDomain } from './staff-platform/members.ts';
import { rolesDomain } from './staff-platform/roles.ts';
import { workspaceDomain } from './staff-platform/workspace.ts';
import { attendanceDomain } from './staff-platform/attendance.ts';
import { attendanceReportingDomain } from './staff-platform/reporting.ts';
import { scheduleDomain } from './staff-platform/schedule.ts';
import { dutyDomain } from './staff-platform/duty.ts';

export function staffPlatformService({
  repository,
  platform,
  manifests
}: Pick<StaffDomainDependencies, 'repository' | 'platform'> & {
  manifests: StaffDomainDependencies['platform']['manifests'];
}) {
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
    recordAudit: (input: AuditRecordInput) => repository.audit(input)
  };
}
