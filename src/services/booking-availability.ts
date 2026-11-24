import type { bookingAvailabilityRepository } from '../db/booking-availability.ts';
import { dateKey } from '../../shared/time.ts';
export function bookingAvailabilityService(repository: ReturnType<typeof bookingAvailabilityRepository>,clock=()=>new Date()) {
  return {async summary(query: { date?: string; campus?: string }) {
    const date=query.date || dateKey(clock());
    const {capacities,slots:occupied}=await repository.summary({date,campus:query.campus || ''});
    const timeSlots=[...new Set(capacities.map(row=>row.time_slot))].sort();
    const slotCapacities=Object.fromEntries(timeSlots.map(slot=>[slot,capacities.filter(row=>row.time_slot===slot).reduce((sum,row)=>sum+row.capacity,0)]));
    return {date,slotCapacities,timeSlots,slots:Object.fromEntries(timeSlots.map(slot=>[slot,occupied.find(row=>row.time_slot===slot)?.occupied ?? 0]))};
  }};
}
