import type { D1Result } from '@cloudflare/workers-types';

interface Summary {
  total: number;
  linkedRepairs: number;
  completed: number;
  cancelled: number;
  expired: number;
  classified: number;
  repaired: number;
}
interface DailyCount { date: string; total: number; completed: number }
interface LabelCount { label: string | null; total: number }
interface TechnicianCount {
  account: string;
  assigned_to_name: string | null;
  student_id: string | null;
  primary_membership: string | null;
  special_identities: string | null;
  started: number;
  completed: number;
}
import type { Database } from '../platform/environment.ts';
import { dateKey } from '../../shared/time.ts';
import { specialIdentitiesSql } from './staff-access.ts';

const finished = "status='completed'";
const classified = "status='completed' AND outcome IN ('repaired','partially_repaired','unrepaired','not_needed')";
export function statsRepository(db: Database) {
  return {
    async aggregate({start,end,day,campuses:authorizedCampuses,identityDate = dateKey()}: { start?: string; end?: string; day?: string; campuses: readonly string[]; identityDate?: string }) {
      const campusScope=authorizedCampuses.length ? `campus IN (${authorizedCampuses.map(()=>'?').join(',')})` : '0';
      const where=campusScope+(day ? ' AND date=?' : start ? ' AND date>=? AND date<=?' : '');
      const args=[...authorizedCampuses,...(day ? [day] : start ? [start,end] : [])];
      const sql = [
        `SELECT COUNT(*) AS total,COUNT(CASE WHEN parent_appointment_id IS NOT NULL AND status NOT IN ('cancelled','expired') AND (received_at IS NOT NULL OR started_at IS NOT NULL) THEN 1 END) AS linkedRepairs,COUNT(CASE WHEN ${finished} THEN 1 END) AS completed,
          COUNT(CASE WHEN status='cancelled' THEN 1 END) AS cancelled,
          COUNT(CASE WHEN status='expired' THEN 1 END) AS expired,
          COUNT(CASE WHEN ${classified} THEN 1 END) AS classified,
          COUNT(CASE WHEN outcome='repaired' THEN 1 END) AS repaired FROM appointments WHERE ${where}`,
        `SELECT date,COUNT(*) AS total,COUNT(CASE WHEN ${finished} THEN 1 END) AS completed FROM appointments WHERE ${where} GROUP BY date ORDER BY date`,
        `SELECT fault_type AS label,COUNT(*) AS total FROM appointments WHERE ${where} AND ${finished} GROUP BY fault_type ORDER BY total DESC,fault_type`,
        `SELECT campus AS label,COUNT(*) AS total FROM appointments WHERE ${where} GROUP BY campus ORDER BY total DESC,campus`
      ];
      const workload = db.prepare(`SELECT w.*,trim(s.name) AS assigned_to_name,m.student_id,
          (SELECT json_object('positionCode',mm.position_code,'departmentName',d.name)
           FROM member_department_memberships mm JOIN departments d ON d.id=mm.department_id
           WHERE mm.member_id=s.member_id AND mm.is_primary=1 AND d.enabled=1
             AND mm.effective_from<=? AND (mm.effective_to IS NULL OR mm.effective_to>?)) AS primary_membership,
          ${specialIdentitiesSql('s.member_id')} AS special_identities
        FROM (
          SELECT assigned_to AS account,COUNT(*) AS started,COUNT(CASE WHEN ${finished} THEN 1 END) AS completed
          FROM appointments WHERE ${where} AND assigned_to IS NOT NULL AND status IN ('in_progress','completed')
          GROUP BY assigned_to
        ) w LEFT JOIN staff_accounts s ON s.account=w.account AND s.status='enabled'
        LEFT JOIN members m ON m.id=s.member_id
        ORDER BY w.completed DESC,w.account`).bind(identityDate,identityDate,...args);
      const [summary, daily, faults, campuses, technicians] = await db.batch([
        ...sql.map(statement => db.prepare(statement).bind(...args)), workload
      ]);
      return {
        summary: (summary as D1Result<Summary>).results[0],
        daily: (daily as D1Result<DailyCount>).results,
        faults: (faults as D1Result<LabelCount>).results,
        campuses: (campuses as D1Result<LabelCount>).results,
        technicians: (technicians as D1Result<TechnicianCount>).results
      };
    }
  };
}
