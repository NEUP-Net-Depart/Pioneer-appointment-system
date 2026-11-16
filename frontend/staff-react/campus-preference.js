import { dutyCampusNames } from '../../shared/duty.js';

// Options come from the user's authorized campuses or the page's editable campuses.
export function preferredCampus(user, campuses = user.authorizedCampuses || []) {
  const name = (value) => dutyCampusNames[value] || value;
  return campuses.find((campus) => name(campus) === name(user.homeCampus)) || campuses[0] || '';
}
