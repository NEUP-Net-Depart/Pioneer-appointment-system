export function statsRepository(db) {
  return {
    async aggregate({ start, day }) {
      const where = day ? 'date=?' : start ? 'date>=?' : '1=1';
      const args = day ? [day] : start ? [start] : [];
      const sql = [
        `SELECT COUNT(*) AS total,COUNT(CASE WHEN status='completed' THEN 1 END) AS completed,COUNT(CASE WHEN status='no_show' THEN 1 END) AS noShow FROM appointments WHERE ${where}`,
        `SELECT date,COUNT(*) AS total,COUNT(CASE WHEN status='completed' THEN 1 END) AS completed FROM appointments WHERE ${where} GROUP BY date ORDER BY date`,
        `SELECT fault_type AS label,COUNT(*) AS total FROM appointments WHERE ${where} AND status='completed' GROUP BY fault_type ORDER BY total DESC,fault_type`,
        `SELECT campus AS label,COUNT(*) AS total FROM appointments WHERE ${where} GROUP BY campus ORDER BY total DESC,campus`,
        `SELECT assigned_to AS account,COUNT(*) AS claimed,COUNT(CASE WHEN status='completed' THEN 1 END) AS completed FROM appointments WHERE ${where} AND assigned_to<>'' GROUP BY assigned_to ORDER BY completed DESC,assigned_to`
      ];
      const [summary, daily, faults, campuses, technicians] = await db.batch(sql.map(statement => db.prepare(statement).bind(...args)));
      return { summary: summary.results[0], daily: daily.results, faults: faults.results, campuses: campuses.results, technicians: technicians.results };
    }
  };
}
