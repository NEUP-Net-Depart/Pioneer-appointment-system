import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext, Notice } from './field/ui';
import { request } from './request.js';
import { dateKey, addDays } from '../../shared/time.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';

const labels = { primary: '主要任职', secondary: '兼任', exchange: '交流', temporary: '临时' };
const empty = () => ({
  departmentId: '',
  assignmentType: 'primary',
  effectiveFrom: dateKey(),
  effectiveTo: ''
});
export function MemberMemberships({ detail, departments, onSaved, onDirty, onBusy }) {
  const active = useContext(ActivityContext),
    lock = useRef(false);
  const [draft, setDraft] = useState(empty),
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
      setError('');
    }
  });
  async function save(event) {
    event.preventDefault();
    if (lock.current) return;
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
                ...draft,
                effectiveTo: draft.effectiveTo || null,
                revision: detail.member.revision,
                requestId: crypto.randomUUID()
              }
        }
      );
      await onSaved();
      setDraft(empty());
      setEnding(null);
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
      <Notice>{error}</Notice>
      <section aria-label="部门任职记录">
        {detail.member.memberships?.length ? (
          detail.member.memberships.map((item) => (
            <article className="react-binding" key={item.id}>
              <strong>
                {item.departmentName} · {labels[item.assignmentType]}
              </strong>
              <p>
                {item.effectiveFrom} 至 {item.effectiveTo || '长期有效'}
              </p>
              {editable && (!item.effectiveTo || item.effectiveTo > dateKey()) && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setEnding(item);
                    setEndDate(
                      dateKey() > item.effectiveFrom ? dateKey() : addDays(item.effectiveFrom, 1)
                    );
                  }}
                >
                  结束任职
                </button>
              )}
            </article>
          ))
        ) : (
          <p>暂无部门任职</p>
        )}
      </section>
      {editable && (
        <form ref={form} className="workspace-form" onSubmit={save}>
          <fieldset className="workspace-form-fields" disabled={busy}>
            <legend>{ending ? `结束 ${ending.departmentName} 任职` : '新增任职'}</legend>
            {ending ? (
              <label>
                结束日期
                <input
                  type="date"
                  required
                  min={addDays(ending.effectiveFrom, 1)}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </label>
            ) : (
              <>
                <label>
                  实际部门
                  <select
                    required
                    value={draft.departmentId}
                    onChange={(event) => setDraft({ ...draft, departmentId: event.target.value })}
                  >
                    <option value="">请选择部门</option>
                    {departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  任职类型
                  <select
                    value={draft.assignmentType}
                    onChange={(event) => setDraft({ ...draft, assignmentType: event.target.value })}
                  >
                    {Object.entries(labels).map(([code, label]) => (
                      <option key={code} value={code}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="react-form-grid">
                  <label>
                    生效日期
                    <input
                      type="date"
                      required
                      value={draft.effectiveFrom}
                      onChange={(event) =>
                        setDraft({ ...draft, effectiveFrom: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    结束日期（可选）
                    <input
                      type="date"
                      min={draft.effectiveFrom ? addDays(draft.effectiveFrom, 1) : undefined}
                      value={draft.effectiveTo}
                      onChange={(event) => setDraft({ ...draft, effectiveTo: event.target.value })}
                    />
                  </label>
                </div>
              </>
            )}
            <div className="field-actions">
              {ending && (
                <button type="button" onClick={() => setEnding(null)}>
                  取消
                </button>
              )}
              <button className="react-primary">
                {busy ? '正在保存…' : ending ? '确认结束任职' : '新增任职'}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  );
}
