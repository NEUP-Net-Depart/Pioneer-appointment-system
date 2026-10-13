import { scheduleStatement } from './slot-capacities.js';
import { CAMPUSES } from '../../shared/constants.js';

const occupied = "source='booking' AND NOT (status='completed' AND outcome='cancelled')";
const active = "source='booking' AND status IN ('booked','in_progress')";
export function queueRepository(db) {
  return {
    async summary({ date, campus, timeSlot }, current) {
      const campusCondition = "(?='' OR campus=?)";
      const slotCondition = `${campusCondition} AND (?='' OR time_slot=?)`;
      const counts = db.prepare(`SELECT COUNT(*) AS dayTotal,
        COUNT(CASE WHEN ${campusCondition} THEN 1 END) AS campusDayTotal,
        COUNT(CASE WHEN ${slotCondition} THEN 1 END) AS slotTotal
        FROM appointments WHERE date=? AND ${occupied}`)
        .bind(campus, campus, campus, campus, timeSlot, timeSlot, date);
      const capacities = scheduleStatement(db, date, date, campus ? [campus] : CAMPUSES);
      const slots = db.prepare(`SELECT time_slot,COUNT(*) AS occupied FROM appointments
        WHERE date=? AND ${campusCondition} AND ${occupied} GROUP BY time_slot`).bind(date,campus,campus);
      const statements = [counts, capacities, slots];
      if (current) statements.push(db.prepare(`SELECT COUNT(*) AS queueTotal,
        COUNT(CASE WHEN created_at<? OR (created_at=? AND id<?) THEN 1 END) AS ahead,
        COUNT(CASE WHEN id=? THEN 1 END) AS present
        FROM appointments WHERE date=? AND campus=? AND time_slot=? AND ${active}`)
        .bind(current.createdAt, current.createdAt, current.id, current.id, current.date, current.campus, current.timeSlot));
      const result = await db.batch(statements);
      return { counts: result[0].results[0], capacities: result[1].results, slots: result[2].results, queue: current ? result[3].results[0] : null };
    }
  };
}
