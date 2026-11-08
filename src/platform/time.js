import { BUSINESS_TIME_ZONE, dateKey, nowIso, weekRange, validDate, addDays } from '../../shared/time.js';

export { BUSINESS_TIME_ZONE, dateKey, nowIso, weekRange, validDate, addDays };

export function eventWindow(start, end, now = new Date()) {
  const from = new Date(start).getTime();
  const until = new Date(end).getTime();
  const current = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return Number.isFinite(from) && Number.isFinite(until) && from <= current && current <= until;
}

export function instant(value) {
  const parsed = value === undefined ? new Date() : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new TypeError('Invalid instant');
  return parsed.toISOString();
}
