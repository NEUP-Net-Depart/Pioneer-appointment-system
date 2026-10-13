import { addDays, dateKey, expiredBookingDate } from '../../shared/time.js';
import { requireRole } from './permissions.js';

export function statsService(stats, appointments, clock = () => new Date()) {
  return {
    async summary({ range, day },actor) {
      requireRole(actor,'admin');
      const instant = clock();
      await (appointments.expirePending || appointments.endNoShows)(expiredBookingDate(instant), instant.toISOString(), {campuses:actor.authorizedCampuses});
      const start = day || range === 'all' ? '' : addDays(dateKey(instant), -(Number(range) - 1));
      const result = await stats.aggregate({start,day,campuses:actor.authorizedCampuses});
      const { total, completed, noShow, expired, classified, repaired } = result.summary;
      return { range, day, total, completed, noShow, expired, classified, repaired,
        repairSuccessRate: classified ? Math.round(repaired / classified * 100) : 0,
        completionRate: total ? Math.round(completed / total * 100) : 0, noShowRate: total ? Math.round(noShow / total * 100) : 0,
        daily: Object.fromEntries(result.daily.map(row => [row.date, { total: row.total, completed: row.completed }])),
        faults: Object.fromEntries(result.faults.map(row => [row.label || '未分类', row.total])),
        campuses: Object.fromEntries(result.campuses.map(row => [row.label || '未填写', row.total])),
        technicians: Object.fromEntries(result.technicians.map(row => [row.account, { started: row.started, completed: row.completed }])) };
    }
  };
}
