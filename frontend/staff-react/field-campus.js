const key = 'field-campus';

export function readFieldCampus(session, campuses) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key));
    if (saved?.session === session && campuses.some((campus) => campus.id === saved.campusId))
      return saved.campusId;
  } catch {
    // Invalid preferences fall back to the authorized home campus.
  }
  sessionStorage.removeItem(key);
  return '';
}

export function writeFieldCampus(session, campusId) {
  sessionStorage.setItem(key, JSON.stringify({ session, campusId }));
}
