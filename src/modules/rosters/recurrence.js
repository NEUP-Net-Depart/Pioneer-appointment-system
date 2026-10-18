import {addDays,dateKey,weekRange} from '../../platform/time.js';
// Opening and deadline weekdays refer to the week before the duty week.
export function collectionInstant(weekStart,weekday,time) {
  return new Date(`${addDays(weekStart,Number(weekday)-8)}T${time}:00+08:00`).toISOString();
}
export function validateRecurrence(value) {
  return value&&['publishWeekday','deadlineWeekday'].every(key=>Number.isInteger(value[key])&&value[key]>=1&&value[key]<=7)&&
    ['publishTime','deadlineTime'].every(key=>/^([01]\d|2[0-3]):[0-5]\d$/.test(value[key]))&&
    (value.deadlineWeekday>value.publishWeekday||value.deadlineWeekday===value.publishWeekday&&value.deadlineTime>value.publishTime);
}
// No scheduler advances a collection. Its current period follows the calendar;
// past weekly facts remain snapshots belonging to the same published collection.
export function recurringPeriodWeek(series,firstWeek,at=new Date()) {
  const week=weekRange(dateKey(at)).start,next=addDays(week,7);
  const current=at.getTime()>=Date.parse(collectionInstant(next,series.publish_weekday,series.publish_time))?next:week;
  return current<firstWeek?firstWeek:current;
}
