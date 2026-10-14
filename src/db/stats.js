const finished = "status='completed' AND outcome IN ('repaired','unrepaired','not_needed','legacy_unknown')";
const classified = "status='completed' AND outcome IN ('repaired','unrepaired','not_needed')";
export function statsRepository(db) {
  return {
    async aggregate({start,day,campuses:authorizedCampuses}) {
      const campusScope=authorizedCampuses.length ? `campus IN (${authorizedCampuses.map(()=>'?').join(',')})` : '0';
      const where=campusScope+(day ? ' AND date=?' : start ? ' AND date>=?' : '');
      const args=[...authorizedCampuses,...(day ? [day] : start ? [start] : [])];
      const sql = [
        `SELECT COUNT(*) AS total,COUNT(CASE WHEN ${finished} THEN 1 END) AS completed,
          COUNT(CASE WHEN outcome='no_show' THEN 1 END) AS noShow,
          COUNT(CASE WHEN outcome='expired' THEN 1 END) AS expired,
          COUNT(CASE WHEN ${classified} THEN 1 END) AS classified,
          COUNT(CASE WHEN outcome='repaired' THEN 1 END) AS repaired FROM appointments WHERE ${where}`,
        `SELECT date,COUNT(*) AS total,COUNT(CASE WHEN ${finished} THEN 1 END) AS completed FROM appointments WHERE ${where} GROUP BY date ORDER BY date`,
        `SELECT fault_type AS label,COUNT(*) AS total FROM appointments WHERE ${where} AND ${finished} GROUP BY fault_type ORDER BY total DESC,fault_type`,
        `SELECT campus AS label,COUNT(*) AS total FROM appointments WHERE ${where} GROUP BY campus ORDER BY total DESC,campus`,
        `SELECT assigned_to AS account,COUNT(*) AS started,COUNT(CASE WHEN ${finished} THEN 1 END) AS completed
          FROM appointments WHERE ${where} AND assigned_to IS NOT NULL AND (status='in_progress' OR (${finished})) GROUP BY assigned_to ORDER BY completed DESC,assigned_to`
      ];
      const [summary, daily, faults, campuses, technicians] = await db.batch(sql.map(statement => db.prepare(statement).bind(...args)));
      return { summary: summary.results[0], daily: daily.results, faults: faults.results, campuses: campuses.results, technicians: technicians.results };
    }
  };
}
