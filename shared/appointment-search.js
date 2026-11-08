export const APPOINTMENT_SEARCH_LIMIT = 8;
export const APPOINTMENT_SEARCH_MIN_DIGITS = 2;
export function appointmentStudentId(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^\d{6,20}$/.test(text) ? text : null;
}
export function appointmentContactTerm(value) {
  if (typeof value !== 'string' || value.length > 80) return null;
  const text = value.trim();
  return /^(?:[1-9]\d{4,11}|[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}|[a-z][a-z\d_-]{5,19})$/i.test(text)
    ? text.toLowerCase()
    : null;
}
export function parseAppointmentSearch(value) {
  if (typeof value !== 'string' || value.length > 80) return null;
  const raw = value.trim();
  const text = raw.replace(/^(?:reserve|reverse)/i, '');
  if (/^\d+(?:-\d*)?$/.test(text)) {
    const studentId = raw === text ? appointmentStudentId(text) : null;
    return {
      text,
      acrossDates: text.includes('-'),
      ready: text.replace('-', '').length >= APPOINTMENT_SEARCH_MIN_DIGITS,
      ...(studentId ? { studentId } : {}),
      ...(raw === text && appointmentContactTerm(text) ? { contact: true } : {})
    };
  }
  if (appointmentContactTerm(raw))
    return { text: raw, acrossDates: false, ready: true, contact: true };
  if (raw && !/\p{Cc}/u.test(raw))
    return { text: raw, acrossDates: true, ready: raw.length >= 2 };
  return null;
}
