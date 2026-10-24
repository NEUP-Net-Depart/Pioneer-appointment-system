import { useContext, useEffect, useState } from 'react';
import { ActivityContext, api, Notice } from './ui';
import { StaffIdentity } from '../StaffIdentity';
import type { Appointment, Person } from './types';
import { formatInstant, formatDate } from '../../../shared/time.js';

export function Reception({
  item,
  businessDate,
  onCommand,
  busy
}: {
  item: Appointment;
  businessDate: string;
  busy: boolean;
  onCommand: (action: string, extra?: Record<string, unknown>) => Promise<void>;
}) {
  const active = useContext(ActivityContext);
  const [candidates, setCandidates] = useState<Person[]>([]),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [target, setTarget] = useState(''),
    [reason, setReason] = useState(''),
    [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [resolution, setResolution] = useState(''),
    [option, setOption] = useState(''),
    [options, setOptions] = useState<{ date: string; timeSlot: string }[]>([]),
    [optionsLoading, setOptionsLoading] = useState(false);
  useEffect(() => {
    if (!active || resolution !== 'reschedule' || !item.canDispatch) return;
    const controller = new AbortController();
    setOptionsLoading(true);
    api<{ items: { date: string; timeSlot: string }[] }>(
      `/api/appointments/${encodeURIComponent(item.id)}/reception-options`,
      { signal: controller.signal }
    )
      .then((value) => {
        if (!controller.signal.aborted) setOptions(value.items);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setOptionsLoading(false);
      });
    return () => controller.abort();
  }, [active, resolution, item.id, item.canDispatch]);
  useEffect(() => {
    if (!active || !item.canDispatch || item.reception?.state !== 'queued') return;
    const controller = new AbortController();
    setLoading(true);
    api<{ items: Person[] }>(
      `/api/field/appointments/${encodeURIComponent(item.id)}/dispatch-candidates`,
      { signal: controller.signal }
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setCandidates(value.items);
          setError('');
          setTarget((current) =>
            value.items.some((person) => person.account === current) ? current : ''
          );
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          setError(failure.message);
          setCandidates([]);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active, item.id, item.revision, item.canDispatch, item.reception?.state, version]);
  async function submit(action: string) {
    if (saving || busy) return;
    setSaving(true);
    setError('');
    try {
      const selected = options.find((value) => `${value.date}|${value.timeSlot}` === option);
      await onCommand(action, {
        assignedTo: target,
        reason,
        ...(action === 'reschedule' ? selected : {})
      });
      setReason('');
      setTarget('');
      setResolution('');
    } catch (failure) {
      setError((failure as Error).message);
      setVersion((value) => value + 1);
    } finally {
      setSaving(false);
    }
  }
  if (
    !item.reception ||
    !['queued', 'assigned'].includes(item.reception.state) ||
    item.status !== 'booked'
  )
    return null;
  return (
    <section className="reception-panel" aria-label="现场接待与分派" aria-busy={saving}>
      <small className="field-state-note">
        已到场核验 · {formatInstant(item.reception.receivedAt)}
        {item.queuePosition
          ? ` · 第 ${item.queuePosition.position} 位 / ${item.queuePosition.total} 单`
          : ''}
      </small>
      {item.receptionPaused && <Notice>今日暂停维修</Notice>}
      {item.date < businessDate && <Notice>跨日待处理</Notice>}
      <Notice>{error}</Notice>
      {item.reception.state === 'assigned' ? (
        <>
          <small className="field-state-note" role="status">
            已分派给 {item.reception.assignedToName || '维修人员'} · 待接手
          </small>
          {(item.canReturn || item.canDispatch) && (
            <details className="field-details">
              <summary>{item.canReturn ? '退回现场队列' : '撤回当前分派'}</summary>
              <label>
                原因
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  minLength={2}
                  maxLength={300}
                  placeholder="退回原因"
                />
              </label>
              <button
                disabled={busy || saving || reason.trim().length < 2}
                onClick={() => void submit(item.canReturn ? 'return' : 'withdraw')}
              >
                {saving ? '正在处理…' : item.canReturn ? '退回现场队列' : '撤回分派'}
              </button>
            </details>
          )}
        </>
      ) : item.canDispatch ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit('assign');
          }}
        >
          <div className="field-section-heading">
            <h3>选择空闲维修人员</h3>
            <button
              type="button"
              disabled={loading || saving}
              onClick={() => setVersion((value) => value + 1)}
            >
              刷新人员
            </button>
          </div>
          <fieldset className="reception-candidates" disabled={busy || saving || loading}>
            <legend className="field-sr-only">选择接手人员</legend>
            {candidates.map((person) => (
              <label
                key={person.memberId}
                className={target === person.account ? 'is-selected' : ''}
              >
                <input
                  type="radio"
                  name={`receiver-${item.id}`}
                  value={person.account}
                  checked={target === person.account}
                  onChange={() => setTarget(person.account)}
                  required
                />
                <span>
                  <strong>{person.name}</strong>
                  <StaffIdentity identities={person.identities} />
                  <small>
                    今日已接 {person.workload?.started || 0} · 已完成{' '}
                    {person.workload?.completed || 0}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
          {loading ? (
            <p role="status">正在更新可接单人员…</p>
          ) : !candidates.length ? (
            <Notice>暂无空闲维修人员</Notice>
          ) : null}
          <details
            className="field-details"
            open={
              !!item.queuePosition &&
              (item.queuePosition.dispatchPosition ?? item.queuePosition.position) > 1
            }
          >
            <summary>
              {item.queuePosition &&
              (item.queuePosition.dispatchPosition ?? item.queuePosition.position) > 1
                ? '越序分派原因（必填）'
                : '分派备注（选填）'}
            </summary>
            <label>
              分派原因
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={300}
                required={
                  !!item.queuePosition &&
                  (item.queuePosition.dispatchPosition ?? item.queuePosition.position) > 1
                }
                minLength={2}
              />
            </label>
          </details>
          <button
            className="field-primary field-wide"
            disabled={
              busy ||
              saving ||
              loading ||
              !candidates.some((person) => person.account === target) ||
              (!!item.queuePosition &&
                (item.queuePosition.dispatchPosition ?? item.queuePosition.position) > 1 &&
                reason.trim().length < 2)
            }
          >
            {saving ? '正在分派…' : '确认分派，等待接手'}
          </button>
        </form>
      ) : (
        <small className="field-state-note" role="status">
          排队中 · 待分派
        </small>
      )}
      {item.canDispatch && (
        <details className="field-details">
          <summary>客户离队、改约或取消</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit(resolution);
            }}
            className="field-form"
          >
            <label>
              后续处理
              <select
                required
                value={resolution}
                onChange={(event) => {
                  setResolution(event.target.value);
                  setOption('');
                }}
              >
                <option value="">请选择</option>
                <option value="leave">退出排队，保留预约</option>
                <option value="reschedule">改约到其他开放时段</option>
                <option value="cancel">取消本次预约</option>
              </select>
            </label>
            {resolution === 'reschedule' && (
              <label>
                新的预约时段
                <select
                  required
                  value={option}
                  disabled={optionsLoading}
                  onChange={(event) => setOption(event.target.value)}
                >
                  <option value="">
                    {optionsLoading ? '正在查询开放时段…' : '请选择日期与时段'}
                  </option>
                  {options.map((value) => (
                    <option
                      key={`${value.date}|${value.timeSlot}`}
                      value={`${value.date}|${value.timeSlot}`}
                    >
                      {formatDate(value.date)} · {value.timeSlot}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {resolution === 'reschedule' && !optionsLoading && !options.length && (
              <Notice>暂无可改约时段</Notice>
            )}
            <label>
              联系结果与处理原因
              <textarea
                required
                minLength={2}
                maxLength={300}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
            <button
              disabled={
                busy ||
                saving ||
                !resolution ||
                reason.trim().length < 2 ||
                (resolution === 'reschedule' && (!option || optionsLoading))
              }
            >
              {saving
                ? '正在处理…'
                : resolution === 'leave'
                  ? '确认离队，保留预约'
                  : resolution === 'cancel'
                    ? '确认取消预约'
                    : '确认改约'}
            </button>
          </form>
        </details>
      )}
    </section>
  );
}
