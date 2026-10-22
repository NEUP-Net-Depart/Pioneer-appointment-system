import React, { useContext, useEffect, useRef, useState } from 'react';
import { addDays, dateKey, serviceDay } from '../../shared/time.js';
import { request } from './request.js';
import { ActivityContext, Notice } from './field/ui';
import { useWorkspaceQuery } from './useWorkspaceQuery.js';

function nextServiceDate() {
  let day = dateKey();
  for (let offset = 0; offset < 7 && !serviceDay(day); offset++) day = addDays(day, 1);
  return day;
}

export function RepairFollowups({ active, onChanged }) {
  const visible = useContext(ActivityContext) && active;
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState('');
  const [dates, setDates] = useState({});
  const [slots, setSlots] = useState({});
  const [reasons, setReasons] = useState({});
  const [modes, setModes] = useState({});
  const [busy, setBusy] = useState('');
  const [errors, setErrors] = useState({});
  const commands = useRef(new Map());
  const result = useWorkspaceQuery('/api/repair-followups?status=pending', visible, revision);
  const items = result.data?.items || [];

  function openDecision(id, mode = 'schedule') {
    setDates((current) => (current[id] ? current : { ...current, [id]: nextServiceDate() }));
    setModes((current) => ({ ...current, [id]: mode }));
    setErrors((current) => ({ ...current, [id]: '' }));
    setExpanded(id);
  }

  useEffect(() => {
    if (!expanded) return;
    const entry = items.find((item) => item.followup.id === expanded);
    if (!entry) return;
    const date = dates[expanded] || nextServiceDate();
    const query = new URLSearchParams({ date, campus: entry.appointment.campus });
    let stopped = false;
    request('/api/repair-followups/slots?' + query)
      .then((data) => {
        if (!stopped) setSlots((current) => ({ ...current, [expanded]: data.items || [] }));
      })
      .catch((failure) => {
        if (!stopped) setErrors((current) => ({ ...current, [expanded]: failure.message }));
      });
    return () => {
      stopped = true;
    };
  }, [expanded, dates[expanded], revision]);

  function commandId(id, payload) {
    const fingerprint = JSON.stringify(payload);
    const previous = commands.current.get(id);
    if (previous?.fingerprint === fingerprint) return previous.id;
    const current = { id: crypto.randomUUID(), fingerprint };
    commands.current.set(id, current);
    return current.id;
  }

  async function decide(entry, action, fields = {}) {
    const { followup, appointment } = entry;
    const payload = { action, revision: followup.revision, ...fields };
    const id = followup.id;
    setBusy(id);
    setErrors((current) => ({ ...current, [id]: '' }));
    try {
      await request('/api/repair-followups/' + encodeURIComponent(id) + '/decision', {
        method: 'POST',
        body: { ...payload, requestId: commandId(id, payload) }
      });
      commands.current.delete(id);
      setExpanded('');
      setRevision((value) => value + 1);
      onChanged();
    } catch (failure) {
      setErrors((current) => ({ ...current, [id]: failure.message }));
      if (failure.status === 409) setRevision((value) => value + 1);
    } finally {
      setBusy('');
    }
  }

  if (!active) return null;
  return (
    <section className="followup-queue" aria-labelledby="followup-queue-title">
      <div className="followup-queue-heading">
        <div>
          <p className="section-kicker">办公处理</p>
          <h2 id="followup-queue-title">待安排返修</h2>
          <p>确认返修情况后，安排至原校区的有效维修时段；返修不占普通预约容量。</p>
        </div>
        <span className="followup-count" aria-label={items.length + ' 条待处理'}>
          {items.length}
        </span>
      </div>
      {result.error && <Notice>{result.error}</Notice>}
      {result.loading && !result.data && <p className="field-muted">正在读取返修申请…</p>}
      {!items.length && !result.loading && !result.error && (
        <p className="followup-empty">目前没有待安排的返修申请。</p>
      )}
      <div className="followup-queue-list">
        {items.map(({ followup, appointment }) => {
          const date = dates[followup.id] || nextServiceDate();
          const available = slots[followup.id] || [];
          const isOpen = expanded === followup.id;
          return (
            <article className="followup-card" key={followup.id}>
              <div className="followup-card-main">
                <div className="followup-card-title">
                  <div>
                    <strong>
                      {(appointment.name || '客户信息待核验') + ' · ' + appointment.id}
                    </strong>
                    <span>
                      {appointment.campus}校区 · 原维修 {appointment.date} {appointment.timeSlot}
                    </span>
                  </div>
                  <span className="followup-state">待处理</span>
                </div>
                <p className="followup-reason">{followup.reason}</p>
                <div className="followup-card-actions">
                  <button
                    type="button"
                    className="followup-primary"
                    aria-expanded={isOpen}
                    onClick={() => {
                      if (isOpen) setExpanded('');
                      else openDecision(followup.id);
                    }}
                  >
                    {isOpen ? '关闭处理' : '安排返修'}
                  </button>
                  {!isOpen && (
                    <button
                      type="button"
                      className="followup-reject-link"
                      onClick={() => {
                        openDecision(followup.id, 'reject');
                      }}
                    >
                      退回申请
                    </button>
                  )}
                </div>
                {isOpen && (
                  <div className="followup-decision">
                    <div className="followup-choice-tabs" role="group" aria-label="返修处理方式">
                      <button
                        type="button"
                        aria-pressed={(modes[followup.id] || 'schedule') === 'schedule'}
                        onClick={() => {
                          setModes((current) => ({ ...current, [followup.id]: 'schedule' }));
                          setErrors((current) => ({ ...current, [followup.id]: '' }));
                        }}
                      >
                        安排维修
                      </button>
                      <button
                        type="button"
                        aria-pressed={modes[followup.id] === 'reject'}
                        onClick={() => {
                          setModes((current) => ({ ...current, [followup.id]: 'reject' }));
                          setErrors((current) => ({ ...current, [followup.id]: '' }));
                        }}
                      >
                        退回申请
                      </button>
                    </div>
                    {modes[followup.id] === 'reject' ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          const reason = (reasons[followup.id] || '').trim();
                          if (reason.length < 2) {
                            setErrors((current) => ({
                              ...current,
                              [followup.id]: '请填写至少 2 个字的退回原因'
                            }));
                            return;
                          }
                          void decide({ followup, appointment }, 'reject', { reason });
                        }}
                      >
                        <label className="followup-field">
                          退回原因
                          <textarea
                            value={reasons[followup.id] || ''}
                            maxLength={500}
                            rows={3}
                            onChange={(event) =>
                              setReasons((current) => ({
                                ...current,
                                [followup.id]: event.target.value
                              }))
                            }
                          />
                        </label>
                        <p className="followup-error" role="alert">
                          {errors[followup.id]}
                        </p>
                        <button
                          type="submit"
                          className="followup-danger"
                          disabled={busy === followup.id}
                        >
                          确认退回
                        </button>
                      </form>
                    ) : (
                      <div className="followup-schedule-form">
                        <label className="followup-field">
                          维修日期
                          <input
                            type="date"
                            value={date}
                            min={dateKey()}
                            onChange={(event) => {
                              const next = event.target.value;
                              setDates((current) => ({ ...current, [followup.id]: next }));
                              setSlots((current) => ({
                                ...current,
                                [followup.id]: [],
                                [followup.id + ':selected']: ''
                              }));
                            }}
                          />
                        </label>
                        <label className="followup-field">
                          时段
                          <select
                            value={slots[followup.id + ':selected'] || ''}
                            onChange={(event) =>
                              setSlots((current) => ({
                                ...current,
                                [followup.id + ':selected']: event.target.value
                              }))
                            }
                          >
                            <option value="">选择有效时段</option>
                            {available.map((slot) => (
                              <option key={slot} value={slot}>
                                {slot}
                              </option>
                            ))}
                          </select>
                        </label>
                        {!available.length && (
                          <p className="followup-hint">
                            该日没有可安排时段。请选择其他周一至周四；暂停日期和已结束时段不可安排。
                          </p>
                        )}
                        <p className="followup-error" role="alert">
                          {errors[followup.id]}
                        </p>
                        <div className="followup-submit-row">
                          <button
                            type="button"
                            className="followup-primary"
                            disabled={busy === followup.id || !slots[followup.id + ':selected']}
                            onClick={() =>
                              void decide({ followup, appointment }, 'schedule', {
                                date,
                                timeSlot: slots[followup.id + ':selected']
                              })
                            }
                          >
                            {busy === followup.id ? '正在安排…' : '确认安排返修'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
