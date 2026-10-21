import { TIME_SLOTS } from './constants.js';
import { addDays, dateKey, serviceDay, slotDeadline } from './time.js';
import { bookingWindow, DEFAULT_RELEASE_TIME } from './booking-settings.js';

export function availableSlots(date, instant = new Date(), slots = TIME_SLOTS) {
  return slots.filter(slot => Date.parse(slotDeadline(date, slot)) > instant.getTime());
}

export function bookingDates(instant = new Date(), releaseTime = DEFAULT_RELEASE_TIME) {
  const today = dateKey(instant), window = bookingWindow(instant, releaseTime);
  return [0, 1, 2, 3].map(offset => addDays(today, offset))
    .filter(date => date <= window.end && serviceDay(date) && availableSlots(date, instant).length > 0);
}

export function slotAvailability(summary, date, slot, instant = new Date()) {
  const capacity = summary.slotCapacities[slot] ?? 0;
  const remaining = Math.max(0, capacity - (summary.slots[slot] || 0));
  const ended = !availableSlots(date, instant, summary.timeSlots || Object.keys(summary.slotCapacities)).includes(slot);
  return {
    capacity, remaining, ended, disabled: !!summary.paused || ended || remaining === 0 || summary.location === '',
    label: summary.paused ? '暂停维修' : summary.location === '' ? '地点未配置' : ended ? '时段已结束' : capacity === 0 ? '暂停预约' : remaining === 0 ? '预约已满' : `剩余 ${remaining} 名`
  };
}
