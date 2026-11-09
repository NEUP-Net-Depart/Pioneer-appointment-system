import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext, Modal, CredentialCard, time } from './field/ui';
import { request } from './request.js';
import { dateKey } from '../../shared/time.js';
import { dutyTypeLabels, dutyCampusNames } from '../../shared/duty.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';

const labels = {
  upcoming: '待签到',
  pending: '未签到',
  arrived: '已签到',
  absent: '已确认未到',
  leave: '已请假',
  paused: '暂停服务'
};
const order = { pending: 0, upcoming: 1, absent: 2, arrived: 3, leave: 4, paused: 5 };
const localTime = (value) => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(0, 16);
export function AttendanceManagement({ campusId, onDirtyChange }) {
  const active = useContext(ActivityContext),
    lock = useRef(false);
  const [day, setDay] = useState(dateKey),
    [data, setData] = useState(null),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [form, setForm] = useState(null),
    [token, setToken] = useState(null);
  useEffect(() => {
    onDirtyChange(!!form || busy);
    return () => onDirtyChange(false);
  }, [form, busy, onDirtyChange]);
  useEffect(() => {
    if (!active) {
      setToken(null);
      return;
    }
    const controller = new AbortController();
    setError('');
    setData(null);
    request(`/api/attendance/day?${new URLSearchParams({ campusId, businessDate: day })}`, {
      signal: controller.signal
    })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [active, campusId, day, refresh]);
  useEffect(() => {
    if (!active) return;
    const update = () => {
      if (!document.hidden && !lock.current && !form) setRefresh((value) => value + 1);
    };
    const timer = setInterval(update, 30000);
    window.addEventListener('focus', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, [active, form]);
  async function execute(operation) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      return await operation();
    } catch (failure) {
      setError(failure.message);
      throw failure;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const run = (operation) => void execute(operation).catch(() => {});
  async function update(person, kind) {
    const decision = person.status === 'absent' ? 'cleared' : 'absent';
    const assignments =
      kind === 'arrival'
        ? [person.assignment]
        : person.assignments.filter(
            (item) => item.leaveStatus !== 'recorded' && item.review?.decision !== decision
          );
    try {
      for (const item of assignments) {
        await request(kind === 'arrival' ? '/api/attendance/arrivals' : '/api/attendance/reviews', {
          method: kind === 'arrival' ? 'POST' : 'PUT',
          body: {
            assignmentId: item.id,
            assignmentRevision: item.revision,
            requestId: crypto.randomUUID(),
            ...(kind === 'review' ? { decision, revision: item.review?.revision ?? -1 } : {})
          }
        });
      }
    } finally {
      setRefresh((value) => value + 1);
    }
    setNotice(kind === 'arrival' ? `${person.name}已确认到场，签到记录已保存` : '核查结论已保存');
  }
  function edit(person) {
    const record = person?.record;
    setError('');
    setForm({
      memberId: person?.memberId || '',
      memberName: person?.name || '',
      campusId,
      businessDate: day,
      recordId: record?.id,
      eventId: record?.eventId,
      revision: record?.revision,
      occurredAt: record ? localTime(record.occurredAt) : `${day}T19:00`,
      reason: '',
      requestId: crypto.randomUUID()
    });
  }
  async function save(event) {
    event.preventDefault();
    return execute(async () => {
      await request('/api/attendance/corrections', {
        method: 'POST',
        body: { ...form, occurredAt: new Date(`${form.occurredAt}:00+08:00`).toISOString() }
      });
      setForm(null);
      setNotice('考勤已保存');
      setRefresh((value) => value + 1);
      return true;
    });
  }
  const formRef = useUnsavedChanges({
    dirty: !!form,
    active,
    busy,
    save,
    discard: () => setForm(null)
  });
  async function showCode() {
    const event = await request('/api/attendance/events', {
      method: 'POST',
      body: { campusId, businessDate: dateKey(), type: 'duty', requestId: crypto.randomUUID() }
    });
    setToken(
      await request(`/api/attendance/events/${event.id}/token`, {
        method: 'POST',
        body: { revision: event.revision }
      })
    );
  }
  function rows(items) {
    return items.map((person) => (
      <article className={`duty-person duty-${person.status}`} key={person.memberId}>
        <div>
          <strong>{person.name}</strong>
          <p className="field-muted">
            {person.assignments
              ?.map((item) => `${dutyTypeLabels[item.dutyType]} ${item.startAt}–${item.endAt}`)
              .join('、') || '临时到场'}
            {person.record ? ` · ${time(person.record.occurredAt)}` : ''}
            {person.unavailable ? ' · 账号或校区授权已失效，请调整班表' : ''}
          </p>
        </div>
        <span className="duty-status">{labels[person.status]}</span>
        <div className="schedule-actions">
          {person.canConfirm && (
            <button
              className="field-primary"
              disabled={busy}
              onClick={() => run(() => update(person, 'arrival'))}
            >
              确认到场
            </button>
          )}
          {person.canReview && (
            <button disabled={busy} onClick={() => run(() => update(person, 'review'))}>
              {person.status === 'absent' ? '撤销未到' : '确认未到'}
            </button>
          )}
          {person.canCorrect && person.status !== 'leave' && (
            <button disabled={busy} onClick={() => edit(person)}>
              {person.record ? '修正时间' : '补记漏签'}
            </button>
          )}
        </div>
      </article>
    ));
  }
  return (
    <div className="duty-day">
      <div className="duty-toolbar">
        <label>
          值班日期
          <input
            type="date"
            value={day}
            disabled={busy || !!form}
            onChange={(event) => event.target.value && setDay(event.target.value)}
          />
        </label>
        <button disabled={busy || !!form} onClick={() => setDay(dateKey())}>
          今天
        </button>
        <button disabled={busy || !!form} onClick={() => setRefresh((value) => value + 1)}>
          刷新
        </button>
        {day === dateKey() && (
          <button disabled={busy || data?.paused} onClick={() => run(showCode)}>
            展示签到码
          </button>
        )}
        <button
          disabled={busy || !data || data.paused || day > dateKey()}
          onClick={() => edit(null)}
        >
          补录其他人员
        </button>
      </div>
      {error && !form && !token && (
        <p role="alert" className="react-error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!data ? (
        <p>{error ? '读取失败，请刷新重试。' : '正在读取值班名单…'}</p>
      ) : (
        <>
          {data.paused && <p role="status">当天暂停服务，保留原班表和考勤。</p>}
          <div className="duty-metrics">
            {[
              ['应到', data.summary.expected],
              ['已签到', data.summary.arrived],
              ['待核查', data.summary.pending]
            ].map(([label, value]) => (
              <div key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <section className="schedule-card">
            <div className="duty-section-heading">
              <h2>{day === dateKey() ? '今日值班' : '值班人员'}</h2>
              <span>
                {new Intl.DateTimeFormat('zh-CN', {
                  weekday: 'long',
                  timeZone: 'Asia/Shanghai'
                }).format(new Date(`${day}T12:00:00Z`))}{' '}
                · {dutyCampusNames[campusId]}
              </span>
            </div>
            {rows(
              data.items
                .filter((person) => person.status !== 'leave')
                .sort(
                  (a, b) =>
                    order[a.status] - order[b.status] || a.name.localeCompare(b.name, 'zh-CN')
                )
            )}
            {!data.items.filter((person) => person.status !== 'leave').length && (
              <p>当天没有应到人员。</p>
            )}
          </section>
          {!!data.items.filter((person) => person.status === 'leave').length && (
            <section className="schedule-card">
              <h2>已请假</h2>
              {rows(data.items.filter((person) => person.status === 'leave'))}
            </section>
          )}
          {!!data.temporary.length && (
            <section className="schedule-card">
              <h2>临时到场 · {data.temporary.length}</h2>
              {rows(data.temporary)}
            </section>
          )}
        </>
      )}
      {form && (
        <Modal
          title={form.recordId ? '修正签到时间' : '补记漏签'}
          onClose={() => {
            if (!busy) setForm(null);
          }}
        >
          <form ref={formRef} onSubmit={(event) => void save(event).catch(() => {})}>
            <fieldset disabled={busy}>
              <p>
                {day} · {dutyCampusNames[campusId]}
              </p>
              {form.memberName ? (
                <strong>{form.memberName}</strong>
              ) : (
                <label>
                  工作人员
                  <select
                    required
                    value={form.memberId}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        memberId: event.target.value,
                        requestId: crypto.randomUUID()
                      }))
                    }
                  >
                    <option value="">请选择人员</option>
                    {data.people.map((person) => (
                      <option key={person.memberId} value={person.memberId}>
                        {person.name} · {person.studentId}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                实际到场时间
                <input
                  type="datetime-local"
                  required
                  value={form.occurredAt}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      occurredAt: event.target.value,
                      requestId: crypto.randomUUID()
                    }))
                  }
                />
              </label>
              <label>
                补录或修正原因
                <input
                  required
                  maxLength={500}
                  value={form.reason}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      reason: event.target.value,
                      requestId: crypto.randomUUID()
                    }))
                  }
                />
              </label>
              <p className="field-muted">补录保存实际发生时间，不改变今日实时在岗。</p>
              {error && <p role="alert">{error}</p>}
              <div className="schedule-actions">
                <button type="submit" className="field-primary">
                  保存考勤
                </button>
                <button type="button" onClick={() => setForm(null)}>
                  取消
                </button>
              </div>
            </fieldset>
          </form>
        </Modal>
      )}
      {token && active && (
        <Modal title="工作人员签到码" onClose={() => setToken(null)}>
          <CredentialCard
            kind="attendance"
            code={token.token}
            context={`${dutyCampusNames[campusId]} · ${dateKey()}`}
          />
          <p>有效至 {time(token.expiresAt)}</p>
          {error && <p role="alert">{error}</p>}
          <button disabled={busy} onClick={() => run(showCode)}>
            更新签到码
          </button>
        </Modal>
      )}
    </div>
  );
}
