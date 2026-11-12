import { Select, DatePicker } from './SelectionControls.jsx';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext, Notice } from './field/ui';
import { membershipLabel } from '../../shared/staff-organization.js';
import {
  AdditionalMembershipFields,
  DepartmentAppointmentFields
} from './MemberAppointmentFields.jsx';
import { request } from './request.js';
import { dateKey, addDays } from '../../shared/time.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';

const empty = () => ({
  departmentId: '',
  exchangeParticipation: false,
  maintenanceParticipation: false,
  positionCode: 'member',
  replacesMembershipId: '',
  effectiveFrom: dateKey(),
  effectiveTo: ''
});
export function MemberMemberships({ detail, departments, onSaved, onDirty, onBusy }) {
  const active = useContext(ActivityContext),
    lock = useRef(false);
  const [draft, setDraft] = useState(empty),
    [adding, setAdding] = useState(false),
    [ending, setEnding] = useState(null),
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
  async function save(event) {
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
    } catch (failure) {
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
                  disabled={busy || adding || !!ending}
                  onClick={() => {
                    setEnding(item);
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
        <form ref={form} className="workspace-form member-membership-editor" onSubmit={save}>
          <fieldset className="workspace-form-fields" disabled={busy}>
            <legend>{ending ? `结束 ${membershipLabel(ending)}` : '新增任职与身份'}</legend>
            {ending ? (
              <label>
                结束日期
                <DatePicker
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
                  emptyLabel="不添加部门"
                />
                <AdditionalMembershipFields value={draft} onChange={setDraft} />
                {!!draft.departmentId && (
                  <>
                    <label>
                      接替任职
                      <Select
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
                      required
                      value={draft.effectiveFrom}
                      onChange={(event) =>
                        setDraft({ ...draft, effectiveFrom: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    结束日期（可选）
                    <DatePicker
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
              <button className="react-primary">
                {busy ? '正在保存…' : ending ? '确认结束任职' : '保存任职'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  );
}
