import { guestAppointment } from './access.js';
import { dateKey, expiredBookingDate, nowIso } from '../../shared/time.js';
import { TIME_SLOTS } from '../../shared/constants.js';

export function queueService(appointments, queue) {
  return {
    async summary(query, accessToken) {
      let current = query.appointmentId ? await guestAppointment(appointments,query.appointmentId,accessToken) : null;
      await appointments.endNoShows(expiredBookingDate(), nowIso(), current ? {id:current.id} : {});
      if (current) current = await appointments.find(current.id);
      const date = query.date || current?.date || dateKey();
      const selection = { date, campus: query.campus || current?.campus || '', timeSlot: query.timeSlot || current?.timeSlot || '' };
      const { counts, slots, capacities, queue: position } = await queue.summary(selection, current);
      const allSlotCapacities = Object.fromEntries(capacities.map(row => [row.time_slot, Number(row.capacity)]));
      const slotCapacities = Object.fromEntries(TIME_SLOTS.map(slot => [slot, allSlotCapacities[slot] ?? 0]));
      const capacity = selection.timeSlot ? (allSlotCapacities[selection.timeSlot] ?? 0) : Object.values(slotCapacities).reduce((sum, value) => sum + value, 0);
      return { date, dayTotal: counts.dayTotal, campusDayTotal: counts.campusDayTotal, slotTotal: counts.slotTotal, capacity, slotCapacities,
        slots: Object.fromEntries([...TIME_SLOTS, '19:00–20:00', '20:00–21:00'].map(slot => [slot, Number(slots.find(row => row.time_slot === slot)?.total || 0)])),
        ahead: position?.present ? position.ahead : null, position: position?.present ? position.ahead + 1 : null,
        queueTotal: position ? position.queueTotal : counts.slotTotal };
    }
  };
}
