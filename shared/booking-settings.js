import { addDays, dateKey } from './time.js';

export const DEFAULT_RELEASE_TIME = '10:00';
export const validReleaseTime = value => typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

// Only the booking horizon rolls at release time. Every other workflow keeps
// using the real Shanghai calendar date, including same-day appointments.
export function bookingWindow(instant = new Date(), releaseTime = DEFAULT_RELEASE_TIME) {
  const today = dateKey(instant);
  const releaseAt = new Date(`${today}T${releaseTime}:00+08:00`);
  const released = instant.getTime() >= releaseAt.getTime();
  return { start: today, end: addDays(today, released ? 3 : 2),
    nextReleaseAt: new Date(`${addDays(today, released ? 1 : 0)}T${releaseTime}:00+08:00`).toISOString() };
}
