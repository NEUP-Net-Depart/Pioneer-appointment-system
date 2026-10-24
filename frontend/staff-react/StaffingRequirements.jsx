import { WorkspaceSkeleton } from './WorkspaceSkeleton';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { request } from './request.js';
import { ActivityContext } from './field/ui';
import { useUnsavedChanges } from './useUnsavedChanges.js';

const campusNames = { 'campus-nanhu': '南湖校区', 'campus-hunnan': '浑南校区' };
export function RequirementEditor({ taskId, onSaved, onDirty }) {
  const active = useContext(ActivityContext),
    serial = useRef(0),
    lock = useRef(false);
  const [data, setData] = useState(null),
    [rows, setRows] = useState([]),
    [uniform, setUniform] = useState(1);
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    onDirty?.(dirty);
    return () => onDirty?.(false);
  }, [dirty, onDirty]);
  async function load() {
    const sequence = ++serial.current;
    setError('');
    setBusy(true);
    try {
      const result = await request(`/api/roster-tasks/${encodeURIComponent(taskId)}/requirements`);
      if (sequence !== serial.current) return;
      setData(result);
      setRows(result.requirements);
      setUniform(result.requirements[0]?.ordinaryMinimum ?? 1);
      setDirty(false);
    } catch (failure) {
      if (sequence === serial.current) setError(failure.message);
    } finally {
      if (sequence === serial.current) setBusy(false);
    }
  }
  useEffect(() => {
    setData(null);
    setRows([]);
    setNotice('');
    load();
    return () => {
      serial.current++;
    };
  }, [taskId]);
  const navigationForm = useUnsavedChanges({
    dirty,
    active,
    busy,
    save,
    discard: () => {
      setRows(data.requirements);
      setDirty(false);
      setError('');
    }
  });
  async function save(event) {
    event.preventDefault();
    if (lock.current || !data) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await request(`/api/roster-tasks/${encodeURIComponent(taskId)}/requirements`, {
        method: 'PUT',
        body: { revision: data.task.revision, requirements: rows, requestId: crypto.randomUUID() }
      });
      setData(result);
      setRows(result.requirements);
      setDirty(false);
      setNotice('需求已保存。已发布班表保持原样，待发布草稿需要重新校验。');
      onSaved?.();
      return true;
    } catch (failure) {
      setError(failure.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="react-card staffing-editor" aria-busy={busy}>
      <div className="field-section-heading">
        <h2>{data?.task.dutyType === 'office' ? '每日办公人员目标' : '每日人员需求'}</h2>
        <button type="button" disabled={busy || dirty} onClick={load}>
          刷新
        </button>
      </div>
      {error && (
        <p role="alert" className="react-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="react-message">
          {notice}
        </p>
      )}
      {!data && !error && (
        <WorkspaceSkeleton variant="form" label="正在读取每日人员需求" rows={4} />
      )}
      {data && (
        <form ref={navigationForm} onSubmit={save}>
          <p className="react-muted">
            {data.task.dutyType === 'office'
              ? '自动排班按每日目标人数安排办公人员，优先均衡周内班次数。'
              : '每天固定安排 1 名负责人。下列人数仅计算普通维修人员，允许超过最低人数；交流人员不参与排班。'}
          </p>
          {data.requiresRuleConfirmation && (
            <p role="status" className="react-error">
              这是旧规则任务。确认需求后才会启用新规则，历史已发布班表保持不变。
            </p>
          )}
          <fieldset disabled={busy}>
            <legend>快速设置</legend>
            <div className="staffing-quick">
              <label>
                普通人员最低人数
                <input
                  type="number"
                  min="0"
                  max="300"
                  step="1"
                  value={uniform}
                  onChange={(event) => setUniform(event.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={
                  !Number.isInteger(Number(uniform)) || Number(uniform) < 0 || Number(uniform) > 300
                }
                onClick={() => {
                  setRows((current) =>
                    current.map((row) => ({ ...row, ordinaryMinimum: Number(uniform) }))
                  );
                  setDirty(true);
                  setNotice('');
                }}
              >
                应用到整周工作日
              </button>
            </div>
            <div className="staffing-days">
              {rows.map((row, index) => (
                <label key={`${row.businessDate}:${row.campusId}`}>
                  <strong>
                    {row.businessDate.slice(5).replace('-', '/')} ·{' '}
                    {
                      ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][
                        new Date(`${row.businessDate}T00:00:00Z`).getUTCDay()
                      ]
                    }
                  </strong>
                  <span>{campusNames[row.campusId] || row.campusId}</span>
                  <span className="staffing-count">
                    <input
                      aria-label={`${row.businessDate}普通人员最低人数`}
                      required
                      type="number"
                      min="0"
                      max="300"
                      step="1"
                      value={row.ordinaryMinimum}
                      onChange={(event) => {
                        const value = event.target.value;
                        setRows((current) =>
                          current.map((item, i) =>
                            i === index
                              ? { ...item, ordinaryMinimum: value === '' ? '' : Number(value) }
                              : item
                          )
                        );
                        setDirty(true);
                        setNotice('');
                      }}
                    />
                    {data.task.dutyType === 'office' ? '名办公人员' : '名普通人员'}
                  </span>
                  {data.task.dutyType !== 'office' && <small>另含 1 名负责人</small>}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="field-actions">
            <span className="react-muted">{dirty ? '有未保存的需求调整' : '已加载服务端需求'}</span>
            <button
              type="submit"
              className="field-primary"
              disabled={busy || (!dirty && !data.requiresRuleConfirmation)}
            >
              {busy
                ? '正在保存…'
                : data.requiresRuleConfirmation
                  ? '确认需求并启用新规则'
                  : '保存人员需求'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
