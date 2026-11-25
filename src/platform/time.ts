import { BUSINESS_TIME_ZONE, dateKey, nowIso, weekRange, rosterWeekKey, dutyWeekKey, validDate, addDays } from '../../shared/time.ts';

export { BUSINESS_TIME_ZONE, dateKey, nowIso, weekRange, rosterWeekKey, dutyWeekKey, validDate, addDays };

export function eventWindow(start: string, end: string, now: string | number | Date = new Date()) {
  const from = new Date(start).getTime();
  const until = new Date(end).getTime();
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return Number.isFinite(from) && Number.isFinite(until) && from <= current && current <= until;
}

export function instant(value: string) {
  const parsed = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError('Invalid instant');
  return parsed.toISOString();
}
