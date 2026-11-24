export const BUSINESS_TIME_ZONE = 'Asia/Shanghai';
const businessDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: BUSINESS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
});
const businessClock = new Intl.DateTimeFormat('zh-CN', {
  timeZone: BUSINESS_TIME_ZONE, hour: '2-digit', minute: '2-digit'
});

// Business dates are calendar keys in Shanghai. Event instants are stored as UTC ISO.
export function dateKey(instant = new Date()) {
  const parts = Object.fromEntries(businessDate.formatToParts(instant).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export const nowIso = () => new Date().toISOString();
export const epochSeconds = () => Math.floor(Date.now() / 1000);
export const timeLabel = (instant = new Date()) => businessClock.format(instant);
export const expirationDeadline = (date: string) => new Date(`${addDays(date, 1)}T00:00:00+08:00`).toISOString();
export const slotDeadline = (date: string, slot: string) => `${date}T${slot.split('–')[1]}:00+08:00`;
export function formatInstant(value: string | number | Date | null | undefined) {
  return value ? `${formatDate(value)} ${timeLabel(new Date(value))}` : '未记录';
}

// UTC here is only a timezone-independent calendar calculator, not the business timezone.
const calendar = (key: string) => new Date(`${key}T00:00:00Z`);
const calendarKey = (date: Date) => `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
export function validDate(key: unknown): key is string {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const date = calendar(key);
  return Number.isFinite(date.getTime()) && calendarKey(date) === key;
}
export function addDays(key: string, days: number) {
  const date = calendar(key);
  date.setUTCDate(date.getUTCDate() + days);
  return calendarKey(date);
}
export function weekRange(key = dateKey()) {
  const start = addDays(key, -((calendar(key).getUTCDay() + 6) % 7));
  return { start, end: addDays(start, 6) };
}
export function calendarWeekRange(key = dateKey()) {
  const start = addDays(key, -calendar(key).getUTCDay());
  return { start, end: addDays(start, 6) };
}
export function rosterWeekKey(key = dateKey()) {
  return addDays(calendarWeekRange(key).start, 1);
}
export function dutyWeekKey(key = dateKey()) {
  return weekRange(key).start;
}
export function serviceDay(key: string) {
  const day = calendar(key).getUTCDay();
  return day >= 1 && day <= 4;
}
export function formatDate(value: string | number | Date | null | undefined) {
  if (!value) return '';
  const key = validDate(value) ? value : dateKey(new Date(value));
  const [year, month, day] = key.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
}
