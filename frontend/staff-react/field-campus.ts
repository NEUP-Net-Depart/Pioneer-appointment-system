import { isObject } from '../../shared/api-types.ts';
const key = 'field-campus';

export function readFieldCampus(session: string, campuses: readonly { id: string }[]) {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (
      isObject(saved) &&
      saved.session === session &&
      typeof saved.campusId === 'string' &&
      campuses.some((campus) => campus.id === saved.campusId)
    )
      return saved.campusId;
  } catch {
    // Invalid preferences fall back to the authorized home campus.
  }
  sessionStorage.removeItem(key);
  return '';
}

export function writeFieldCampus(session: string, campusId: string) {
  sessionStorage.setItem(key, JSON.stringify({ session, campusId }));
}
