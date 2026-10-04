import { fail } from '../lib/http.js';
import { dateKey } from '../../shared/time.js';
import { SLOT_CAPACITY, TIME_SLOTS } from '../../shared/constants.js';

export function queueService(appointments, queue) {
  return {
    async summary(query) {
      const current = query.appointmentId ? await appointments.findQueueEntry(query.appointmentId) : null;
      if (query.appointmentId && (!current || current.studentId !== query.studentId)) fail(404, '预约不存在');
      const date = query.date || current?.date || dateKey();
      const selection = { date, campus: query.campus || current?.campus || '', timeSlot: query.timeSlot || current?.timeSlot || '' };
      const { counts, queue: position } = await queue.summary(selection, current);
      return { date, dayTotal: counts.dayTotal, campusDayTotal: counts.campusDayTotal, slotTotal: counts.slotTotal, capacity: SLOT_CAPACITY,
        slots: { [TIME_SLOTS[0]]: counts.firstSlot, [TIME_SLOTS[1]]: counts.secondSlot },
        ahead: position?.present ? position.ahead : null, position: position?.present ? position.ahead + 1 : null,
        queueTotal: position ? position.queueTotal : counts.slotTotal };
    }
  };
}
