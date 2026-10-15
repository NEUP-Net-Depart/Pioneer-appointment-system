import { scheduleStatement } from './slot-capacities.js';

const occupied = "source='booking' AND NOT (status='completed' AND outcome='cancelled')";
const active = "source='booking' AND status IN ('booked','in_progress')";
export function queueRepository(db) {
  return {
    async summary({ date, campus, timeSlot }, current) {
      const campusCondition = "(?='' OR campus=?)";
      const slotCondition = `${campusCondition} AND (?='' OR time_slot=?)`;
      const counts = db.prepare(`SELECT COUNT(*) AS dayTotal,
        COUNT(CASE WHEN ${campusCondition} THEN 1 END) AS campusDayTotal,
        COUNT(CASE WHEN ${slotCondition} THEN 1 END) AS slotTotal,
        COUNT(CASE WHEN ${campusCondition} AND time_slot='19:00–20:00' THEN 1 END) AS firstSlot,
        COUNT(CASE WHEN ${campusCondition} AND time_slot='20:00–21:00' THEN 1 END) AS secondSlot
        FROM appointments WHERE date=? AND ${occupied}`)
        .bind(campus, campus, campus, campus, timeSlot, timeSlot, campus, campus, campus, campus, date);
      const capacities = scheduleStatement(db, date, date, campus ? [campus] : ['南湖', '浑南']);
      const slotCounts = db.prepare(`SELECT time_slot,COUNT(*) AS total FROM appointments
        WHERE date=? AND ${occupied} AND ${campusCondition} GROUP BY time_slot`).bind(date, campus, campus);
      const statements = [counts, capacities, slotCounts];
      if (current) statements.push(db.prepare(`SELECT COUNT(*) AS queueTotal,
        COUNT(CASE WHEN created_at<? OR (created_at=? AND id<?) THEN 1 END) AS ahead,
        COUNT(CASE WHEN id=? THEN 1 END) AS present
        FROM appointments WHERE date=? AND campus=? AND time_slot=? AND ${active}`)
        .bind(current.createdAt, current.createdAt, current.id, current.id, current.date, current.campus, current.timeSlot));
      const result = await db.batch(statements);
      return { counts: result[0].results[0], capacities: result[1].results, slotCounts: result[2].results, queue: current ? result[3].results[0] : null };
    }
  };
}
