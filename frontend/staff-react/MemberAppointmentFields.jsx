import { Select } from './SelectionControls.jsx';
import React from 'react';
import {
  additionalMembershipLabels,
  globalLeadershipPositions,
  positionsFor,
  positionLabels
} from '../../shared/staff-organization.js';

export function DepartmentAppointmentFields({
  value,
  onChange,
  departments,
  allowGlobalLeadership = true,
  required = false,
  emptyLabel = '暂不设置'
}) {
  const availablePositions = (unit) =>
    positionsFor(unit).filter(
      (code) => allowGlobalLeadership || !globalLeadershipPositions.includes(code)
    );
  const availableDepartments = departments.filter((item) => availablePositions(item).length > 0);
  const unit = availableDepartments.find((item) => item.id === value.departmentId);
  return (
    <div className="react-form-grid">
      <label>
        正式部门 / 组织
        <Select
          data-track="staff.memberappointmentfields.select.1"
          required={required}
          value={value.departmentId}
          onChange={(event) => {
            const next = availableDepartments.find((item) => item.id === event.target.value);
            onChange({
              ...value,
              departmentId: event.target.value,
              positionCode: availablePositions(next)[0]
            });
          }}
        >
          <option value="">{required ? '请选择部门' : emptyLabel}</option>
          {availableDepartments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
      </label>
      <label>
        职位
        <Select
          data-track="staff.memberappointmentfields.select.2"
          disabled={!unit}
          value={value.positionCode}
          onChange={(event) => onChange({ ...value, positionCode: event.target.value })}
        >
          {availablePositions(unit).map((code) => (
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
            data-track="staff.memberappointmentfields.input.3"
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
