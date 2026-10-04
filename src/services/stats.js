import { addDays, dateKey } from '../../shared/time.js';

export function statsService(stats) {
  return {
    async summary({ range, day }) {
      const start = day || range === 'all' ? '' : addDays(dateKey(), -(Number(range) - 1));
      const result = await stats.aggregate({ start, day });
      const { total, completed, noShow } = result.summary;
      return { range, day, total, completed, noShow,
        completionRate: total ? Math.round(completed / total * 100) : 0, noShowRate: total ? Math.round(noShow / total * 100) : 0,
        daily: Object.fromEntries(result.daily.map(row => [row.date, { total: row.total, completed: row.completed }])),
        faults: Object.fromEntries(result.faults.map(row => [row.label || '未分类', row.total])),
        campuses: Object.fromEntries(result.campuses.map(row => [row.label || '未填写', row.total])),
        technicians: Object.fromEntries(result.technicians.map(row => [row.account, { claimed: row.claimed, completed: row.completed }])) };
    }
  };
}
