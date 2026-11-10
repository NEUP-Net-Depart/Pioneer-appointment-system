import { scheduleStatement } from './slot-capacities.js';
import { CAMPUSES } from '../../shared/constants.js';

const occupied = "source='booking' AND status<>'cancelled'";
export function bookingAvailabilityRepository(db) {
  return {
    async summary({ date, campus }) {
      const capacities = scheduleStatement(db, date, date, campus ? [campus] : CAMPUSES);
      const slots = db.prepare(`SELECT time_slot,COUNT(*) AS occupied FROM appointments
        WHERE ${campus ? 'campus=? AND ' : ''}date=? AND ${occupied} GROUP BY time_slot`)
        .bind(...(campus ? [campus] : []),date);
      const result = await db.batch([capacities, slots]);
      return { capacities: result[0].results, slots: result[1].results };
    }
  };
}
