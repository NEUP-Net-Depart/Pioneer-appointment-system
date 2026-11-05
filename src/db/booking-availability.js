import { scheduleStatement } from './slot-capacities.js';
import { CAMPUSES } from '../../shared/constants.js';

const occupied = "source='booking' AND status<>'cancelled'";
export function bookingAvailabilityRepository(db) {
  return {
    async summary({ date, campus, timeSlot }) {
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
      const result = await db.batch(statements);
      return { counts: result[0].results[0], capacities: result[1].results, slots: result[2].results };
    }
  };
}
