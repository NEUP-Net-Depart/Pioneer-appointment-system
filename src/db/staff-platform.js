import { serviceDayRepository } from './service-days.js';
import { memberImportDomain } from './staff-platform/member-import.js';
import { membersDomain } from './staff-platform/members.js';
import { fieldDomain } from './staff-platform/field.js';
import { rolesDomain } from './staff-platform/roles.js';
import { attendanceDomain } from './staff-platform/attendance.js';
import { commandsDomain } from './staff-platform/commands.js';
import { scheduleRepository } from './staff-platform/schedule.js';
import { dutyRepository } from './staff-platform/duty.js';
import { workloadRepository } from './staff-platform/workload.js';

export function staffPlatformRepository(db) {
  const commands = commandsDomain({ db });
  const deps = { db, ...commands };
  const attendance = attendanceDomain(deps);
  return {
    ...commands,
    ...membersDomain(deps),
    ...memberImportDomain(deps),
    ...rolesDomain(deps),
    ...attendance,
    ...fieldDomain({ db, event: attendance.event }),
    ...scheduleRepository(deps),
    ...dutyRepository(deps),
    ...workloadRepository(deps),
    ...serviceDayRepository(db)
  };
}
