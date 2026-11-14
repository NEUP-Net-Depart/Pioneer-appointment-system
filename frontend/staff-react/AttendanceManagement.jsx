import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext, Modal, CredentialCard, time } from './field/ui';
import { request } from './request.js';
import { dateKey } from '../../shared/time.js';
import { dutyTypeLabels, dutyCampusNames } from '../../shared/duty.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { DataValue } from './DataValue';
import { Select, DatePicker } from './SelectionControls.jsx';
import { TimePicker } from './TimePicker.jsx';
import { RefreshButton } from './WorkspaceToolbar.jsx';

const labels = {
  upcoming: '未签到',
  pending: '未签到',
  arrived: '已签到',
  absent: '未签到',
  leave: '已请假',
  idle: '空闲',
  repairing: '维修中'
};
const order = {
  pending: 0,
  upcoming: 0,
  absent: 0,
  idle: 1,
  repairing: 2,
  arrived: 3,
  leave: 4
};
const personState = (person) =>
  person.workStatus ||
  (person.status === 'paused' ? (person.record ? 'arrived' : 'pending') : person.status);
const localTime = (value) => new Date(Date.parse(value) + 8 * 3600000).toISOString().slice(11, 16);
export function AttendanceManagement({ campusId, onDirtyChange, campusControl = null, focus }) {
  const client = useQueryClient();
  const active = useContext(ActivityContext),
    lock = useRef(false);
  const [day, setDay] = useState(dateKey),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [form, setForm] = useState(null),
    [token, setToken] = useState(null);
  const result = useQuery({
    queryKey: ['/api/attendance/day', { campusId, businessDate: day }],
    enabled: active,
    refetchInterval: form || busy ? false : 30000
  });
  const data = result.data;
  const listRef = useRef(null);
  const focused = useRef(null);
  const people = [...(data?.items || []), ...(data?.temporary || [])].sort(
    (first, second) =>
      order[personState(first)] - order[personState(second)] ||
      first.name.localeCompare(second.name, 'zh-CN')
  );
  useEffect(() => {
    if (!active || !focus || focus.campusId !== campusId || focused.current === focus.id) return;
    if (day !== dateKey()) {
      setDay(dateKey());
      return;
    }
    if (!data || data.campusId !== campusId || data.businessDate !== day) return;
    const target =
      listRef.current?.querySelector(`[data-staffing="${focus.kind}"]`) || listRef.current;
    target?.scrollIntoView({
      block: 'center',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    });
    target?.focus({ preventScroll: true });
    focused.current = focus.id;
  }, [active, focus, campusId, day, data]);
  const failure = error || result.error?.message;
  useEffect(() => {
    onDirtyChange(!!form || busy);
    return () => onDirtyChange(false);
  }, [form, busy, onDirtyChange]);
  useEffect(() => {
    if (!active) setToken(null);
  }, [active]);
  const refresh = () =>
    Promise.all(
      [
        '/api/attendance/day',
        '/api/me/attendance',
        '/api/me/volunteer-summary',
        '/api/attendance/volunteer-report',
        '/api/attendance/matrix',
        '/api/attendance/weekly-summary',
        '/api/field/home',
        '/api/field/board',
        '/api/attendance/staffing'
      ].map((path) => client.invalidateQueries({ queryKey: [path] }))
    );
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
      refresh();
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
      businessDate: record?.businessDate || day,
      recordId: record?.id,
      eventId: record?.eventId,
      revision: record?.revision,
      ...(record ? { occurredAt: localTime(record.occurredAt) } : { timeMode: 'duty_start' }),
      reason: '',
      requestId: crypto.randomUUID()
    });
  }
  async function save(event) {
    event.preventDefault();
    return execute(async () => {
      await request('/api/attendance/corrections', {
        method: 'POST',
        body: {
          ...form,
          ...(form.recordId
            ? {
                occurredAt: new Date(
                  `${form.businessDate}T${form.occurredAt}:00+08:00`
                ).toISOString()
              }
            : {})
        }
      });
      setForm(null);
      setNotice('考勤已保存');
      refresh();
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
      <article
        data-motion-item={person.memberId}
        className={`duty-person duty-${person.status}`}
        data-staffing={
          person.workStatus === 'idle' && person.repairEligible
            ? 'idle'
            : ['pending', 'upcoming', 'absent'].includes(person.status)
              ? 'missing'
              : undefined
        }
        tabIndex={-1}
        key={person.memberId}
      >
        <div>
          <strong>{person.name}</strong>
          <p className="field-muted">
            {person.assignments
              ?.map((item) => `${dutyTypeLabels[item.dutyType]} ${item.startAt}–${item.endAt}`)
              .join('、') || '临时到场'}
            {person.record ? ` · ${time(person.record.occurredAt)}` : ''}
            {person.record && data.canManage && (
              <span className="attendance-source">
                {' '}
                ·{' '}
                {person.record.checkinSource?.kind === 'qr'
                  ? `签到码：${person.record.checkinSource.issuerName || '历史记录未保存出码人'}`
                  : person.record.checkinSource?.kind === 'direct'
                    ? '本人直接签到'
                    : person.record.checkinSource?.kind === 'correction'
                      ? `补记：${person.record.checkinSource.operatorName || person.record.checkinSource.operatorAccount}${person.record.checkinSource.timeBasis === 'duty_start' ? ' · 按班次开始时间' : ''}`
                      : '历史记录未保存来源'}
              </span>
            )}
            {person.unavailable ? ' · 账号或校区授权已失效，请调整班表' : ''}
          </p>
        </div>
        <span className="duty-status">{labels[personState(person)]}</span>
        <div className="schedule-actions">
          {person.canConfirm && (
            <button
              data-track="staff.attendancemanagement.button.1"
              className="field-primary"
              disabled={busy}
              onClick={() => run(() => update(person, 'arrival'))}
            >
              确认到场
            </button>
          )}
          {person.canReview && (
            <button
              data-track="staff.attendancemanagement.button.2"
              disabled={busy}
              onClick={() => run(() => update(person, 'review'))}
            >
              {person.status === 'absent' ? '撤销未到' : '确认未到'}
            </button>
          )}
          {person.canCorrect && person.status !== 'leave' && (
            <button
              data-track="staff.attendancemanagement.button.3"
              disabled={busy}
              onClick={() => edit(person)}
            >
              {person.record ? '修正时间' : '补记漏签'}
            </button>
          )}
        </div>
      </article>
    ));
  }
  return (
    <div className="duty-day">
      <div className="duty-toolbar attendance-toolbar">
        {campusControl}
        <div className="duty-date-controls">
          <label>
            值班日期
            <DatePicker
              data-track="staff.attendancemanagement.input.4"
              value={day}
              disabled={busy || !!form}
              onChange={(event) => event.target.value && setDay(event.target.value)}
            />
          </label>
          <button
            data-track="staff.attendancemanagement.button.5"
            disabled={busy || !!form}
            onClick={() => setDay(dateKey())}
          >
            今天
          </button>
        </div>
        <div className="duty-attendance-actions">
          <RefreshButton
            data-track="staff.attendancemanagement.button.6"
            key={`${campusId}:${day}`}
            disabled={busy || !!form}
            onRefresh={() => result.refetch({ throwOnError: true })}
            label="刷新值班"
            compactOnMobile
          />
          {day === dateKey() && (
            <button
              data-track="staff.attendancemanagement.button.7"
              className="attendance-code-action"
              disabled={busy || data?.paused}
              onClick={() => run(showCode)}
            >
              展示签到码
            </button>
          )}
          {data?.canManage && (
            <button
              data-track="staff.attendancemanagement.button.8"
              disabled={busy || !data || data.paused || day > dateKey()}
              onClick={() => edit(null)}
            >
              补录其他人员
            </button>
          )}
        </div>
      </div>
      {failure && !form && !token && (
        <p role="alert" className="react-error">
          {failure}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <>
        {data?.paused && <p role="status">当天暂停服务，保留原班表和考勤。</p>}
        <div className="duty-metrics">
          {[
            ['应到', data?.summary.expected],
            ['已签到', data?.summary.arrived],
            ['待核查', data?.summary.pending]
          ].map(([label, value]) => (
            <div key={label}>
              <strong>
                <DataValue label={label} preset="metric" digits={3}>
                  {value}
                </DataValue>
              </strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <section
          className="schedule-card"
          aria-label="值班人员"
          aria-busy={!data}
          ref={listRef}
          tabIndex={-1}
        >
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
          {rows(people)}
          {!people.length && (
            <p className={!data ? 'data-pending-copy' : undefined} aria-hidden={!data || undefined}>
              当天暂无值班或签到人员。
            </p>
          )}
        </section>
      </>
      {form && (
        <Modal
          title={form.recordId ? '修正签到时间' : '补记漏签'}
          onClose={() => {
            if (!busy) setForm(null);
          }}
        >
          <form
            data-track="staff.attendancemanagement.form.9"
            ref={formRef}
            onSubmit={(event) => void save(event).catch(() => {})}
          >
            <fieldset className="attendance-edit-fields" disabled={busy}>
              <p>
                {form.businessDate} · {dutyCampusNames[form.campusId]}
              </p>
              {form.memberName ? (
                <strong>{form.memberName}</strong>
              ) : (
                <label>
                  工作人员
                  <Select
                    data-track="staff.attendancemanagement.select.10"
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
                  </Select>
                </label>
              )}
              {form.recordId && (
                <label>
                  实际到场时间
                  <TimePicker
                    data-track="staff.attendancemanagement.input.11"
                    label="选择实际到场时间"
                    required
                    value={form.occurredAt}
                    onChange={(value) =>
                      setForm((current) => ({
                        ...current,
                        occurredAt: value,
                        requestId: crypto.randomUUID()
                      }))
                    }
                  />
                </label>
              )}
              <label>
                补录或修正原因
                <input
                  data-track="staff.attendancemanagement.input.12"
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
              {error && <p role="alert">{error}</p>}
              <div className="schedule-actions">
                <button
                  data-track="staff.attendancemanagement.button.13"
                  type="submit"
                  className="field-primary"
                >
                  保存考勤
                </button>
                <button
                  data-track="staff.attendancemanagement.button.14"
                  type="button"
                  onClick={() => setForm(null)}
                >
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
          <button
            data-track="staff.attendancemanagement.button.15"
            disabled={busy}
            onClick={() => run(showCode)}
          >
            更新签到码
          </button>
        </Modal>
      )}
    </div>
  );
}
