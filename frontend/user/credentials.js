const KEY='pioneerAppointmentAccess';
const valid = entry => entry && typeof entry.id==='string' && /^[01]\d{8}-\d{2,}$/.test(entry.id) && /^[A-Za-z0-9_-]{43}$/.test(entry.accessToken || '');
export function savedAppointments() {
  try {
    const entries=JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(entries) ? entries.filter(valid).slice(0,100) : [];
  } catch { return []; }
}
export function saveAppointment(entry) {
  if (!valid(entry)) return false;
  try {
    localStorage.setItem(KEY,JSON.stringify([{id:entry.id,accessToken:entry.accessToken},...savedAppointments().filter(item=>item.id!==entry.id)].slice(0,100)));
    return true;
  } catch { return false; }
}
export function privateLink(entry) {
  const url=new URL('/',location.origin);
  url.hash=new URLSearchParams({appointment:entry.id,access:entry.accessToken}).toString();
  return url.href;
}
export function parsePrivateLink(value) {
  try {
    const url=new URL(value,location.origin);
    if (url.origin!==location.origin || url.pathname!=='/') return null;
    const params=new URLSearchParams(url.hash.slice(1));
    const entry={id:params.get('appointment'),accessToken:params.get('access')};
    return valid(entry) ? entry : null;
  } catch { return null; }
}
export function credentialHeaders(entry) {
  return {'X-Appointment-Token':entry.accessToken};
}
