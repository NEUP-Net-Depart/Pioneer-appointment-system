// Memory-only, bounded state. An account or authorization-version change drops
// every entry, including views that are not currently mounted.
const entries = new Map();
let owner = '';
let sessionVersion = 0;
let queryVersion = 0;
const listeners = new Set();
const fieldCampusKey = 'field-campus';
function sessionChanged() {
  sessionVersion++;
  for (const listener of listeners) listener();
}
export function workspaceSessionVersion() {
  return sessionVersion;
}
export function subscribeWorkspaceSession(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function workspaceQueryVersion() {
  return queryVersion;
}
export function invalidateWorkspaceQueries() {
  queryVersion++;
  for (const [key, cache] of entries) {
    if (key.startsWith('query:') && cache instanceof Map)
      for (const entry of cache.values()) entry.stale = true;
  }
}
export function setWorkspaceSession(session) {
  if (owner !== session) {
    entries.clear();
    if (owner) globalThis.sessionStorage?.removeItem(fieldCampusKey);
    owner = session;
    sessionChanged();
  }
}
export function clearWorkspaceState() {
  entries.clear();
  owner = '';
  globalThis.sessionStorage?.removeItem(fieldCampusKey);
  sessionChanged();
}
export function readFieldCampus(session, campuses) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(fieldCampusKey));
    if (saved?.session === session && campuses.some((campus) => campus.id === saved.campusId))
      return saved.campusId;
  } catch {
    sessionStorage.removeItem(fieldCampusKey);
    return '';
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
