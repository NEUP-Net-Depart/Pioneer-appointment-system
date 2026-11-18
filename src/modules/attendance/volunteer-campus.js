import { dutyCampusNames } from '../../../shared/duty.js';
import { campusId } from '../authorization/scopes.js';

export function volunteerCampus(record, member) {
  for (const value of [record?.identitySnapshot?.homeCampusId, member?.homeCampusId, record?.campusId]) {
    const normalized = campusId(value);
    if (Object.hasOwn(dutyCampusNames, normalized)) return normalized;
  }
  return '';
}
