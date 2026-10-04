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

// UTC here is only a timezone-independent calendar calculator, not the business timezone.
const calendar = key => new Date(`${key}T00:00:00Z`);
const calendarKey = date => `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
export function validDate(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const date = calendar(key);
  return Number.isFinite(date.getTime()) && calendarKey(date) === key;
}
export function addDays(key, days) {
  const date = calendar(key);
  date.setUTCDate(date.getUTCDate() + days);
  return calendarKey(date);
}
export function serviceDay(key) {
  const day = calendar(key).getUTCDay();
  return day >= 1 && day <= 4;
}
export function formatDate(value) {
  if (!value) return '';
  const key = validDate(value) ? value : dateKey(new Date(value));
  const [year, month, day] = key.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
}
