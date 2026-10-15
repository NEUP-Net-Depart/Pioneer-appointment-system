import { guestAppointment } from './access.js';
import { dateKey, expiredBookingDate, nowIso } from '../../shared/time.js';

export function queueService(appointments, queue) {
  return {
    async summary(query, accessToken) {
      let current = query.appointmentId ? await guestAppointment(appointments,query.appointmentId,accessToken) : null;
      await (appointments.expirePending || appointments.endNoShows)(expiredBookingDate(), nowIso(), current ? {id:current.id} : {});
      if (current) current = await appointments.find(current.id);
      const date = query.date || current?.date || dateKey();
      const selection = { date, campus: query.campus || current?.campus || '', timeSlot: query.timeSlot || current?.timeSlot || '' };
      const { counts, capacities, slotCounts, queue: position } = await queue.summary(selection, current);
      const timeSlots = [...new Set(capacities.filter(row => !selection.campus || row.campus === selection.campus).map(row => row.time_slot))].sort();
      const slotCapacities = Object.fromEntries(timeSlots.map(slot => [slot, capacities.filter(row => row.time_slot === slot && (!selection.campus || row.campus === selection.campus)).reduce((sum, row) => sum + Number(row.capacity || 0), 0)]));
      const slots = Object.fromEntries(timeSlots.map(slot => [slot, slotCounts?.filter(row => row.time_slot === slot).reduce((sum, row) => sum + Number(row.total || 0), 0) || 0]));
      const capacity = selection.timeSlot ? slotCapacities[selection.timeSlot] : Object.values(slotCapacities).reduce((sum, value) => sum + value, 0);
      return { date, dayTotal: counts.dayTotal, campusDayTotal: counts.campusDayTotal, slotTotal: counts.slotTotal, capacity, slotCapacities,
        timeSlots, slots,
        ahead: position?.present ? position.ahead : null, position: position?.present ? position.ahead + 1 : null,
        queueTotal: position ? position.queueTotal : counts.slotTotal };
    }
  };
}
