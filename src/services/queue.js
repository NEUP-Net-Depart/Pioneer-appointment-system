import { guestAppointment } from './access.js';
import { dateKey, expiredBookingDate } from '../../shared/time.js';
import { TIME_SLOTS } from '../../shared/constants.js';

export function queueService(appointments, queue, clock = () => new Date()) {
  const expire = (scope = {}) => { const instant = clock(); return (appointments.expirePending || appointments.endNoShows)(expiredBookingDate(instant), instant.toISOString(), scope); };
  return {
    async summary(query, accessToken) {
      let current = query.appointmentId ? await guestAppointment(appointments,query.appointmentId,accessToken) : null;
      await expire(current ? {id:current.id} : {});
      if (current) current = await appointments.find(current.id);
      const date = query.date || current?.date || dateKey();
      const selection = { date, campus: query.campus || current?.campus || '', timeSlot: query.timeSlot || current?.timeSlot || '' };
      const { counts, capacities, queue: position } = await queue.summary(selection, current);
      const slotCapacities = Object.fromEntries(TIME_SLOTS.map(slot => [slot, capacities.find(row => row.time_slot === slot)?.capacity ?? 0]));
      const capacity = selection.timeSlot ? slotCapacities[selection.timeSlot] : Object.values(slotCapacities).reduce((sum, value) => sum + value, 0);
      return { date, dayTotal: counts.dayTotal, campusDayTotal: counts.campusDayTotal, slotTotal: counts.slotTotal, capacity, slotCapacities,
        slots: { [TIME_SLOTS[0]]: counts.firstSlot, [TIME_SLOTS[1]]: counts.secondSlot },
        ahead: position?.present ? position.ahead : null, position: position?.present ? position.ahead + 1 : null,
        queueTotal: position ? position.queueTotal : counts.slotTotal };
    }
  };
}
