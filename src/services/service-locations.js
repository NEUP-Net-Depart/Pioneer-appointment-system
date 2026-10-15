import { requireRole, requireCampus } from './permissions.js';
import { fail } from '../lib/http.js';
import { dateKey,addDays } from '../../shared/time.js';
import { TIME_SLOTS } from '../../shared/constants.js';
import { decryptText } from '../lib/privacy.js';
import { bookingDates } from '../../shared/booking-slots.js';

export function serviceLocationService(repository,appointments,queue,encryptionKey,clock = () => new Date()) {
  return {
    async details(campus,date,actor) {
      requireRole(actor,'admin'); requireCampus(actor,campus);
      const affected = await repository.affected(campus,date);
      return {changes:await repository.changes(campus,date),affectedAppointments:await Promise.all(affected.map(async row=>({...row,
        ...Object.fromEntries(await Promise.all(['phone','social','email','contactValue'].map(async key=>[key,await decryptText(row[key],encryptionKey)])))
      })))};
    },
    async availability(campus,date) {
      if (!date) return {serverNow:clock().toISOString(),items:await Promise.all(bookingDates(clock()).map(day=>this.availability(campus,day)))};
      const [summary,location] = await Promise.all([queue.summary({campus,date}),appointments.location(date,campus)]);
      return { campus,date,timeSlots:TIME_SLOTS,slotCapacities:summary.slotCapacities,slots:summary.slots,
        location:location?.location || '',locationRevision:location?.revision ?? null,serverNow:clock().toISOString() };
    },
    async list(actor,start = dateKey(clock()),end = addDays(start,6)) {
      requireRole(actor,'admin');
      return {items:await repository.list(start,end,actor.authorizedCampuses),start,end,campuses:actor.authorizedCampuses};
    },
    async update(input,actor) {
      requireRole(actor,'admin'); requireCampus(actor,input.campus);
      const item = await repository.update(input,actor.account,clock().toISOString());
      if (!item) fail(409,'维修地点已被更新，请读取最新配置后重试','LOCATION_CONFLICT');
      const affected = await repository.affected(input.campus,input.date);
      const affectedAppointments = await Promise.all(affected.map(async row => ({...row,
        ...Object.fromEntries(await Promise.all(['phone','social','email','contactValue'].map(async key => [key,await decryptText(row[key],encryptionKey)])))
      })));
      return {...item,affectedAppointments,changes:await repository.changes(input.campus,input.date)};
    }
  };
}
