import { json,readBody,fail } from '../lib/http.js';
import { serviceLocationInput } from '../lib/validation.js';
import { validDate,addDays } from '../../shared/time.js';
import { CAMPUSES } from '../../shared/constants.js';

export const serviceLocationRoutes = [
  ['GET',/^\/api\/service-locations\/history$/,async context => {
    const actor=await context.role('admin'),{campus,date}=context.query;
    if(!CAMPUSES.includes(campus) || !validDate(date))fail(400,'请选择有效的校区和日期');
    return json(await context.services.serviceLocations.details(campus,date,actor));
  }],
  ['GET',/^\/api\/booking-availability$/,async context => {
    const {campus,date} = context.query;
    if (!CAMPUSES.includes(campus) || (date && !validDate(date))) fail(400,'请选择有效的校区和日期');
    return json(await context.services.serviceLocations.availability(campus,date));
  }],
  ['GET',/^\/api\/service-locations$/,async context => {
    const actor = await context.role('admin'),{dateFrom,dateTo} = context.query;
    if ((dateFrom || dateTo) && (!validDate(dateFrom) || !validDate(dateTo) || dateFrom>dateTo || dateTo>addDays(dateFrom,31))) fail(400,'请选择 31 天以内的有效日期范围');
    return json(await context.services.serviceLocations.list(actor,dateFrom,dateTo));
  }],
  ['PATCH',/^\/api\/service-locations$/,async context => {
    const actor = await context.role('admin'); await context.limit('write');
    return json(await context.services.serviceLocations.update(serviceLocationInput(await readBody(context.request)),actor));
  }]
];
