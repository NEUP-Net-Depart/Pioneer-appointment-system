import type { ScheduleSlotRow } from './records.ts';
import type { Database } from '../platform/environment.ts';
import { scheduleStatement } from './slot-capacities.ts';
import { CAMPUSES } from '../../shared/constants.ts';

const occupied = "source='booking' AND status<>'cancelled'";
export function bookingAvailabilityRepository(db: Database) {
  return {
    async summary({ date, campus }: { date: string; campus?: string }) {
      const capacities = scheduleStatement(db, date, date, campus ? [campus] : CAMPUSES);
      const slots = db.prepare(`SELECT time_slot,COUNT(*) AS occupied FROM appointments
        WHERE ${campus ? 'campus=? AND ' : ''}date=? AND ${occupied} GROUP BY time_slot`)
        .bind(...(campus ? [campus] : []),date);
      const result = await db.batch([capacities, slots]);
      return { capacities: result[0].results as ScheduleSlotRow[], slots: result[1].results as { time_slot: string; occupied: number }[] };
    }
  };
}
