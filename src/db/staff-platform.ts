export type StaffRepository = ReturnType<typeof staffPlatformRepository>;
import type { Database } from '../platform/environment.ts';
import { serviceDayRepository } from './service-days.ts';
import { memberImportDomain } from './staff-platform/member-import.ts';
import { membersDomain } from './staff-platform/members.ts';
import { fieldDomain } from './staff-platform/field.ts';
import { rolesDomain } from './staff-platform/roles.ts';
import { attendanceDomain } from './staff-platform/attendance.ts';
import { commandsDomain } from './staff-platform/commands.ts';
import { scheduleRepository } from './staff-platform/schedule.ts';
import { dutyRepository } from './staff-platform/duty.ts';
import { workloadRepository } from './staff-platform/workload.ts';

export function staffPlatformRepository(db: Database) {
  const commands = commandsDomain({ db });
  const deps = { db, ...commands };
  const attendance = attendanceDomain(deps);
  const members = membersDomain(deps);
  return {
    ...commands,
    ...members,
    ...memberImportDomain(deps),
    ...rolesDomain(deps),
    ...attendance,
    ...fieldDomain({ db, event: attendance.event, reader: members }),
    ...scheduleRepository(deps),
    ...dutyRepository(deps),
    ...workloadRepository(deps),
    ...serviceDayRepository(db)
  };
}
