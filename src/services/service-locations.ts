import type { StaffAccountDto } from '../../shared/staff-types.ts';
import type { serviceLocationRepository } from '../db/service-locations.ts';
import type { serviceLocationInput } from '../lib/validation.ts';
import type { appointmentRepository } from '../db/appointments.ts';
import type { bookingAvailabilityService } from './booking-availability.ts';
import type { bookingSettingsService } from './booking-settings.ts';
import type { StaffService } from './staff-platform.ts';

import { requireCampus } from './permissions.ts';
import { fail } from '../lib/http.ts';
import { dateKey,addDays,serviceDay } from '../../shared/time.ts';
import { TIME_SLOTS } from '../../shared/constants.ts';
import { decryptText } from '../lib/privacy.ts';
import { bookingDates } from '../../shared/booking-slots.ts';

export function serviceLocationService(
  repository: ReturnType<typeof serviceLocationRepository>,
  appointments: Pick<ReturnType<typeof appointmentRepository>, 'ensureDefaultLocation' | 'location' | 'serviceDay'>,
  availability: Pick<ReturnType<typeof bookingAvailabilityService>, 'summary'>,
  encryptionKey: string, clock = () => new Date(),
  staff: Pick<StaffService, 'scopedActor' | 'contextFor' | 'evaluate'>,
  bookingSettings?: Pick<ReturnType<typeof bookingSettingsService>, 'public'>
) {
  async function authorize(actor: StaffAccountDto, campus?: string) {
    actor = await staff.scopedActor(actor,'booking.manage');
    if (campus) requireCampus(actor,campus);
    return actor;
  }
  async function affectedAppointments(campus: string,date: string,actor: StaffAccountDto) {
    const affected=await repository.affected(campus,date);
    const context=await staff.contextFor(actor,date);
    // Reuse the same object, campus and ownership rules as the repair pages.
    // One context serves the whole list; configuration rights do not grant PII.
    return Promise.all(affected.map(async row=>{
      const target={id:row.id,campusId:campus,businessDate:date,assignedMemberId:row.assignedMemberId ?? undefined};
      const permitted=(code: string)=>staff.evaluate(context,code,target).allowed;
      return {id:row.id,...(permitted('customer.identity.read') ? {name:row.name,studentId:row.studentId} : {}),
        ...(permitted('customer.contact.read') ? {contactType:row.contactType,...Object.fromEntries(await Promise.all((['phone','social','email','contactValue'] as const).map(async key=>[key,await decryptText(row[key] ?? '',encryptionKey)])))} : {})};
    }));
  }
  async function dayAvailability(campus: string, date: string, bookable: boolean, serverNow: string) {
    const [summary, location, service] = await Promise.all([
      availability.summary({ campus, date }),
      bookable ? appointments.ensureDefaultLocation(date, campus, serverNow) : appointments.location(date, campus),
      appointments.serviceDay(date, campus)
    ]);
    return {
      campus, date, paused: !!service?.paused, pauseReason: service?.paused ? service.reason : '',
      timeSlots: TIME_SLOTS, slotCapacities: summary.slotCapacities, slots: summary.slots,
      location: location?.location || '', locationRevision: location?.revision ?? null, serverNow
    };
  }
  return {
    async details(campus: string,date: string,actor: StaffAccountDto) {
      actor=await authorize(actor,campus);
      return {changes:await repository.changes(campus,date),affectedAppointments:await affectedAppointments(campus,date,actor)};
    },
    async availability(campus: string, date?: string) {
      const settings = await bookingSettings?.public(campus);
      const serverNow = settings?.serverNow ?? clock().toISOString();
      const dates = bookingDates(new Date(serverNow), settings?.releaseTime);
      if (date) return dayAvailability(campus, date, dates.includes(date), serverNow);
      const items = await Promise.all(dates.map(day => dayAvailability(campus, day, true, serverNow)));
      return { serverNow, ...(settings ? { bookingSettings: settings } : {}), items };
    },
    async list(actor: StaffAccountDto,start = dateKey(clock()),end = addDays(start,6)) {
      actor=await authorize(actor);
      const instant=clock(),today=dateKey(instant);
      for(let date=start;date<=end;date=addDays(date,1)){
        if(date>=today && serviceDay(date))await Promise.all(actor.authorizedCampuses.map(campus=>appointments.ensureDefaultLocation(date,campus,instant.toISOString())));
        if(date===end)break;
      }
      return {items:await repository.list(start,end,actor.authorizedCampuses),start,end,campuses:actor.authorizedCampuses};
    },
    async update(input: ReturnType<typeof serviceLocationInput>,actor: StaffAccountDto) {
      actor=await authorize(actor,input.campus);
      const instant=clock();
      if(input.date>=dateKey(instant) && serviceDay(input.date))await appointments.ensureDefaultLocation(input.date,input.campus,instant.toISOString());
      const item = await repository.update(input,actor.account,clock().toISOString());
      if (!item) fail(409,'维修地点已被更新，请读取最新配置后重试','LOCATION_CONFLICT');
      return {...item,affectedAppointments:await affectedAppointments(input.campus,input.date,actor),changes:await repository.changes(input.campus,input.date)};
    }
  };
}
