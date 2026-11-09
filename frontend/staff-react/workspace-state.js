// Memory-only, bounded state. An account or authorization-version change drops
// every entry, including views that are not currently mounted.
const entries = new Map();
let owner = '';
const fieldCampusKey = 'field-campus';
export function setWorkspaceSession(session) {
  if (owner !== session) {
    entries.clear();
    if (owner) sessionStorage.removeItem(fieldCampusKey);
    owner = session;
  }
}
export function clearWorkspaceState() {
  entries.clear();
  owner = '';
  sessionStorage.removeItem(fieldCampusKey);
}
// Only the working-campus choice survives a reload. Data stays in memory,
// and logout, account changes and authorization changes discard the choice.
export function readFieldCampus(session, campuses) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(fieldCampusKey));
    if (saved?.session === session && campuses.some((campus) => campus.id === saved.campusId))
      return saved.campusId;
  } catch {
    /* Ignore an invalid saved choice and use the authorized server default. */
  }
  sessionStorage.removeItem(fieldCampusKey);
  return '';
}
export function writeFieldCampus(session, campusId) {
  sessionStorage.setItem(fieldCampusKey, JSON.stringify({ session, campusId }));
}
export function readWorkspaceState(key) {
  return entries.get(key);
}
export function writeWorkspaceState(key, value) {
  entries.delete(key);
  entries.set(key, value);
  if (entries.size > 60) entries.delete(entries.keys().next().value);
}
export function removeWorkspaceState(key) {
  entries.delete(key);
}
