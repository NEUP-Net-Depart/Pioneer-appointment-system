import { requireRole, requireCampus } from './permissions.js';
import { fail } from '../lib/http.js';
import { dateKey,addDays,serviceDay } from '../../shared/time.js';
import { TIME_SLOTS } from '../../shared/constants.js';
import { decryptText } from '../lib/privacy.js';
import { bookingDates } from '../../shared/booking-slots.js';

export function serviceLocationService(repository,appointments,queue,encryptionKey,clock = () => new Date(),staff = null) {
  async function authorize(actor,campus) {
    if (staff?.field?.enabled) actor = await staff.scopedActor(actor,'settings.manage');
    else requireRole(actor,'admin');
    if (campus) requireCampus(actor,campus);
    return actor;
  }
  async function affectedAppointments(campus,date,actor) {
    const affected=await repository.affected(campus,date);
    const context=staff?.field?.enabled ? await staff.contextFor(actor,date) : null;
    // Reuse the same object, campus and ownership rules as the repair pages.
    // One context serves the whole list; configuration rights do not grant PII.
    return Promise.all(affected.map(async row=>{
      const target={id:row.id,campusId:campus,businessDate:date,assignedMemberId:row.assignedMemberId};
      const permitted=code=>!context || staff.evaluate(context,code,target).allowed;
      return {id:row.id,...(permitted('customer.identity.read') ? {name:row.name,studentId:row.studentId} : {}),
        ...(permitted('customer.contact.read') ? {contactType:row.contactType,...Object.fromEntries(await Promise.all(['phone','social','email','contactValue'].map(async key=>[key,await decryptText(row[key],encryptionKey)])))} : {})};
    }));
  }
  return {
    async details(campus,date,actor) {
      actor=await authorize(actor,campus);
      return {changes:await repository.changes(campus,date),affectedAppointments:await affectedAppointments(campus,date,actor)};
    },
    async availability(campus,date) {
      if (!date) return {serverNow:clock().toISOString(),items:await Promise.all(bookingDates(clock()).map(day=>this.availability(campus,day)))};
      const instant=clock();
      const [summary,location] = await Promise.all([queue.summary({campus,date}),bookingDates(instant).includes(date)
        ? appointments.ensureDefaultLocation(date,campus,instant.toISOString()) : appointments.location(date,campus)]);
      return { campus,date,timeSlots:TIME_SLOTS,slotCapacities:summary.slotCapacities,slots:summary.slots,
        location:location?.location || '',locationRevision:location?.revision ?? null,serverNow:clock().toISOString() };
    },
    async list(actor,start = dateKey(clock()),end = addDays(start,6)) {
      actor=await authorize(actor);
      const instant=clock(),today=dateKey(instant);
      for(let date=start;date<=end;date=addDays(date,1)){
        if(date>=today && serviceDay(date))await Promise.all(actor.authorizedCampuses.map(campus=>appointments.ensureDefaultLocation(date,campus,instant.toISOString())));
        if(date===end)break;
      }
      return {items:await repository.list(start,end,actor.authorizedCampuses),start,end,campuses:actor.authorizedCampuses};
    },
    async update(input,actor) {
      actor=await authorize(actor,input.campus);
      const instant=clock();
      if(input.date>=dateKey(instant) && serviceDay(input.date))await appointments.ensureDefaultLocation(input.date,input.campus,instant.toISOString());
      const item = await repository.update(input,actor.account,clock().toISOString());
      if (!item) fail(409,'维修地点已被更新，请读取最新配置后重试','LOCATION_CONFLICT');
      return {...item,affectedAppointments:await affectedAppointments(input.campus,input.date,actor),changes:await repository.changes(input.campus,input.date)};
    }
  };
}
