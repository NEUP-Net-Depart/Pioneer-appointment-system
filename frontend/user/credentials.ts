import type { Credential } from './types';
const KEY = 'pioneerAppointmentAccess';
const memory = new Map<string, Credential>(),
  knownAliases = new Set<string>();
let readError = false;
const valid = (entry: Partial<Credential> | null): entry is Credential =>
  !!entry &&
  typeof entry.id === 'string' &&
  /^(?:reserve|reverse)?[01]\d{8}-\d{2,}$/.test(entry.id) &&
  /^[A-Za-z0-9_-]{43}$/.test(entry.accessToken || '');
export function savedAppointments() {
  try {
    const value = localStorage.getItem(KEY),
      entries = JSON.parse(value || '[]');
    if (!Array.isArray(entries)) throw new Error('Invalid credential store');
    readError = false;
    for (const entry of entries.filter(valid).slice(0, 100).reverse())
      if (!knownAliases.has(entry.id + '/' + entry.accessToken) && !memory.has(entry.id))
        memory.set(entry.id, entry);
  } catch {
    readError = true;
  }
  return [...memory.values()].reverse();
}
export const credentialStorageError = () => readError;
export function saveAppointment(entry: Credential, previousId?: string) {
  if (!valid(entry)) return false;
  savedAppointments();
  if (previousId && previousId !== entry.id) {
    knownAliases.add(previousId + '/' + entry.accessToken);
    if (memory.get(previousId)?.accessToken === entry.accessToken) memory.delete(previousId);
  }
  memory.delete(entry.id);
  memory.set(entry.id, { id: entry.id, accessToken: entry.accessToken });
  try {
    localStorage.setItem(KEY, JSON.stringify([...memory.values()].reverse().slice(0, 100)));
    return true;
  } catch {
    return false;
  }
}
export const credentialHeaders = (entry: Credential) => ({
  'X-Appointment-Token': entry.accessToken
});
