import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext, Modal, CredentialCard, time } from './field/ui';
import { request } from './request.js';
import { dateKey } from '../../shared/time.js';
import { dutyCampusNames } from '../../shared/duty.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { DataValue } from './DataValue';
import { Select, DatePicker } from './SelectionControls.jsx';
import { TimePicker } from './TimePicker.jsx';
import { RefreshButton } from './WorkspaceToolbar.jsx';
import { compareAttendanceDepartments } from '../../shared/attendance-status.js';

const labels = {
  upcoming: '未签到',
  arrived: '已签到',
  absent: '缺勤',
  leave: '已请假',
  idle: '空闲',
  repairing: '维修中'
};
const order = {
  upcoming: 0,
  absent: 0,
  idle: 1,
  repairing: 2,
  arrived: 3,
  leave: 4
};
const personState = (person) =>
  person.workStatus ||
  (person.status === 'paused' ? (person.record ? 'arrived' : 'upcoming') : person.status);
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
  const [sourcePerson, setSourcePerson] = useState(null);
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
      compareAttendanceDepartments(first, second) ||
      order[personState(first)] - order[personState(second)] ||
      first.name.localeCompare(second.name, 'zh-CN')
  );
  const memberIds = people.map((person) => person.memberId).sort();
  const dutyPeople = (type) =>
    people
      .filter((person) => person.assignments?.some((item) => item.dutyType === type))
      .map((person) => ({
        ...person,
        assignments: person.assignments.filter((item) => item.dutyType === type),
        status: person.dutyStatuses?.[type] || person.status,
        workStatus: type === 'office' ? null : person.workStatus
      }));
  const officePeople = dutyPeople('office');
  const repairPeople = dutyPeople('repair');
  const supportPeople = people.filter((person) => !person.assignments?.length);
  const month = dateKey().slice(0, 7);
  const workload = useQuery({
    queryKey: ['/api/attendance/workload', { campusId, businessDate: day }, memberIds, month],
    enabled: active && !!data && memberIds.length > 0,
    staleTime: 60000,
    refetchInterval: form || busy ? false : 60000
  });
  const workloadByMember = new Map(
    (workload.data?.items || []).map((item) => [item.memberId, item])
  );
  useEffect(() => {
    if (!active || !focus || focus.campusId !== campusId || focused.current === focus.id) return;
    const targetDay = focus.businessDate || dateKey();
    if (day !== targetDay) {
      setDay(targetDay);
      return;
    }
    if (!data || data.campusId !== campusId || data.businessDate !== day) return;
    const target =
      (focus.memberId
        ? [...(listRef.current?.querySelectorAll('[data-member-id]') || [])].find(
            (element) => element.dataset.memberId === focus.memberId
          )
        : listRef.current?.querySelector(`[data-staffing="${focus.kind}"]`)) || listRef.current;
    target?.scrollIntoView({
      block: 'center',
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
    });
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
        '/api/attendance/workload',
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
  function rows(items, office = false) {
    return items.map((person) => (
      <article
        data-motion-item={person.memberId}
        data-member-id={person.memberId}
        className={`duty-person duty-${person.status}${office ? ' duty-office-person' : ''}`}
        data-staffing={
          person.workStatus === 'idle' && person.repairEligible
            ? 'idle'
            : ['upcoming', 'absent'].includes(person.status)
              ? 'missing'
              : undefined
        }
        key={person.memberId}
      >
        <div className="duty-person-identity">
          <div className="duty-person-name">
            <strong>{person.name}</strong>
            <span>{person.department}</span>
          </div>
          <div className="duty-person-meta">
            <span>
              {person.assignments?.map((item) => `${item.startAt}–${item.endAt}`).join('、') ||
                (person.maintenanceAffairs ? '维修事务 · 临时支援' : '临时支援')}
            </span>
            {person.record && data.canManage && (
              <button
                type="button"
                className="duty-checkin-detail"
                data-track="staff.attendancemanagement.checkin-detail"
                aria-label={`查看${person.name}的签到详情`}
                onClick={() => setSourcePerson(person)}
              >
                {time(person.record.occurredAt)} 签到 <span aria-hidden="true">›</span>
              </button>
            )}
            {person.record && !data.canManage && <span>{time(person.record.occurredAt)} 签到</span>}
          </div>
          {person.unavailable && <p className="react-error">账号或校区授权已失效，请调整班表</p>}
        </div>
        {!office && (
          <dl
            className="duty-workload"
            aria-label={`${person.name}接单量`}
            title={
              workload.error
                ? '接单量更新失败，可刷新值班重试'
                : '跨校区统计；同一人接手同一工单仅计一次'
            }
          >
            {[
              ['monthly', '本月接单'],
              ['total', '累计接单']
            ].map(([key, label]) => (
              <div key={key}>
                <dt
                  title={
                    key === 'monthly' ? `${workload.data?.month || month}首次接手的工单` : undefined
                  }
                >
                  {label}
                </dt>
                <dd>
                  <DataValue
                    label={`${person.name}${label}`}
                    digits={key === 'monthly' ? 2 : 3}
                    pending={!workload.error}
                  >
                    {workloadByMember.get(person.memberId)?.[key] ??
                      (workload.error ? '—' : undefined)}
                  </DataValue>
                </dd>
              </div>
            ))}
          </dl>
        )}
        <span
          className="duty-status"
          data-highlighted={
            focus?.kind === 'idle' &&
            focus.campusId === campusId &&
            day === dateKey() &&
            person.workStatus === 'idle' &&
            person.repairEligible
              ? 'true'
              : undefined
          }
        >
          {labels[personState(person)]}
        </span>
        <div className="schedule-actions">
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
    <div className="duty-day" data-can-manage={data?.canManage || undefined}>
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
            onRefresh={() =>
              Promise.all([
                result.refetch({ throwOnError: true }),
                ...(memberIds.length ? [workload.refetch({ throwOnError: true })] : [])
              ])
            }
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
            ['缺勤', data?.summary.absent]
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
          className="duty-roster-sections"
          aria-label="值班人员"
          aria-busy={!data}
          ref={listRef}
          tabIndex={-1}
        >
          {officePeople.length > 0 && (
            <section className="duty-group duty-office-group" aria-label="办公值班">
              <h3>
                办公值班 <span>{officePeople.length} 人</span>
              </h3>
              {rows(officePeople, true)}
            </section>
          )}
          {repairPeople.length > 0 && (
            <section className="duty-group" aria-label="维修值班">
              <h3>
                维修值班 <span>{repairPeople.length} 人</span>
              </h3>
              {rows(repairPeople)}
            </section>
          )}
          {supportPeople.length > 0 && (
            <section className="duty-group" aria-label="临时支援">
              <h3>
                临时支援 <span>{supportPeople.length} 人</span>
              </h3>
              {rows(supportPeople)}
            </section>
          )}
          {!people.length && (
            <p className={!data ? 'data-pending-copy' : undefined} aria-hidden={!data || undefined}>
              当天暂无值班或签到人员。
            </p>
          )}
        </section>
      </>
      {sourcePerson && active && data?.canManage && (
        <Modal title={`${sourcePerson.name} · 签到详情`} onClose={() => setSourcePerson(null)}>
          <dl className="duty-checkin-facts">
            <div>
              <dt>签到时间</dt>
              <dd>
                {day} {time(sourcePerson.record.occurredAt)}
              </dd>
            </div>
            <div>
              <dt>签到方式</dt>
              <dd>
                {{ qr: '扫码签到', direct: '本人直接签到', correction: '补记漏签' }[
                  sourcePerson.record.checkinSource?.kind
                ] || '历史记录未保存来源'}
              </dd>
            </div>
            {sourcePerson.record.checkinSource?.kind === 'qr' && (
              <div>
                <dt>签到码提供人</dt>
                <dd>{sourcePerson.record.checkinSource.issuerName || '历史记录未保存出码人'}</dd>
              </div>
            )}
            {sourcePerson.record.checkinSource?.kind === 'correction' && (
              <>
                <div>
                  <dt>补记操作人</dt>
                  <dd>
                    {sourcePerson.record.checkinSource.operatorName ||
                      sourcePerson.record.checkinSource.operatorAccount ||
                      '历史记录未保存操作人'}
                  </dd>
                </div>
                {sourcePerson.record.checkinSource.timeBasis === 'duty_start' && (
                  <div>
                    <dt>时间依据</dt>
                    <dd>按班次开始时间</dd>
                  </div>
                )}
              </>
            )}
          </dl>
        </Modal>
      )}
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
