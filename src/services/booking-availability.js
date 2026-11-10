import { dateKey } from '../../shared/time.js';
export function bookingAvailabilityService(repository,clock=()=>new Date()) {
  return {async summary(query) {
    const date=query.date || dateKey(clock());
    const {capacities,slots:occupied}=await repository.summary({date,campus:query.campus || ''});
    const timeSlots=[...new Set(capacities.map(row=>row.time_slot))].sort();
    const slotCapacities=Object.fromEntries(timeSlots.map(slot=>[slot,capacities.filter(row=>row.time_slot===slot).reduce((sum,row)=>sum+row.capacity,0)]));
    return {date,slotCapacities,timeSlots,slots:Object.fromEntries(timeSlots.map(slot=>[slot,occupied.find(row=>row.time_slot===slot)?.occupied ?? 0]))};
  }};
}
