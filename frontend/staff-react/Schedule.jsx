import { Select } from './SelectionControls.jsx';
import { WeekPicker } from './WeekPicker.jsx';
import { HelpHint } from './HelpHint';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { request } from './request.js';
import { DataValue } from './DataValue';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AttendanceCheckInButton } from './field/AttendanceActions';
import { campusAttendance, applyAttendance } from './field/attendance-state';
import { ActivityContext, Modal, Scanner, time } from './field/ui';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { CampusScope } from './CampusScope.jsx';
import { RefreshButton } from './WorkspaceToolbar.jsx';
import { Attendance } from './Attendance';
import { addDays, dateKey, rosterWeekKey } from '../../shared/time.js';
import {
  DUTY_START,
  DUTY_END,
  dutyTypeLabels,
  dutyCampusNames,
  availableForDuty,
  dutyCandidateTypes
} from '../../shared/duty.js';

const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
export function Schedule({ user, campusId: initialCampus, onDirtyChange }) {
  const [selectedCampus, setSelectedCampus] = useState(initialCampus);
  const campusId = (user.authorizedCampuses || [])
    .map((name) => ({ 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' })[name] || name)
    .includes(selectedCampus)
    ? selectedCampus
    : initialCampus;
  const client = useQueryClient();
  const active = useContext(ActivityContext),
    lock = useRef(false);
  const [week, setWeek] = useState(() => rosterWeekKey()),
    [selectedType, setType] = useState('');
  const types = dutyCandidateTypes(user.memberships || [], dateKey());
  const type = types.includes(selectedType) ? selectedType : types[0];
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const availability = useQuery({
    queryKey: ['/api/me/availability', { weekStart: week, dutyType: type }],
    enabled: active && !!type
  });
  const mine = useQuery({ queryKey: ['/api/me/roster', { weekStart: week }], enabled: active });
  const upcoming = useQuery({ queryKey: ['/api/me/roster', { upcoming: '1' }], enabled: active });
  const covers = useQuery({ queryKey: ['/api/rosters/covers'], enabled: active });
  const home = useQuery({ queryKey: ['/api/field/home', { campusId }], enabled: active });
  const hours = useQuery({ queryKey: ['/api/me/volunteer-summary'], enabled: active });
  const data = {
    availability: availability.data,
    mine: mine.data?.items,
    upcoming: upcoming.data?.items,
    covers: covers.data?.items
  };
  const live = home.data;
  const summary = hours.data;
  const failure =
    error ||
    [availability, mine, upcoming, covers, home, hours].find((result) => result.error)?.error
      ?.message;
  const [editor, setEditor] = useState(null),
    [editorRevision, setEditorRevision] = useState(null),
    [windows, setWindows] = useState([]),
    [scan, setScan] = useState(false),
    [action, setAction] = useState(null),
    [reason, setReason] = useState(''),
    [recipient, setRecipient] = useState('');
  const peopleQuery = useQuery({
    queryKey: [`/api/rosters/assignments/${action?.item.id}/cover-candidates`],
    enabled: active && action?.kind === 'cover'
  });
  const people = peopleQuery.data?.items || [];
  const campuses = (user.authorizedCampuses || []).map(
    (value) => ({ 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' })[value] || value
  );
  useEffect(() => {
    onDirtyChange(!!editor || !!action || busy);
    return () => onDirtyChange(false);
  }, [editor, action, busy, onDirtyChange]);
  useEffect(() => {
    if (!active) setScan(false);
    setError('');
  }, [active, week, type, campusId]);
  async function mutate(path, body, method = 'POST') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await request(path, { method, body: { ...body, requestId: crypto.randomUUID() } });
      setEditor(null);
      setAction(null);
      setNotice('已保存');
      const affectedQueries = {
        predicate: (query) =>
          (path === '/api/me/availability'
            ? ['/api/me/availability', '/api/rosters/campus-week']
            : [
                '/api/me/roster',
                '/api/rosters/covers',
                '/api/rosters/campus-week',
                '/api/attendance/day',
                '/api/slot-capacities/actual',
                '/api/field/home',
                '/api/field/board',
                '/api/me/volunteer-summary',
                '/api/attendance/volunteer-report',
                '/api/attendance/matrix',
                '/api/attendance/weekly-summary'
              ]
          ).includes(query.queryKey[0])
      };
      await client.cancelQueries(affectedQueries);
      await client.invalidateQueries(affectedQueries);
      return true;
    } catch (failure) {
      setError(failure.message);
      throw failure;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function saveAvailability(event) {
    event.preventDefault();
    return mutate(
      '/api/me/availability',
      {
        dutyType: type,
        weekStart: editor === 'usual' ? '' : week,
        revision: editorRevision,
        windows
      },
      'PUT'
    );
  }
  async function saveAction(event) {
    event.preventDefault();
    return mutate(`/api/rosters/assignments/${action.item.id}/${action.kind}`, {
      revision: action.item.revision,
      reason,
      note: reason,
      toMemberId: recipient
    });
  }
  const formRef = useUnsavedChanges({
    dirty: !!editor || !!action,
    active,
    busy,
    save: editor ? saveAvailability : saveAction,
    discard: () => {
      setEditor(null);
      setAction(null);
    }
  });
  function editAvailability(kind) {
    setEditorRevision(
      kind === 'usual'
        ? data.availability.usual.revision
        : (data.availability.exception?.revision ?? -1)
    );
    setWindows(
      kind === 'usual' ? data.availability.usual.windows : data.availability.effectiveWindows
    );
    setEditor(kind);
    setError('');
  }
  function toggle(weekday, campus) {
    const selected = availableForDuty(windows, weekday, campus);
    setWindows((current) => [
      ...current.filter((row) => !(row.weekday === weekday && row.campusId === campus)),
      ...(!selected ? [{ weekday, campusId: campus, startAt: DUTY_START, endAt: DUTY_END }] : [])
    ]);
  }
  async function checkIn(token = '') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (token && !token.startsWith('pioneer:attendance:v1:'))
        throw new Error('请扫描现场工作人员签到码');
      const result = await request(
        token ? '/api/attendance/check-ins' : '/api/attendance/self-check-in',
        {
          method: 'POST',
          body: token
            ? { token, method: 'qr', requestId: crypto.randomUUID() }
            : { campusId, requestId: crypto.randomUUID() }
        }
      );
      await applyAttendance(client, result);
      setScan(false);
      setNotice(
        `${dutyCampusNames[result.campusId] || ''}签到成功 · ${time(result.occurredAt)}${result.isExisting ? '（保留首次签到）' : ''}`
      );
    } catch (failure) {
      setError(failure.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function openAction(item, kind) {
    setReason('');
    setRecipient('');
    setError('');
    setAction({ item, kind });
  }
  const run = (...args) => void mutate(...args).catch(() => {});
  const today = dateKey(),
    todayRecord = live?.campusId === campusId ? campusAttendance(live) : null,
    todayDuties = data?.upcoming?.filter((row) => row.businessDate === today) || [];
  const next = data?.upcoming?.find(
    (row) => row.businessDate > today && row.leaveStatus !== 'recorded'
  );
  return (
    <div className="duty-personal">
      {(failure || peopleQuery.error) && !scan && (
        <p role="alert" className="react-error">
          {failure || peopleQuery.error?.message}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <>
        <section className="duty-today-card">
          <div>
            <span className="react-eyebrow">
              {today} · {dutyCampusNames[campusId]}
            </span>
            <h2>今日安排</h2>
            {todayDuties.map((row) => (
              <p key={row.id}>
                {dutyCampusNames[row.campusId]} · {dutyTypeLabels[row.dutyType]} {row.startAt}–
                {row.endAt}
                {row.leaveStatus === 'recorded' ? ' · 已请假' : ''}
              </p>
            ))}
            {!todayDuties.length && (
              <p
                className={!data?.upcoming ? 'data-pending-copy' : undefined}
                aria-hidden={!data?.upcoming || undefined}
              >
                今天没有安排值班
              </p>
            )}
            {next && (
              <p className="field-muted">
                下一次：{next.businessDate} · {dutyCampusNames[next.campusId]} {next.startAt}–
                {next.endAt}
              </p>
            )}
          </div>
          <div className="duty-checkin-actions">
            <CampusScope
              data-track="staff.schedule.campusscope.22"
              label="签到校区"
              campuses={campuses.map((id) => ({ id, name: dutyCampusNames[id] }))}
              value={campusId}
              disabled={busy || scan}
              onChange={setSelectedCampus}
            />
            {todayRecord ? (
              <strong>已签到 · {time(todayRecord.occurredAt)}</strong>
            ) : (
              live?.campusId === campusId && (
                <AttendanceCheckInButton
                  data={live}
                  busy={busy}
                  onCheckIn={() =>
                    live.directAttendance?.allowed ? void checkIn() : setScan(true)
                  }
                />
              )
            )}
          </div>
        </section>
        <section className="duty-hours" aria-label="我的志愿时长">
          <div>
            <span>本月志愿时长</span>
            <strong>
              <DataValue label="本月志愿时长" preset="metric" digits={4}>
                {summary?.monthHours}
              </DataValue>
              <small>小时</small>
            </strong>
          </div>
          <div>
            <span>累计志愿时长</span>
            <strong>
              <DataValue label="累计志愿时长" preset="metric" digits={4}>
                {summary?.totalHours}
              </DataValue>
              <small>小时</small>
            </strong>
          </div>
          <p>
            按现行志愿登记规则核算，每次{' '}
            <DataValue label="每次时长">{summary?.settings.hoursPerCount}</DataValue> 小时；
            {summary?.settings.countMode === 'weekly' ? '每周最多计一次' : '按实际有效签到计入'}
            {summary?.settings.mergeLeaders ? '，负责人每周自动计入一次' : ''}。
          </p>
        </section>
        <div className="duty-toolbar personal-duty-toolbar">
          <WeekPicker
            data-track="staff.schedule.input.1"
            label="所在周"
            value={week}
            disabled={!!editor || !!action || busy}
            onChange={setWeek}
          />
          <button
            data-track="staff.schedule.button.2"
            disabled={!!editor || !!action || busy}
            onClick={() => setWeek(rosterWeekKey())}
          >
            本周
          </button>
          <button
            data-track="staff.schedule.button.3"
            disabled={!!editor || !!action || busy}
            onClick={() => setWeek(addDays(rosterWeekKey(), 7))}
          >
            下周
          </button>
          <RefreshButton
            data-track="staff.schedule.refreshbutton.23"
            key={`${campusId}:${week}:${type}`}
            label="刷新我的值班"
            compactOnMobile
            disabled={busy}
            onRefresh={() =>
              Promise.all(
                [availability, mine, upcoming, covers, home, hours]
                  .filter((query) => query !== availability || !!type)
                  .map((query) => query.refetch({ throwOnError: true }))
                  .concat(
                    client.invalidateQueries(
                      { queryKey: ['/api/me/attendance'] },
                      { throwOnError: true }
                    )
                  )
              )
            }
          />
        </div>
        {types.length > 0 && (
          <section className="schedule-card">
            <div className="duty-section-heading">
              <h2 className="workspace-title-with-hint">
                填写空闲
                <HelpHint data-track="staff.schedule.helphint.24" label="空闲填报规则">
                  值班固定为19:00–21:00，通常安排持续沿用，临时变化只修改对应周。
                </HelpHint>
              </h2>
              {types.length === 1 ? (
                <span className="field-muted">{dutyTypeLabels[type]}值班</span>
              ) : (
                <div className="duty-tabs">
                  {types.map((value) => (
                    <button
                      data-track="staff.schedule.button.4"
                      key={value}
                      disabled={!!editor || busy}
                      aria-pressed={type === value}
                      onClick={() => setType(value)}
                    >
                      {dutyTypeLabels[value]}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {editor ? (
              <form
                data-track="staff.schedule.form.5"
                ref={formRef}
                onSubmit={(event) => void saveAvailability(event).catch(() => {})}
              >
                <fieldset disabled={busy}>
                  <legend>{editor === 'usual' ? '通常空闲' : '仅此周空闲'}</legend>
                  <div className="duty-availability">
                    {campuses.map((campus) => (
                      <div key={campus}>
                        <strong>{dutyCampusNames[campus]}</strong>
                        {[7, 1, 2, 3, 4, 5, 6].map((weekday) => (
                          <label key={weekday}>
                            <input
                              data-track="staff.schedule.input.6"
                              type="checkbox"
                              checked={availableForDuty(windows, weekday, campus)}
                              onChange={() => toggle(weekday, campus)}
                            />
                            {days[weekday - 1]}
                          </label>
                        ))}
                      </div>
                    ))}
                  </div>
                  {windows.some((row) => row.startAt > DUTY_START || row.endAt < DUTY_END) && (
                    <p className="field-muted">
                      部分旧时间未覆盖完整值班，需重新勾选整班；未调整的原填报会保留。
                    </p>
                  )}
                  <div className="schedule-actions">
                    <button
                      data-track="staff.schedule.button.7"
                      className="field-primary"
                      type="submit"
                    >
                      保存空闲
                    </button>
                    <button
                      data-track="staff.schedule.button.8"
                      type="button"
                      onClick={() => setEditor(null)}
                    >
                      取消
                    </button>
                  </div>
                </fieldset>
              </form>
            ) : (
              <>
                <p
                  className={!data?.availability ? 'data-pending-copy' : undefined}
                  aria-hidden={!data?.availability || undefined}
                >
                  {data?.availability?.source === 'exception' ? '本周单独安排' : '沿用通常安排'}：
                  {(data?.availability?.effectiveWindows || [])
                    .filter((row) => row.startAt <= DUTY_START && row.endAt >= DUTY_END)
                    .map((row) => `${days[row.weekday - 1]} ${dutyCampusNames[row.campusId]}`)
                    .join('、') || '暂无整班空闲'}
                </p>
                {data?.availability?.effectiveWindows.some(
                  (row) => row.startAt > DUTY_START || row.endAt < DUTY_END
                ) && (
                  <p className="field-muted">部分旧时间未覆盖19:00–21:00，请重新勾选整班空闲。</p>
                )}
                <div className="schedule-actions">
                  <button
                    data-track="staff.schedule.button.9"
                    disabled={busy || !data?.availability || !!action}
                    onClick={() => editAvailability('usual')}
                  >
                    修改通常时间
                  </button>
                  <button
                    data-track="staff.schedule.button.10"
                    disabled={busy || !data?.availability || !!action}
                    onClick={() => editAvailability('exception')}
                  >
                    只修改本周
                  </button>
                  {data?.availability?.source === 'exception' && (
                    <button
                      data-track="staff.schedule.button.11"
                      disabled={busy || !!action}
                      onClick={() =>
                        run(
                          '/api/me/availability',
                          {
                            dutyType: type,
                            weekStart: week,
                            revision: data.availability.exception.revision,
                            useUsual: true
                          },
                          'PUT'
                        )
                      }
                    >
                      本周恢复沿用
                    </button>
                  )}
                </div>
              </>
            )}
          </section>
        )}
        <section className="schedule-card">
          <h2>我的本周班次</h2>
          {!data?.mine?.length && (
            <p
              className={!data?.mine ? 'data-pending-copy' : undefined}
              aria-hidden={!data?.mine || undefined}
            >
              本周暂无班次。
            </p>
          )}
          {(data?.mine || []).map((item) => (
            <article data-motion-item={item.id} key={item.id}>
              <strong>
                {item.businessDate} · {dutyCampusNames[item.campusId]} ·{' '}
                {dutyTypeLabels[item.dutyType]} {item.startAt}–{item.endAt}
              </strong>
              <p>{item.leaveStatus === 'recorded' ? '已请假' : '按班次到场签到'}</p>
              {action?.item.id === item.id ? (
                <form
                  data-track="staff.schedule.form.12"
                  ref={formRef}
                  onSubmit={(event) => void saveAction(event).catch(() => {})}
                >
                  <fieldset disabled={busy}>
                    {action.kind === 'cover' && (
                      <label>
                        接替成员
                        <Select
                          data-track="staff.schedule.select.13"
                          required
                          value={recipient}
                          onChange={(event) => setRecipient(event.target.value)}
                        >
                          <option value="">请选择</option>
                          {people.map((person) => (
                            <option key={person.memberId} value={person.memberId}>
                              {person.name} · {person.studentId}
                            </option>
                          ))}
                        </Select>
                      </label>
                    )}
                    <label>
                      {action.kind === 'leave' ? '请假原因' : '给接替者的说明（可选）'}
                      <input
                        data-track="staff.schedule.input.14"
                        required={action.kind === 'leave'}
                        maxLength={500}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </label>
                    <div className="schedule-actions">
                      <button data-track="staff.schedule.button.15" type="submit">
                        {action.kind === 'leave' ? '登记请假' : '发送接替邀请'}
                      </button>
                      <button
                        data-track="staff.schedule.button.16"
                        type="button"
                        onClick={() => setAction(null)}
                      >
                        取消
                      </button>
                    </div>
                  </fieldset>
                </form>
              ) : (
                <div className="schedule-actions">
                  {item.leaveStatus === 'recorded' ? (
                    <button
                      data-track="staff.schedule.button.17"
                      disabled={busy || !!editor || !!action}
                      onClick={() =>
                        run(`/api/rosters/assignments/${item.id}/leave-withdraw`, {
                          revision: item.revision
                        })
                      }
                    >
                      撤销请假
                    </button>
                  ) : (
                    <button
                      data-track="staff.schedule.button.18"
                      disabled={busy || !!editor || !!action}
                      onClick={() => void openAction(item, 'leave')}
                    >
                      登记请假
                    </button>
                  )}
                  <button
                    data-track="staff.schedule.button.19"
                    disabled={busy || !!editor || !!action}
                    onClick={() => void openAction(item, 'cover')}
                  >
                    邀请接替
                  </button>
                </div>
              )}
            </article>
          ))}
        </section>
        {data?.covers?.length > 0 && (
          <section className="schedule-card">
            <h2>接替邀请</h2>
            {data.covers.map((item) => (
              <article data-motion-item={item.id} key={item.id}>
                <p>
                  {item.fromName} → {item.toName} · {item.assignment.businessDate} ·{' '}
                  {dutyCampusNames[item.assignment.campusId]} {item.assignment.startAt}–
                  {item.assignment.endAt}
                </p>
                <p>
                  {
                    {
                      pending: '待对方确认',
                      accepted: '已接替',
                      declined: '已拒绝',
                      cancelled: '已撤回'
                    }[item.status]
                  }
                  {item.note ? ` · ${item.note}` : ''}
                </p>
                <div className="schedule-actions">
                  {item.canRespond &&
                    ['accepted', 'declined'].map((decision) => (
                      <button
                        data-track="staff.schedule.button.20"
                        key={decision}
                        disabled={busy}
                        onClick={() =>
                          run(`/api/rosters/covers/${item.id}/response`, {
                            revision: item.revision,
                            decision
                          })
                        }
                      >
                        {decision === 'accepted' ? '确认接替' : '拒绝'}
                      </button>
                    ))}
                  {item.canCancel && (
                    <button
                      data-track="staff.schedule.button.21"
                      disabled={busy}
                      onClick={() =>
                        run(`/api/rosters/covers/${item.id}/response`, {
                          revision: item.revision,
                          decision: 'cancelled'
                        })
                      }
                    >
                      撤回邀请
                    </button>
                  )}
                </div>
              </article>
            ))}
          </section>
        )}
      </>
      {scan && active && (
        <Modal title="工作人员签到" onClose={() => setScan(false)}>
          <Scanner onCode={(value) => void checkIn(value)} />
          {error && <p role="alert">{error}</p>}
          <p>扫描现场工作人员签到码后，将以本人账号直接签到。</p>
        </Modal>
      )}
      <Attendance embedded />
    </div>
  );
}
