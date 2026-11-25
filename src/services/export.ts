import type { StaffAccountDto } from '../../shared/staff-types.ts';
import type { appointmentRepository } from '../db/appointments.ts';
import type { AppointmentRecord } from '../db/records.ts';
import type { FieldWorkflow } from './field-workflow.ts';
import { csvLine, textStream } from '../lib/csv.ts';
import { statusLabels, outcomeLabels } from '../../shared/constants.ts';
import { requireRole } from './permissions.ts';

const headers = ['预约编号','学号','姓名','学院','校区','联系方式','设备类型','品牌','型号','故障类型','日期','时段','状态','维修人员','维修记录','维修结果','开始时间(UTC)','结束时间(UTC)','历史维修编号','维修人员姓名'];
export function exportService(appointments: Pick<ReturnType<typeof appointmentRepository>, 'expirePending' | 'exportPage'>, clock = () => new Date(), field: Pick<FieldWorkflow, 'projectList'>) {
  return {
    async csv(actor: StaffAccountDto) {
      requireRole(actor,'technician');
      const campuses=actor.authorizedCampuses;
      const instant = clock();
      await appointments.expirePending(instant.toISOString(), {campuses});
      const firstPage=await appointments.exportPage(null,200,campuses);
      // Validate/decrypt the initial page before committing HTTP headers.
      const present = (rows: AppointmentRecord[]) => field.projectList(actor,rows);
      const initial = await present(firstPage);
      async function* chunks() {
        yield '\ufeff' + csvLine(headers);
        let page = initial, rawPage=firstPage;
        while (rawPage.length) {
          for (const item of page) yield csvLine([item.id,item.studentId,item.name,item.college,item.campus,item.phone,item.deviceType,item.brand,item.deviceModel,item.faultType,item.date,item.timeSlot,item.status === undefined ? undefined : statusLabels[item.status],item.assignedTo,item.repairNote,(item.outcome && outcomeLabels[item.outcome as keyof typeof outcomeLabels]) || '',item.startedAt || '',item.completedAt || '',item.repairNumber || '',item.assignedToName]);
          rawPage=await appointments.exportPage(rawPage[rawPage.length - 1],200,campuses);
          page=await present(rawPage);
        }
      }
      return textStream(chunks());
    }
  };
}
