import {addDays} from '../../platform/time.js';
// Release and deadline weekdays refer to the week before the duty week.
export function collectionInstant(weekStart,weekday,time) {
  return new Date(`${addDays(weekStart,Number(weekday)-8)}T${time}:00+08:00`).toISOString();
}
export function validateRecurrence(value) {
  return value&&['publishWeekday','deadlineWeekday'].every(key=>Number.isInteger(value[key])&&value[key]>=1&&value[key]<=7)&&
    ['publishTime','deadlineTime'].every(key=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value[key]))&&
    (value.deadlineWeekday>value.publishWeekday||value.deadlineWeekday===value.publishWeekday&&value.deadlineTime>value.publishTime);
}
