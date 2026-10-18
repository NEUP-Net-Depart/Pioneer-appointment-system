export const APPOINTMENT_SEARCH_LIMIT = 8;
export const APPOINTMENT_SEARCH_MIN_DIGITS = 2;
export function parseAppointmentSearch(value) {
  if (typeof value !== 'string' || value.length > 80) return null;
  const text = value.trim().replace(/^(?:reserve|reverse)/i, '');
  if (!/^\d+(?:-\d*)?$/.test(text)) return null;
  return { text, acrossDates: text.includes('-'), ready: text.replace('-', '').length >= APPOINTMENT_SEARCH_MIN_DIGITS };
}
