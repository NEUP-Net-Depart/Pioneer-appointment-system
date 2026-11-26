import type { OrganizationUnitDto } from '../../shared/staff-types.ts';
import type { MemberDetailDto, MemberMembership } from './management-types.ts';

interface MembershipProps {
  detail: MemberDetailDto;
  departments: readonly OrganizationUnitDto[];
  onSaved(): unknown;
  onDirty(dirty: boolean): void;
  onBusy(busy: boolean): void;
}
import { failureFrom } from '../../shared/api-types.ts';
import { track } from '../../shared/telemetry-client.ts';
import { Select, DatePicker } from './SelectionControls.tsx';
import { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext, Notice } from './field/ui';
import { membershipLabel } from '../../shared/staff-organization.ts';
import {
  AdditionalMembershipFields,
  DepartmentAppointmentFields
} from './MemberAppointmentFields.tsx';
import { request } from './request.ts';
import { dateKey, addDays, nextYearDate, validDate } from '../../shared/time.ts';
import { useUnsavedChanges } from './useUnsavedChanges.ts';

const empty = () => ({
  departmentId: '',
  exchangeParticipation: false,
  maintenanceParticipation: false,
  positionCode: 'member' as import('../../shared/staff-types.ts').PositionCode,
  replacesMembershipId: '',
  effectiveFrom: dateKey(),
  effectiveTo: nextYearDate(dateKey())
});
export function MemberMemberships({
  detail,
  departments,
  onSaved,
  onDirty,
  onBusy
}: MembershipProps) {
  const active = useContext(ActivityContext),
    lock = useRef(false);
  const [draft, setDraft] = useState(empty),
    [adding, setAdding] = useState(false),
    [ending, setEnding] = useState<MemberMembership | null>(null),
    [endDate, setEndDate] = useState(dateKey());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const editable = detail.actions?.edit !== false;
  const dirty = !!ending || JSON.stringify(draft) !== JSON.stringify(empty());
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  const form = useUnsavedChanges({
    dirty,
    active,
    busy,
    save,
    discard: () => {
      setDraft(empty());
      setEnding(null);
      setAdding(false);
      setError('');
    }
  });
  async function save(event: { preventDefault(): void }) {
    event.preventDefault();
    if (lock.current) return;
    const memberships = [
      ...(draft.departmentId
        ? [
            {
              assignmentType: 'primary',
              departmentId: draft.departmentId,
              positionCode: draft.positionCode,
              replacesMembershipId: draft.replacesMembershipId
            }
          ]
        : []),
      ...(draft.exchangeParticipation ? [{ assignmentType: 'exchange' }] : []),
      ...(draft.maintenanceParticipation ? [{ assignmentType: 'maintenance_affairs' }] : [])
    ];
    if (!ending && !memberships.length) {
      track('flow.result', { control: 'staff.membermemberships.form.2', result: 'rejected' });
      setError('请选择正式部门或至少一种独立身份');
      return;
    }
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      await request(
        `/api/members/${encodeURIComponent(detail.member.memberId)}/memberships${ending ? `/${encodeURIComponent(ending.id)}` : ''}`,
        {
          method: ending ? 'PATCH' : 'POST',
          body: ending
            ? { revision: ending.revision, effectiveTo: endDate, requestId: crypto.randomUUID() }
            : {
                memberships,
                effectiveFrom: draft.effectiveFrom,
                effectiveTo: draft.effectiveTo || null,
                revision: detail.member.revision,
                requestId: crypto.randomUUID()
              }
        }
      );
      await onSaved();
      setDraft(empty());
      setEnding(null);
      setAdding(false);
      return true;
    } catch (failureValue) {
      const failure = failureFrom(failureValue);
      setError(failure.message);
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className="member-memberships">
      <div className="member-memberships-heading">
        <h3>任职与身份</h3>
        {editable && !adding && !ending && (
          <button
            data-track="staff.membermemberships.add"
            type="button"
            className="react-primary"
            disabled={busy}
            onClick={() => setAdding(true)}
          >
            新增任职
          </button>
        )}
      </div>
      <Notice>{error}</Notice>
      <section className="member-membership-list" aria-label="任职与独立身份记录">
        {detail.member.memberships?.length ? (
          detail.member.memberships.map((item) => (
            <article className="member-membership-row" key={item.id}>
              <div>
                <strong>{membershipLabel(item)}</strong>
                <p>
                  {item.effectiveFrom} 至 {item.effectiveTo || '长期有效'}
                </p>
              </div>
              {editable && (!item.effectiveTo || item.effectiveTo > dateKey()) && (
                <button
                  data-track="staff.membermemberships.button.1"
                  disabled={busy || adding || !!ending}
                  onClick={() => {
                    if (
                      !item.id ||
                      typeof item.effectiveFrom !== 'string' ||
                      !('revision' in item) ||
                      typeof item.revision !== 'number' ||
                      !item.departmentId
                    )
                      return;
                    setEnding({
                      ...item,
                      id: item.id,
                      departmentId: item.departmentId,
                      effectiveFrom: item.effectiveFrom,
                      revision: item.revision
                    });
                    setEndDate(dateKey() >= item.effectiveFrom ? dateKey() : item.effectiveFrom);
                  }}
                >
                  结束任职
                </button>
              )}
            </article>
          ))
        ) : (
          <p>暂无任职或独立身份</p>
        )}
      </section>
      {editable && (adding || ending) && (
        <form
          data-track="staff.membermemberships.form.2"
          ref={form}
          className="workspace-form member-membership-editor"
          onSubmit={save}
        >
          <fieldset className="workspace-form-fields" disabled={busy}>
            <legend>{ending ? `结束 ${membershipLabel(ending)}` : '新增任职与身份'}</legend>
            {ending ? (
              <label>
                结束日期
                <DatePicker
                  data-track="staff.membermemberships.input.3"
                  required
                  min={ending.effectiveFrom}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </label>
            ) : (
              <>
                <DepartmentAppointmentFields
                  value={draft}
                  onChange={(next) =>
                    setDraft({
                      ...next,
                      replacesMembershipId: next.departmentId ? next.replacesMembershipId : ''
                    })
                  }
                  departments={departments}
                  allowGlobalLeadership={detail.actions?.assignGlobalLeadership === true}
                  emptyLabel="不添加部门"
                />
                <AdditionalMembershipFields
                  value={draft}
                  onChange={(value: typeof draft) => setDraft(value)}
                />
                {!!draft.departmentId && (
                  <>
                    <label>
                      接替任职
                      <Select
                        data-track="staff.membermemberships.select.5"
                        value={draft.replacesMembershipId}
                        onChange={(event) =>
                          setDraft({ ...draft, replacesMembershipId: event.target.value })
                        }
                      >
                        <option value="">新增</option>
                        {(detail.member.memberships || [])
                          .filter(
                            (item) =>
                              item.isPrimary && (!item.effectiveTo || item.effectiveTo > dateKey())
                          )
                          .map((item) => (
                            <option key={item.id} value={item.id}>
                              {membershipLabel(item)}
                            </option>
                          ))}
                      </Select>
                    </label>
                  </>
                )}
                <div className="react-form-grid">
                  <label>
                    生效日期
                    <DatePicker
                      data-track="staff.membermemberships.input.6"
                      required
                      value={draft.effectiveFrom}
                      onChange={(event) => {
                        const effectiveFrom = event.target.value;
                        const defaultEnd =
                          validDate(draft.effectiveFrom) &&
                          draft.effectiveTo === nextYearDate(draft.effectiveFrom);
                        setDraft({
                          ...draft,
                          effectiveFrom,
                          effectiveTo:
                            validDate(effectiveFrom) && (defaultEnd || !draft.effectiveTo)
                              ? nextYearDate(effectiveFrom)
                              : draft.effectiveTo
                        });
                      }}
                    />
                  </label>
                  <label>
                    结束日期
                    <DatePicker
                      data-track="staff.membermemberships.input.7"
                      required
                      min={draft.effectiveFrom ? addDays(draft.effectiveFrom, 1) : undefined}
                      value={draft.effectiveTo}
                      onChange={(event) => setDraft({ ...draft, effectiveTo: event.target.value })}
                    />
                  </label>
                </div>
              </>
            )}
            <div className="field-actions">
              <button
                data-track="staff.membermemberships.button.8"
                type="button"
                onClick={() => {
                  setEnding(null);
                  setAdding(false);
                  setDraft(empty());
                  setError('');
                }}
              >
                取消
              </button>
              <button data-track="staff.membermemberships.button.9" className="react-primary">
                {busy ? '正在保存…' : ending ? '确认结束任职' : '保存任职'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  );
}
