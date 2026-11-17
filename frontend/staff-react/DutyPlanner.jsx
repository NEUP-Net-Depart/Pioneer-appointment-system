import { WeekPicker } from './WeekPicker.jsx';
import { HelpHint } from './HelpHint';
import { RefreshButton } from './WorkspaceToolbar.jsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext, Modal } from './field/ui';
import { request } from './request.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { DataValue } from './DataValue';
import { addDays, dutyWeekKey } from '../../shared/time.js';
import { activeMemberships, membershipLabel } from '../../shared/staff-organization.js';
import {
  DUTY_START,
  DUTY_END,
  DUTY_TYPES,
  DUTY_WEEKDAYS,
  dutyTypeLabels,
  dutyCampusNames,
  isDutyExempt,
  availableForDuty,
  dutyCandidateTypes,
  dutyPlanningReview,
  manualDutyPriority
} from '../../shared/duty.js';

export function DutyPlanner({ campusId, onDirtyChange, campusControl = null }) {
  const client = useQueryClient();
  const active = useContext(ActivityContext),
    lock = useRef(false),
    saveId = useRef(crypto.randomUUID());
  const [week, setWeek] = useState(() => addDays(dutyWeekKey(), 7)),
    [draft, setDraft] = useState([]),
    [draftSource, setDraftSource] = useState(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [picker, setPicker] = useState(null),
    [peopleSearch, setPeopleSearch] = useState(''),
    [optimization, setOptimization] = useState(null);
  const queryKey = ['/api/rosters/campus-week', { weekStart: week, campusId }];
  const result = useQuery({ queryKey, enabled: active && !dirty });
  const data = dirty ? draftSource : result.data;
  const failure = error || result.error?.message;
  const visibleDraft = data ? draft : [];
  useEffect(() => {
    onDirtyChange(dirty || busy);
    return () => onDirtyChange(false);
  }, [dirty, busy, onDirtyChange]);
  useEffect(() => {
    if (!data || dirty) return;
    setOptimization(null);
    setDraft(data.rosters.flatMap((row) => row.assignments));
  }, [data, dirty]);
  function change(items) {
    setOptimization(null);
    saveId.current = crypto.randomUUID();
    if (!dirty) setDraftSource(result.data);
    setDraft(items);
    setDirty(true);
    setNotice('');
  }
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
  async function save(event) {
    event.preventDefault();
    return execute(async () => {
      const result = await request('/api/rosters/campus-week', {
        method: 'PUT',
        body: {
          weekStart: week,
          campusId,
          sourceVersion: data.sourceVersion,
          requestId: saveId.current,
          rosters: data.rosters.map((row) => ({
            dutyType: row.dutyType,
            revision: row.revision,
            assignments: draft.filter((item) => item.dutyType === row.dutyType)
          }))
        }
      });
      await client.cancelQueries({ queryKey: queryKey });
      client.setQueryData(queryKey, result);
      const affectedQueries = {
        predicate: (query) =>
          [
            '/api/me/roster',
            '/api/rosters/covers',
            '/api/attendance/day',
            '/api/attendance/staffing',
            '/api/slot-capacities/actual',
            '/api/field/home',
            '/api/field/board',
            '/api/attendance/volunteer-report',
            '/api/attendance/matrix'
          ].includes(query.queryKey[0])
      };
      await client.cancelQueries(affectedQueries);
      await client.invalidateQueries(affectedQueries);
      setDraft(result.rosters.flatMap((row) => row.assignments));
      setDirty(false);
      setNotice('维修和办公班表已发布，签到已自动准备');
      return true;
    });
  }
  const formRef = useUnsavedChanges({
    dirty,
    active,
    busy,
    save,
    discard: () => {
      setDirty(false);
      setDraft(data?.rosters.flatMap((row) => row.assignments) || []);
      setPicker(null);
    }
  });
  const run = (operation) => void execute(operation).catch(() => {});
  async function reload(discard = false) {
    await execute(async () => {
      const latest = await result.refetch();
      if (latest.error) throw latest.error;
      const fresh = latest.data;
      const published = fresh.rosters.flatMap((row) => row.assignments);
      if (dirty && !discard) {
        const original = new Map(
          data.rosters.flatMap((row) => row.assignments).map((row) => [row.id, row])
        );
        const retained = new Set(draft.map((row) => row.id));
        const merged = published.filter(
          (row) =>
            !original.has(row.id) ||
            retained.has(row.id) ||
            JSON.stringify(row) !== JSON.stringify(original.get(row.id))
        );
        const additions = draft.filter((row) => !original.has(row.id));
        const keys = new Set(
          merged.map((row) => `${row.memberId}:${row.businessDate}:${row.dutyType}`)
        );
        setDraft([
          ...merged,
          ...additions.filter(
            (row) => !keys.has(`${row.memberId}:${row.businessDate}:${row.dutyType}`)
          )
        ]);
        setDraftSource(fresh);
        setNotice(
          '已读取最新人员、空闲和班表，保留手动新增；远端修改优先保留，请核对冲突提示后发布。'
        );
      } else {
        setDraft(published);
        setDraftSource(null);
        setDirty(false);
        setNotice('已载入最新班表');
      }
      saveId.current = crypto.randomUUID();
      setPicker(null);
    });
  }
  async function suggest() {
    const result = await request('/api/rosters/week/suggestions', {
      method: 'POST',
      body: {
        weekStart: week,
        campusId,
        sourceVersion: data.sourceVersion,
        assignments: draft.filter((row) => !row.suggested)
      }
    });
    change(result.assignments);
    setOptimization(result.optimization);
    setDraftSource((current) => ({ ...current, sourceVersion: result.sourceVersion }));
    setNotice('建议已生成，请核对后发布');
  }
  function toggle(person) {
    const found = draft.find(
      (row) =>
        row.memberId === person.memberId &&
        row.businessDate === picker.day &&
        row.dutyType === picker.type
    );
    change(
      found
        ? draft.filter((row) => row !== found)
        : [
            ...draft,
            {
              id: crypto.randomUUID(),
              memberId: person.memberId,
              memberName: person.name,
              businessDate: picker.day,
              dutyType: picker.type,
              startAt: DUTY_START,
              endAt: DUTY_END
            }
          ]
    );
  }
  const dates = [
    ...new Set([
      ...DUTY_WEEKDAYS.map((weekday) => addDays(week, weekday - 1)),
      ...visibleDraft.map((row) => row.businessDate)
    ])
  ].sort();
  const warnings = [];
  const review = data
    ? dutyPlanningReview({ ...data, assignments: draft })
    : { gaps: [], unassigned: [] };
  const unassigned = review.unassigned.filter(
    (person) => person.reasonCode !== 'scheduled_elsewhere'
  );
  const serviceDates = DUTY_WEEKDAYS.map((weekday) => addDays(week, weekday - 1)).filter(
    (day) => !data?.paused.includes(day)
  );
  const activeDraft = draft.filter((row) => serviceDates.includes(row.businessDate));
  const loadRange = (dutyType = '') => {
    const counts = serviceDates.map(
      (day) =>
        draft.filter((row) => row.businessDate === day && (!dutyType || row.dutyType === dutyType))
          .length
    );
    return {
      min: counts.length ? Math.min(...counts) : 0,
      max: counts.length ? Math.max(...counts) : 0
    };
  };
  const conflicts = new Set(
    activeDraft
      .filter((row) => {
        const person = data?.people.find((item) => item.memberId === row.memberId);
        const weekday = new Date(`${row.businessDate}T12:00:00Z`).getUTCDay();
        return person && !availableForDuty(person.availability[row.dutyType], weekday, campusId);
      })
      .map((row) => row.memberId)
  );
  const pickerPeople =
    picker && data
      ? data.people
          .filter((person) => !isDutyExempt(person.memberships, picker.day))
          .map((person) => ({
            ...person,
            posts: activeMemberships({ memberships: person.memberships, businessDate: picker.day }),
            rank: manualDutyPriority(person.memberships, picker.day, picker.type)
          }))
          .filter((person) =>
            `${person.name} ${person.studentId || ''} ${dutyCampusNames[person.homeCampusId] || ''} ${(person.campuses || []).join(' ')} ${person.posts.map(membershipLabel).join(' ')}`.includes(
              peopleSearch.trim()
            )
          )
          .sort(
            (first, second) =>
              first.rank - second.rank ||
              first.name.localeCompare(second.name, 'zh-CN') ||
              first.memberId.localeCompare(second.memberId)
          )
      : [];
  if (data) {
    for (const row of draft) {
      if (!data.people.some((person) => person.memberId === row.memberId))
        warnings.push(`${row.memberName || row.memberId}已不在可排班范围，请移除该安排`);
      if (data.paused.includes(row.businessDate))
        warnings.push(`${row.businessDate}已暂停服务，请核对保留的安排`);
    }
    for (const person of data.people) {
      const rows = draft.filter((row) => row.memberId === person.memberId);
      if (
        serviceDates.some((day) =>
          dutyCandidateTypes(person.memberships, day).includes('repair')
        ) &&
        rows.length + Number(person.alreadyScheduled) > 1
      )
        warnings.push(`${person.name}本周有多次安排`);
      for (const row of rows) {
        if (isDutyExempt(person.memberships, row.businessDate))
          warnings.push(`${person.name}不参与值班统计，请移除对应安排`);
        const weekday = new Date(`${row.businessDate}T12:00:00Z`).getUTCDay() || 7;
        if (!availableForDuty(person.availability[row.dutyType], weekday, campusId))
          warnings.push(`${person.name} ${row.businessDate}不在已填整班空闲内`);
        if (!dutyCandidateTypes(person.memberships, row.businessDate).includes(row.dutyType))
          warnings.push(`${person.name}为跨部门安排`);
      }
    }
    for (const dutyType of ['repair']) {
      const range = loadRange(dutyType);
      if (range.max - range.min > 2)
        warnings.push(
          `${dutyTypeLabels[dutyType] || '合计'}每日人数为${range.min}–${range.max}人，相差超过2人`
        );
    }
  }
  return (
    <div className="duty-planner">
      <div className="duty-toolbar duty-planner-toolbar">
        {campusControl}
        <WeekPicker
          data-track="staff.dutyplanner.input.1"
          label="所在周"
          value={week}
          disabled={dirty || busy}
          onChange={setWeek}
        />
        <button
          data-track="staff.dutyplanner.button.2"
          disabled={dirty || busy}
          onClick={() => setWeek(addDays(dutyWeekKey(), 7))}
        >
          下周
        </button>
        <RefreshButton
          data-track="staff.dutyplanner.refreshbutton.13"
          key={`${campusId}:${week}`}
          label="读取最新班表"
          disabled={busy}
          onRefresh={() => reload()}
        />
      </div>
      {failure && (
        <p role="alert" className="react-error">
          {failure}
          <button
            data-track="staff.dutyplanner.button.3"
            disabled={busy}
            onClick={() => void reload().catch(() => {})}
          >
            重试读取
          </button>
          {dirty && (
            <button
              data-track="staff.dutyplanner.button.4"
              disabled={busy}
              onClick={() => {
                if (window.confirm('放弃当前未发布的调整，载入最新班表？'))
                  void reload(true).catch(() => {});
              }}
            >
              放弃草稿并读取
            </button>
          )}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form
        data-track="staff.dutyplanner.form.5"
        ref={formRef}
        aria-busy={!data}
        onSubmit={(event) => void save(event).catch(() => {})}
      >
        <fieldset disabled={busy || !data}>
          <div className="duty-section-heading">
            <div>
              <h2 className="workspace-title-with-hint">
                安排一周值班
                <HelpHint data-track="staff.dutyplanner.helphint.14" label="班表生成规则">
                  硬件部员每周一天，维修每日人数差不超过2人，尽量避开空闲冲突。办公按当天空闲安排，每天最多一人，缺人可留空。
                </HelpHint>
              </h2>
            </div>
            <div className="schedule-actions">
              <button
                data-track="staff.dutyplanner.button.6"
                type="button"
                onClick={() => run(suggest)}
              >
                {draft.some((row) => row.suggested) ? '重新生成建议' : '生成建议班表'}
              </button>
              <button
                data-track="staff.dutyplanner.button.7"
                type="submit"
                className="field-primary"
                disabled={!dirty}
              >
                发布班表
              </button>
              {dirty && (
                <button
                  data-track="staff.dutyplanner.button.8"
                  type="button"
                  onClick={() => {
                    setDirty(false);
                    setDraft(data.rosters.flatMap((row) => row.assignments));
                  }}
                >
                  放弃调整
                </button>
              )}
            </div>
          </div>
          {data && (
            <div className="duty-plan-metrics" role="group" aria-label="排班概览">
              {['', ...DUTY_TYPES].map((dutyType) => {
                const range = loadRange(dutyType);
                return (
                  <span key={dutyType}>
                    {dutyTypeLabels[dutyType] || '合计'}{' '}
                    <strong>
                      {range.min === range.max ? range.min : `${range.min}–${range.max}`}
                    </strong>{' '}
                    人/天
                  </span>
                );
              })}
              <span data-warning={conflicts.size > 0}>
                空闲冲突 <strong>{conflicts.size}</strong> 人
              </span>
            </div>
          )}
          {optimization &&
            (!optimization.balanced || !optimization.complete || !optimization.weeklyOnce) && (
              <p className="react-error" role="status">
                现有安排无法同时满足全部条件，请核对保留班次与可排日期。
              </p>
            )}
          {(review.gaps.length > 0 || unassigned.length > 0) && (
            <section className="duty-planning-review" aria-label="排班核对">
              <h3>排班待核对</h3>
              <div className="duty-review-types">
                {DUTY_TYPES.map((dutyType) => {
                  const members = unassigned.filter((person) => person.dutyType === dutyType);
                  const gaps = review.gaps.filter((row) => row.dutyType === dutyType);
                  if (!members.length && !gaps.length) return null;
                  return (
                    <div key={dutyType}>
                      <h4>{dutyTypeLabels[dutyType]}值班</h4>
                      {members.length > 0 && (
                        <ul aria-label={`${dutyTypeLabels[dutyType]}待安排成员`}>
                          {members.map((person) => (
                            <li key={person.memberId}>
                              <strong>{person.name}</strong>
                              <span>{person.reason}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {gaps.length > 0 && (
                        <p>
                          缺岗：
                          {gaps
                            .map(
                              (row) =>
                                `周${['一', '二', '三', '四'][DUTY_WEEKDAYS.findIndex((weekday) => addDays(week, weekday - 1) === row.businessDate)]}`
                            )
                            .join('、')}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}
          <div className="duty-week-grid">
            {dates.map((day, index) => (
              <section className="duty-day-column" key={day}>
                <header>
                  <h3>
                    {new Intl.DateTimeFormat('zh-CN', {
                      weekday: 'short',
                      timeZone: 'Asia/Shanghai'
                    }).format(new Date(`${day}T12:00:00Z`))}
                  </h3>
                  <span>{day.slice(5)}</span>
                </header>
                {data?.paused.includes(day) ? (
                  <p>暂停服务</p>
                ) : (
                  DUTY_TYPES.map((type) => (
                    <div key={type} className="duty-shift-group">
                      <h4>
                        {dutyTypeLabels[type]}{' '}
                        <span>
                          <DataValue label={`${day}${dutyTypeLabels[type]}人数`}>
                            {data
                              ? visibleDraft.filter(
                                  (row) => row.businessDate === day && row.dutyType === type
                                ).length
                              : undefined}
                          </DataValue>{' '}
                          人
                        </span>
                      </h4>
                      {visibleDraft
                        .filter((row) => row.businessDate === day && row.dutyType === type)
                        .map((row) => {
                          const person = data.people.find(
                            (person) => person.memberId === row.memberId
                          );
                          return (
                            <div data-motion-item={row.id} key={row.id} className="duty-assignee">
                              <span>
                                {person?.name || row.memberName || '原值班人员'}
                                {row.suggested ? ' · 建议' : ''}
                                {row.startAt !== DUTY_START || row.endAt !== DUTY_END
                                  ? ` · ${row.startAt}–${row.endAt}`
                                  : ''}
                              </span>
                              <button
                                data-track="staff.dutyplanner.button.9"
                                type="button"
                                aria-label={`移除${person?.name || row.memberName} ${day}${type}`}
                                onClick={() => change(draft.filter((item) => item !== row))}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      <button
                        data-track="staff.dutyplanner.button.10"
                        type="button"
                        className="duty-add-person"
                        onClick={() => {
                          setPeopleSearch('');
                          setPicker({ day, type, index });
                        }}
                      >
                        选择人员
                      </button>
                    </div>
                  ))
                )}
              </section>
            ))}
          </div>
          {!!warnings.length && (
            <section className="duty-warnings" aria-label="排班异常">
              <h3>需核对 · {new Set(warnings).size}</h3>
              <ul>
                {[...new Set(warnings)].map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </section>
          )}
        </fieldset>
      </form>
      {picker && data && (
        <Modal title="选择值班人员" onClose={() => setPicker(null)}>
          <p>
            {picker.day} · {dutyTypeLabels[picker.type]}值班
          </p>
          <div className="duty-people-picker">
            <label className="workspace-picker-search">
              搜索人员
              <input
                data-track="staff.dutyplanner.input.15"
                type="search"
                value={peopleSearch}
                placeholder="姓名、学号、校区或部门"
                onChange={(event) => setPeopleSearch(event.target.value)}
              />
            </label>
            {pickerPeople.map((person, index) => {
              const selected = draft.some(
                (row) =>
                  row.memberId === person.memberId &&
                  row.businessDate === picker.day &&
                  row.dutyType === picker.type
              );
              const sameDay = draft.some(
                (row) =>
                  row.memberId === person.memberId &&
                  row.businessDate === picker.day &&
                  row.dutyType !== picker.type
              );
              const weekday = new Date(`${picker.day}T12:00:00Z`).getUTCDay() || 7;
              return (
                <React.Fragment key={person.memberId}>
                  {(index === 0 || pickerPeople[index - 1].rank !== person.rank) && (
                    <h3 className="duty-picker-group">
                      {picker.type === 'repair'
                        ? ['硬件部部员', '交流维修', '其他部员'][person.rank]
                        : ['基础事务站部员', '其他部门部员'][person.rank]}
                    </h3>
                  )}
                  <label>
                    <input
                      data-track="staff.dutyplanner.input.11"
                      type="checkbox"
                      disabled={busy || sameDay}
                      checked={selected}
                      onChange={() => toggle(person)}
                    />
                    <span className="duty-picker-person">
                      <span className="duty-picker-person-heading">
                        <strong>{person.name}</strong>
                        <span>{person.studentId}</span>
                      </span>
                      <span className="duty-picker-person-details">
                        {dutyCampusNames[person.homeCampusId] ||
                          (person.campuses || []).join(' / ') ||
                          dutyCampusNames[campusId]}{' '}
                        · {person.posts.map(membershipLabel).join(' · ') || '暂无任职'}
                      </span>
                      <span className="duty-picker-person-availability">
                        {availableForDuty(person.availability[picker.type], weekday, campusId)
                          ? '整班有空'
                          : '空闲未覆盖，需协调'}
                        {person.alreadyScheduled ||
                        draft.some(
                          (row) =>
                            row.memberId === person.memberId && row.businessDate !== picker.day
                        )
                          ? ' · 本周已有安排'
                          : ''}
                        {sameDay ? ' · 同日已排其他岗位' : ''}
                      </span>
                    </span>
                  </label>
                </React.Fragment>
              );
            })}
          </div>
          <button
            data-track="staff.dutyplanner.button.12"
            className="field-primary"
            onClick={() => setPicker(null)}
          >
            完成选择
          </button>
        </Modal>
      )}
    </div>
  );
}
