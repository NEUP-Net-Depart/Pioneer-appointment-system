// Memory-only, bounded state. An account or authorization-version change drops
// every entry, including views that are not currently mounted.
const entries = new Map();
let owner = '';
export function setWorkspaceSession(session) {
  if (owner !== session) {
    entries.clear();
    owner = session;
  }
}
export function clearWorkspaceState() {
  entries.clear();
  owner = '';
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
