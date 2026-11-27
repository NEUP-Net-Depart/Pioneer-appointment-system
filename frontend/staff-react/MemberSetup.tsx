import type {
  OrganizationUnitDto,
  PositionCode,
  StaffProfileDto
} from '../../shared/staff-types.ts';

export interface MemberSetupDraft {
  homeCampusId: string;
  departmentId: string;
  positionCode: PositionCode;
  effectiveFrom: string;
  effectiveTo: string;
  authorizedCampuses: string[];
  exchangeParticipation: boolean;
  maintenanceParticipation: boolean;
}
import { Select, DatePicker } from './SelectionControls.tsx';
import { addDays, dateKey, nextYearDate, validDate } from '../../shared/time.ts';
import {
  DepartmentAppointmentFields,
  AdditionalMembershipFields
} from './MemberAppointmentFields.tsx';

export const newMemberSetup = (user: Pick<StaffProfileDto, 'homeCampus'>): MemberSetupDraft => ({
  homeCampusId: user.homeCampus === '浑南' ? 'campus-hunnan' : 'campus-nanhu',
  departmentId: '',
  positionCode: 'member',
  effectiveFrom: dateKey(),
  effectiveTo: '',
  authorizedCampuses: [],
  exchangeParticipation: false,
  maintenanceParticipation: false
});
export const memberDefaults = (setup: MemberSetupDraft) => ({ ...setup });
export function MemberSetup({
  value,
  onChange,
  departments,
  canAuthorize = false,
  disabled = false
}: {
  value: MemberSetupDraft;
  onChange: (value: MemberSetupDraft) => void;
  departments: readonly OrganizationUnitDto[];
  canAuthorize?: boolean;
  disabled?: boolean;
}) {
  const change = (patch: Partial<MemberSetupDraft>) => onChange({ ...value, ...patch });
  return (
    <fieldset className="workspace-form-fields" disabled={disabled}>
      <DepartmentAppointmentFields value={value} onChange={onChange} departments={departments} />
      <AdditionalMembershipFields value={value} onChange={onChange} />
      <div className="react-form-grid">
        <label>
          所属校区
          <Select
            data-track="staff.membersetup.select.1"
            value={value.homeCampusId}
            onChange={(event) => change({ homeCampusId: event.target.value })}
          >
            <option value="campus-nanhu">南湖</option>
            <option value="campus-hunnan">浑南</option>
          </Select>
        </label>
      </div>
      {(value.departmentId || value.exchangeParticipation || value.maintenanceParticipation) && (
        <div className="react-form-grid">
          <label>
            生效日期
            <DatePicker
              data-track="staff.membersetup.input.2"
              required
              value={value.effectiveFrom}
              onChange={(event) => change({ effectiveFrom: event.target.value })}
            />
          </label>
          <label>
            结束日期
            <DatePicker
              data-track="staff.membersetup.effective-to"
              min={validDate(value.effectiveFrom) ? addDays(value.effectiveFrom, 1) : undefined}
              value={
                value.effectiveTo ||
                (validDate(value.effectiveFrom) ? nextYearDate(value.effectiveFrom) : '')
              }
              onChange={(event) => change({ effectiveTo: event.target.value })}
            />
          </label>
        </div>
      )}
      {canAuthorize && (
        <fieldset className="workspace-campus-options">
          <legend>授权校区（新增人员默认所属校区）</legend>
          {[
            ['campus-nanhu', '南湖'],
            ['campus-hunnan', '浑南']
          ].map(([id, name]) => (
            <label className="workspace-check" key={id}>
              <input
                data-track="staff.membersetup.input.3"
                type="checkbox"
                checked={value.authorizedCampuses.includes(id)}
                onChange={(event) =>
                  change({
                    authorizedCampuses: event.target.checked
                      ? [...value.authorizedCampuses, id].sort()
                      : value.authorizedCampuses.filter((item: string) => item !== id)
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
