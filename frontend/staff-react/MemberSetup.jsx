import React from 'react';
import { dateKey } from '../../shared/time.js';
import {
  DepartmentAppointmentFields,
  AdditionalMembershipFields
} from './MemberAppointmentFields.jsx';

export const newMemberSetup = (user) => ({
  homeCampusId: user.homeCampus === '浑南' ? 'campus-hunnan' : 'campus-nanhu',
  departmentId: '',
  positionCode: 'member',
  effectiveFrom: dateKey(),
  authorizedCampuses: [],
  exchangeParticipation: false,
  maintenanceParticipation: false
});
export const memberDefaults = (setup) => ({ ...setup });
export function MemberSetup({
  value,
  onChange,
  departments,
  canAuthorize = false,
  disabled = false
}) {
  const change = (patch) => onChange({ ...value, ...patch });
  return (
    <fieldset className="workspace-form-fields" disabled={disabled}>
      <DepartmentAppointmentFields value={value} onChange={onChange} departments={departments} />
      <AdditionalMembershipFields value={value} onChange={onChange} />
      <div className="react-form-grid">
        <label>
          所属校区
          <select
            value={value.homeCampusId}
            onChange={(event) => change({ homeCampusId: event.target.value })}
          >
            <option value="campus-nanhu">南湖</option>
            <option value="campus-hunnan">浑南</option>
          </select>
        </label>
        <label>
          生效日期
          <input
            type="date"
            required
            value={value.effectiveFrom}
            onChange={(event) => change({ effectiveFrom: event.target.value })}
          />
        </label>
      </div>
      {canAuthorize && (
        <fieldset className="workspace-campus-options">
          <legend>授权校区（新增人员默认所属校区）</legend>
          {[
            ['campus-nanhu', '南湖'],
            ['campus-hunnan', '浑南']
          ].map(([id, name]) => (
            <label className="workspace-check" key={id}>
              <input
                type="checkbox"
                checked={value.authorizedCampuses.includes(id)}
                onChange={(event) =>
                  change({
                    authorizedCampuses: event.target.checked
                      ? [...value.authorizedCampuses, id].sort()
                      : value.authorizedCampuses.filter((item) => item !== id)
                  })
                }
              />
              <span>{name}</span>
            </label>
          ))}
        </fieldset>
      )}
    </fieldset>
  );
}
