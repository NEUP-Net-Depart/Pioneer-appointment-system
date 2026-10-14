import { csvLine, textStream } from '../lib/csv.js';
import { presentAppointment } from './appointments.js';
import { statusLabels, outcomeLabels } from '../../shared/constants.js';
import { expiredBookingDate } from '../../shared/time.js';
import { requireRole } from './permissions.js';

const headers = ['预约编号','学号','姓名','学院','校区','联系方式','设备类型','品牌','型号','故障类型','日期','时段','状态','维修人员','维修记录','结束结果','开始时间(UTC)','结束时间(UTC)','历史维修编号'];
export function exportService(appointments, encryptionKey, clock = () => new Date()) {
  return {
    async csv(actor) {
      requireRole(actor,'admin');
      const campuses=actor.authorizedCampuses;
      const instant = clock();
      await (appointments.expirePending || appointments.endNoShows)(expiredBookingDate(instant), instant.toISOString(), {campuses});
      const firstPage=await appointments.exportPage(null,200,campuses);
      // Validate/decrypt the initial page before committing HTTP headers.
      const present = rows => Promise.all(rows.map(row => presentAppointment(row, encryptionKey)));
      const initial = await present(firstPage);
      async function* chunks() {
        yield '\ufeff' + csvLine(headers);
        let page = initial;
        while (page.length) {
          for (const item of page) yield csvLine([item.id,item.studentId,item.name,item.college,item.campus,item.phone,item.deviceType,item.brand,item.deviceModel,item.faultType,item.date,item.timeSlot,statusLabels[item.status],item.assignedTo,item.repairNote,outcomeLabels[item.outcome] || '',item.startedAt || '',item.completedAt || '',item.repairNumber || '']);
          page = await present(await appointments.exportPage(page.at(-1),200,campuses));
        }
      }
      return textStream(chunks());
    }
  };
}
