import { addDays, dateKey } from '../../shared/time.js';
import { staffIdentities } from '../../shared/staff-identities.js';
import { requireCampus, requireRole } from './permissions.js';

export function statsService(stats, appointments, clock = () => new Date(), staff) {
  return {
    async summary({ range, day, campus = '' },actor) {
      requireRole(actor,'technician');
      actor = await staff.scopedActor(actor, 'statistics.read');
      if (campus) requireCampus(actor, campus);
      const availableCampuses = actor.authorizedCampuses;
      const campuses = campus ? [campus] : availableCampuses;
      const instant = clock();
      await appointments.expirePending(instant.toISOString(), {campuses});
      const today = dateKey(instant);
      const start = day || range === 'all' ? '' : addDays(today, -(Number(range) - 1));
      const end = start ? today : '';
      const result = await stats.aggregate({start,end,day,campuses,identityDate:today});
      const { total, completed, cancelled, expired, classified, repaired, linkedRepairs } = result.summary;
      const technicians = result.technicians.map(row => {
        const identities = staffIdentities({
          memberships: row.primary_membership ? [JSON.parse(row.primary_membership)] : [],
          specialIdentities: JSON.parse(row.special_identities || '[]')
        });
        return [row.account, {
          assignedToName: row.assigned_to_name || '',
          studentId: row.student_id || '',
          identity: identities.find(({code}) => code !== 'staff') ?? null,
          started: row.started,
          completed: row.completed
        }];
      });
      return { range, day, availableCampuses, total, completed, cancelled, expired, classified, repaired, linkedRepairs,
        repairSuccessRate: classified ? Math.round(repaired / classified * 100) : 0,
        completionRate: total ? Math.round(completed / total * 100) : 0, expiredRate: total ? Math.round(expired / total * 100) : 0,
        daily: Object.fromEntries(result.daily.map(row => [row.date, { total: row.total, completed: row.completed }])),
        faults: Object.fromEntries(result.faults.map(row => [row.label || '未分类', row.total])),
        campuses: Object.fromEntries(result.campuses.map(row => [row.label || '未填写', row.total])),
        technicians: Object.fromEntries(technicians) };
    }
  };
}
