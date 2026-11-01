import React from 'react';
import { dateKey } from '../../shared/time.js';

export const memberKinds = {
  member: '普通成员',
  repair: '普通维修',
  exchange: '交流人员',
  office: '办公人员'
};
const roleCodes = { repair: 'technician', exchange: 'exchange', office: 'office' };
export const newMemberSetup = (user) => ({
  kind: 'member',
  homeCampusId: user.homeCampus === '浑南' ? 'campus-hunnan' : 'campus-nanhu',
  departmentId: '',
  assignmentType: 'primary',
  effectiveFrom: dateKey(),
  activate: false,
  trainingConfirmed: false
});
export function memberDefaults(setup) {
  return {
    homeCampusId: setup.homeCampusId,
    departmentId: setup.departmentId,
    assignmentType: setup.assignmentType,
    effectiveFrom: setup.effectiveFrom,
    workProfiles: setup.kind === 'member' ? [] : [setup.kind],
    trainingConfirmed: setup.trainingConfirmed,
    ...(setup.activate && roleCodes[setup.kind]
      ? { roleCodes: [roleCodes[setup.kind]], authorizedCampuses: [setup.homeCampusId] }
      : {})
  };
}
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
      <div className="react-form-grid">
        <label>
          实际部门
          <select
            value={value.departmentId}
            onChange={(event) => change({ departmentId: event.target.value })}
          >
            <option value="">暂不设置</option>
            {departments.map((department) => (
              <option key={department.id} value={department.id}>
                {department.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          人员类型
          <select
            value={value.kind}
            onChange={(event) => change({ kind: event.target.value, trainingConfirmed: false })}
          >
            {Object.entries(memberKinds).map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
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
          任职类型
          <select
            value={value.assignmentType}
            onChange={(event) => change({ assignmentType: event.target.value })}
          >
            <option value="primary">主要任职</option>
            <option value="secondary">兼任</option>
            <option value="exchange">交流</option>
            <option value="temporary">临时</option>
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
      {value.kind === 'exchange' && (
        <label className="workspace-check">
          <input
            type="checkbox"
            checked={value.trainingConfirmed}
            onChange={(event) => change({ trainingConfirmed: event.target.checked })}
          />
          已确认交流人员通过维修培训
        </label>
      )}
      {canAuthorize && value.kind !== 'member' && (
        <label className="workspace-check">
          <input
            type="checkbox"
            checked={value.activate}
            onChange={(event) => change({ activate: event.target.checked })}
          />
          同时配置工作角色与激活资格
        </label>
      )}
    </fieldset>
  );
}
