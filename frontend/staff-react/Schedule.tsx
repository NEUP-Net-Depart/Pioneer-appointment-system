import type { Query } from '@tanstack/react-query';
import type { AvailabilityWindow, StaffProfileDto } from '../../shared/staff-types.ts';
import type { ItemsResponse } from '../../shared/api-types.ts';
import type { Home } from './field/types.ts';
import type {
  DirtyChange,
  DutyAvailabilityDto,
  DutyCoverDto,
  PublishedDutyShift,
  VolunteerSummaryDto
} from './management-types.ts';

const campusIds: Partial<Record<string, string>> = { 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' };
import { failureFrom } from '../../shared/api-types.ts';
import { Select } from './SelectionControls.tsx';
import { WeekPicker } from './WeekPicker.tsx';
import { useContext, useEffect, useRef, useState } from 'react';
import { request } from './request.ts';
import { DataValue } from './DataValue';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AttendanceCheckInButton } from './field/AttendanceActions';
import { campusAttendance } from './field/attendance-state';
import { CheckInDialog } from './field/CheckInDialog';
import { ActivityContext, time } from './field/ui';
import { useUnsavedChanges } from './useUnsavedChanges.ts';
import { CampusScope } from './CampusScope.tsx';
import { RefreshButton } from './WorkspaceToolbar.tsx';
import { Attendance } from './Attendance';
import { addDays, dateKey, dutyWeekKey } from '../../shared/time.ts';
import { isRetiredElder } from '../../shared/staff-identities.ts';
import {
  DUTY_START,
  DUTY_END,
  DUTY_WEEKDAYS,
  dutyTypeLabels,
  dutyCampusName,
  availableForDuty,
  hasDutyAvailability,
  dutyCandidateTypes,
  isDutyExempt
} from '../../shared/duty.ts';

const days = ['周一', '周二', '周三', '周四'];
export function Schedule({
  user,
  campusId: initialCampus,
  onDirtyChange
}: {
  user: StaffProfileDto;
  campusId: string;
  onDirtyChange: DirtyChange;
}) {
  const [selectedCampus, setSelectedCampus] = useState(initialCampus);
  const campusId = (user.authorizedCampuses || [])
    .map((name) => campusIds[name] || name)
    .includes(selectedCampus)
    ? selectedCampus
    : initialCampus;
  const client = useQueryClient();
  const active = useContext(ActivityContext),
    lock = useRef(false);
  const [week, setWeek] = useState(() => dutyWeekKey());
  const retired = isRetiredElder(user);
  const exempt = retired || isDutyExempt(user.memberships || [], dateKey());
  const participates = !exempt && dutyCandidateTypes(user.memberships || [], dateKey()).length > 0;
  const [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const availability = useQuery<DutyAvailabilityDto>({
    queryKey: ['/api/me/availability', { weekStart: week }],
    enabled: active && participates
  });
  const mine = useQuery<ItemsResponse<PublishedDutyShift>>({
    queryKey: ['/api/me/roster', { weekStart: week }],
    enabled: active
  });
  const upcoming = useQuery<ItemsResponse<PublishedDutyShift>>({
    queryKey: ['/api/me/roster', { upcoming: '1' }],
    enabled: active
  });
  const covers = useQuery<ItemsResponse<DutyCoverDto>>({
    queryKey: ['/api/rosters/covers'],
    enabled: active
  });
  const home = useQuery<Home>({ queryKey: ['/api/field/home', { campusId }], enabled: active });
  const hours = useQuery<VolunteerSummaryDto>({
    queryKey: ['/api/me/volunteer-summary'],
    enabled: active
  });
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
  const [editor, setEditor] = useState<'usual' | 'exception' | null>(null),
    [editorRevision, setEditorRevision] = useState<number | null>(null),
    [windows, setWindows] = useState<AvailabilityWindow[]>([]),
    [scan, setScan] = useState(false),
    [action, setAction] = useState<{ item: PublishedDutyShift } | null>(null),
    [reason, setReason] = useState(''),
    [recipient, setRecipient] = useState('');
  const peopleQuery = useQuery<
    ItemsResponse<{ memberId: string; name: string; studentId: string | null }>
  >({
    queryKey: [`/api/rosters/assignments/${action?.item.id}/cover-candidates`],
    enabled: active && !!action
  });
  const people = peopleQuery.data?.items || [];
  const campuses = (user.authorizedCampuses || []).map((value) => campusIds[value] || value);
  useEffect(() => {
    onDirtyChange(!!editor || !!action || busy);
    return () => onDirtyChange(false);
  }, [editor, action, busy, onDirtyChange]);
  useEffect(() => {
    if (!active) setScan(false);
    setError('');
  }, [active, week, campusId]);
  async function mutate(path: string, body: Record<string, unknown>, method = 'POST') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await request(path, { method, body: { ...body, requestId: crypto.randomUUID() } });
      setEditor(null);
      setAction(null);
      setNotice(body.decision === 'accepted' ? '调岗已生效' : '已保存');
      const affectedQueries = {
        predicate: (query: Query) =>
          (path === '/api/me/availability'
            ? ['/api/me/availability', '/api/rosters/campus-week']
            : [
                '/api/me/roster',
                '/api/rosters/covers',
                '/api/rosters/campus-week',
                '/api/attendance/day',
                '/api/attendance/staffing',
                '/api/slot-capacities/actual',
                '/api/field/home',
                '/api/field/board',
                '/api/me/volunteer-summary',
                '/api/attendance/volunteer-report',
                '/api/attendance/matrix',
                '/api/attendance/weekly-summary'
              ]
          ).includes(query.queryKey[0] as string)
      };
      await client.cancelQueries(affectedQueries);
      await client.invalidateQueries(affectedQueries);
      return true;
    } catch (failureValue) {
      const failure = failureFrom(failureValue);
      setError(failure.message);
      throw failure;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function saveAvailability(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!hasDutyAvailability(windows, campuses)) {
      setError('请至少选择一天完整空闲时间');
      return false;
    }
    return mutate(
      '/api/me/availability',
      {
        weekStart: editor === 'usual' ? '' : week,
        revision: editorRevision,
        windows
      },
      'PUT'
    );
  }
  async function saveAction(event: { preventDefault(): void }) {
    event.preventDefault();
    if (!action) return;
    return mutate(`/api/rosters/assignments/${action.item.id}/cover`, {
      revision: action.item.revision,
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
  function editAvailability(kind: 'usual' | 'exception') {
    const availability = data.availability;
    if (!availability) return;
    setEditorRevision(
      kind === 'usual' ? availability.usual.revision : (availability.exception?.revision ?? -1)
    );
    setWindows(
      (kind === 'usual' ? availability.usual.windows || [] : availability.effectiveWindows).filter(
        (row) => DUTY_WEEKDAYS.includes(row.weekday)
      )
    );
    setEditor(kind);
    setError('');
  }
  function toggle(weekday: number, campus: string) {
    const selected = availableForDuty(windows, weekday, campus);
    setWindows((current) => [
      ...current.filter((row) => !(row.weekday === weekday && row.campusId === campus)),
      ...(!selected ? [{ weekday, campusId: campus, startAt: DUTY_START, endAt: DUTY_END }] : [])
    ]);
  }
  function openAction(item: PublishedDutyShift) {
    setReason('');
    setRecipient('');
    setError('');
    setAction({ item });
  }
  const run = (...args: Parameters<typeof mutate>) => void mutate(...args).catch(() => {});
  const today = dateKey(),
    todayRecord = live?.campusId === campusId ? campusAttendance(live) : null,
    todayDuties = data?.upcoming?.filter((row) => row.businessDate === today) || [];
  const next = data?.upcoming?.find((row) => row.businessDate > today);
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
              {today} · {dutyCampusName(campusId)}
            </span>
            <h2>今日安排</h2>
            {todayDuties.map((row) => (
              <p key={row.id}>
                {dutyCampusName(row.campusId)} · {dutyTypeLabels[row.dutyType]} {row.startAt}–
                {row.endAt}
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
                下一次：{next.businessDate} · {dutyCampusName(next.campusId)} {next.startAt}–
                {next.endAt}
              </p>
            )}
          </div>
          <div className="duty-checkin-actions">
            <CampusScope
              data-track="staff.schedule.campusscope.22"
              label="签到校区"
              campuses={campuses.map((id: string) => ({ id, name: dutyCampusName(id) || id }))}
              value={campusId}
              disabled={busy || scan}
              onChange={setSelectedCampus}
            />
            {todayRecord ? (
              <strong>已签到 · {time(todayRecord.occurredAt)}</strong>
            ) : (
              live?.campusId === campusId && (
                <AttendanceCheckInButton data={live} busy={busy} onCheckIn={() => setScan(true)} />
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
            {retired
              ? '，退休老登仅按有效签到计入，未签到不计时长'
              : summary?.settings.mergeLeaders
                ? '，负责人每周自动计入一次'
                : ''}
            。
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
            onClick={() => setWeek(dutyWeekKey())}
          >
            本周
          </button>
          <button
            data-track="staff.schedule.button.3"
            disabled={!!editor || !!action || busy}
            onClick={() => setWeek(addDays(dutyWeekKey(), 7))}
          >
            下周
          </button>
          <RefreshButton
            data-track="staff.schedule.refreshbutton.23"
            key={`${campusId}:${week}`}
            label="刷新我的值班"
            compactOnMobile
            disabled={busy}
            onRefresh={() =>
              Promise.all([
                ...[availability, mine, upcoming, covers, home, hours]
                  .filter((query) => query !== availability || participates)
                  .map((query) => query.refetch({ throwOnError: true })),
                client.invalidateQueries(
                  { queryKey: ['/api/me/attendance'] },
                  { throwOnError: true }
                )
              ])
            }
          />
        </div>
        <section
          className="schedule-card duty-availability-card"
          aria-labelledby="duty-availability-title"
        >
          <div className="duty-section-heading">
            <h2 id="duty-availability-title">{participates ? '空闲时间' : '值班统计'}</h2>
            {participates && <span className="duty-shift-time">19:00–21:00</span>}
          </div>
          {!participates ? (
            <p className="duty-statistics-exempt">不参与值班统计</p>
          ) : (
            <>
              {editor ? (
                <form
                  data-track="staff.schedule.form.5"
                  ref={formRef}
                  onSubmit={(event) => void saveAvailability(event).catch(() => {})}
                >
                  <fieldset disabled={busy}>
                    <legend>{editor === 'usual' ? '通常空闲' : '仅此周空闲'} · 至少选一天</legend>
                    <div className="duty-availability">
                      {campuses.map((campus) => (
                        <fieldset key={campus} className="duty-availability-campus">
                          <legend>{dutyCampusName(campus)}</legend>
                          <div className="duty-weekday-options">
                            {DUTY_WEEKDAYS.map((weekday) => (
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
                        </fieldset>
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
                        disabled={!hasDutyAvailability(windows, campuses)}
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
                      .filter(
                        (row) =>
                          DUTY_WEEKDAYS.includes(row.weekday) &&
                          row.startAt <= DUTY_START &&
                          row.endAt >= DUTY_END
                      )
                      .sort(
                        (first, second) =>
                          first.weekday - second.weekday ||
                          campuses.indexOf(first.campusId) - campuses.indexOf(second.campusId)
                      )
                      .map((row) => `${days[row.weekday - 1]} ${dutyCampusName(row.campusId)}`)
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
                        disabled={
                          busy ||
                          !!action ||
                          !hasDutyAvailability(data.availability.usual.windows || [], campuses)
                        }
                        onClick={() =>
                          run(
                            '/api/me/availability',
                            {
                              weekStart: week,
                              revision: data.availability?.exception?.revision,
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
            </>
          )}
        </section>
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
                {item.businessDate} · {dutyCampusName(item.campusId)} ·{' '}
                {dutyTypeLabels[item.dutyType]} {item.startAt}–{item.endAt}
              </strong>
              <p>按班次到场签到</p>
              {action?.item.id === item.id ? (
                <form
                  data-track="staff.schedule.form.12"
                  ref={formRef}
                  onSubmit={(event) => void saveAction(event).catch(() => {})}
                >
                  <fieldset disabled={busy}>
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
                    <label>
                      给接替者的说明（可选）
                      <input
                        data-track="staff.schedule.input.14"
                        maxLength={500}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </label>
                    <div className="schedule-actions">
                      <button
                        data-track="staff.schedule.button.15"
                        type="submit"
                        disabled={!item.canRequestCover || item.businessDate <= today}
                      >
                        发送接替邀请
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
              ) : !retired && item.canRequestCover && item.businessDate > today ? (
                <div className="schedule-actions">
                  <button
                    data-track="staff.schedule.button.19"
                    disabled={busy || !!editor || !!action}
                    onClick={() => openAction(item)}
                  >
                    邀请接替
                  </button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
        {!retired && !!data.covers?.length && (
          <section className="schedule-card">
            <h2>接替邀请</h2>
            {data.covers?.map((item) => (
              <article data-motion-item={item.id} key={item.id}>
                <p>
                  {item.fromName} → {item.toName} · {item.assignment.businessDate} ·{' '}
                  {dutyCampusName(item.assignment.campusId)} {item.assignment.startAt}–
                  {item.assignment.endAt}
                </p>
                <p>
                  {
                    {
                      pending: '待对方确认',
                      accepted: '已接替',
                      declined: '已拒绝',
                      cancelled: '已撤回',
                      expired: '已过调岗期限',
                      paused: '暂停维修'
                    }[item.status]
                  }
                  {item.note ? ` · ${item.note}` : ''}
                </p>
                <div className="schedule-actions">
                  {item.canRespond &&
                    ['accepted', 'declined']
                      .filter((decision) => decision !== 'accepted' || !exempt)
                      .map((decision) => (
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
      {scan && active && live && (
        <CheckInDialog
          home={live}
          scan={!live.directAttendance?.allowed}
          onClose={() => setScan(false)}
          onComplete={(record) => {
            setScan(false);
            setNotice(`${dutyCampusName(record.campusId)}签到成功 · ${time(record.occurredAt)}`);
          }}
        />
      )}
      <Attendance embedded />
    </div>
  );
}
