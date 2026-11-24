import { dutyCampusNames } from '../../shared/duty.ts';

// Options come from the user's authorized campuses or the page's editable campuses.
export function preferredCampus(
  user: { authorizedCampuses?: readonly string[]; homeCampus?: string },
  campuses = user.authorizedCampuses || []
) {
  const name = (value?: string) =>
    Object.entries(dutyCampusNames).find(([id]) => id === value)?.[1] || value;
  return campuses.find((campus) => name(campus) === name(user.homeCampus)) || campuses[0] || '';
}
