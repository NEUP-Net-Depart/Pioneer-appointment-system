import { Select } from './SelectionControls.jsx';
import React from 'react';
import {
  additionalMembershipLabels,
  positionsFor,
  positionLabels
} from '../../shared/staff-organization.js';

export function DepartmentAppointmentFields({
  value,
  onChange,
  departments,
  required = false,
  emptyLabel = '暂不设置'
}) {
  const unit = departments.find((item) => item.id === value.departmentId);
  return (
    <div className="react-form-grid">
      <label>
        正式部门 / 组织
        <Select
          required={required}
          value={value.departmentId}
          onChange={(event) => {
            const next = departments.find((item) => item.id === event.target.value);
            onChange({
              ...value,
              departmentId: event.target.value,
              positionCode: positionsFor(next)[0]
            });
          }}
        >
          <option value="">{required ? '请选择部门' : emptyLabel}</option>
          {departments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      </label>
      <label>
        职位
        <Select
          disabled={!unit}
          value={value.positionCode}
          onChange={(event) => onChange({ ...value, positionCode: event.target.value })}
        >
          {positionsFor(unit).map((code) => (
            <option key={code} value={code}>
              {positionLabels[code]}
            </option>
          ))}
        </Select>
      </label>
    </div>
  );
}

export function AdditionalMembershipFields({ value, onChange }) {
  const fields = {
    exchange: 'exchangeParticipation',
    maintenance_affairs: 'maintenanceParticipation'
  };
  return (
    <fieldset className="workspace-checks member-independent-identities">
      <legend>独立身份</legend>
      {Object.entries(additionalMembershipLabels).map(([type, label]) => (
        <label className="workspace-check" key={type}>
          <input
            type="checkbox"
            checked={!!value[fields[type]]}
            onChange={(event) => onChange({ ...value, [fields[type]]: event.target.checked })}
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
