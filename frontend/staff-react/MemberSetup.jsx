import React from 'react';
import { dateKey } from '../../shared/time.js';
import { positionsFor, positionLabels } from '../../shared/staff-organization.js';

export const newMemberSetup = (user) => ({
  homeCampusId: user.homeCampus === '浑南' ? 'campus-hunnan' : 'campus-nanhu',
  departmentId: '',
  positionCode: 'member',
  effectiveFrom: dateKey(),
  authorizedCampuses: [],
  exchangeParticipation: false,
  maintenanceParticipation: false,
  configureActivation: false
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
  const unit = departments.find((item) => item.id === value.departmentId);
  return (
    <fieldset className="workspace-form-fields" disabled={disabled}>
      <div className="react-form-grid">
        <label>
          正式部门 / 组织
          <select
            value={value.departmentId}
            onChange={(event) => {
              const next = departments.find((item) => item.id === event.target.value);
              change({
                departmentId: event.target.value,
                positionCode: positionsFor(next)[0],
                exchangeParticipation: false
              });
            }}
          >
            <option value="">暂不设置</option>
            {departments.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          职位
          <select
            value={value.positionCode}
            onChange={(event) => change({ positionCode: event.target.value })}
          >
            {positionsFor(unit).map((code) => (
              <option key={code} value={code}>
                {positionLabels[code]}
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
          生效日期
          <input
            type="date"
            required
            value={value.effectiveFrom}
            onChange={(event) => change({ effectiveFrom: event.target.value })}
          />
        </label>
      </div>
      <label className="workspace-check">
        <input
          type="checkbox"
          checked={!!value.maintenanceParticipation}
          onChange={(event) => change({ maintenanceParticipation: event.target.checked })}
        />
        任职维修事务
      </label>
      {canAuthorize && (
        <fieldset>
          <legend>授权校区</legend>
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
              {name}
            </label>
          ))}
        </fieldset>
      )}
      {unit?.kind === 'department' && unit.code !== 'hardware' && (
        <label className="workspace-check">
          <input
            type="checkbox"
            checked={value.exchangeParticipation}
            onChange={(event) => change({ exchangeParticipation: event.target.checked })}
          />
          参与交流维修
        </label>
      )}
      {canAuthorize && (
        <label className="workspace-check">
          <input
            type="checkbox"
            checked={value.configureActivation}
            onChange={(event) => change({ configureActivation: event.target.checked })}
          />
          配置账号激活资格
        </label>
      )}
    </fieldset>
  );
}
