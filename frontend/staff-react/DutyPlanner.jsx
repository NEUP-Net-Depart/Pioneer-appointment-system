import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext, Modal } from './field/ui';
import { request } from './request.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { DataValue } from './DataValue';
import { addDays, weekRange } from '../../shared/time.js';
import {
  DUTY_START,
  DUTY_END,
  DUTY_TYPES,
  dutyTypeLabels,
  dutyLeader,
  availableForDuty,
  dutyCandidateTypes
} from '../../shared/duty.js';

export function DutyPlanner({ campusId, onDirtyChange }) {
  const client = useQueryClient();
  const active = useContext(ActivityContext),
    lock = useRef(false),
    saveId = useRef(crypto.randomUUID());
  const [week, setWeek] = useState(() => addDays(weekRange().start, 7)),
    [draft, setDraft] = useState([]),
    [draftSource, setDraftSource] = useState(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [picker, setPicker] = useState(null),
    [unassigned, setUnassigned] = useState([]);
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
    setDraft(data.rosters.flatMap((row) => row.assignments));
    setUnassigned([]);
  }, [data, dirty]);
  function change(items) {
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
            '/api/attendance/day',
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
      setUnassigned([]);
    }
  });
  const run = (operation) => void execute(operation).catch(() => {});
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
    setUnassigned(result.unassigned);
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
      ...Array.from({ length: 4 }, (_, i) => addDays(week, i)),
      ...visibleDraft.map((row) => row.businessDate)
    ])
  ].sort();
  const warnings = [];
  if (data) {
    for (const person of data.people) {
      const rows = draft.filter((row) => row.memberId === person.memberId);
      if (rows.length + Number(person.alreadyScheduled) > 1)
        warnings.push(`${person.name}本周有多次安排`);
      for (const row of rows) {
        const weekday = new Date(`${row.businessDate}T12:00:00Z`).getUTCDay() || 7;
        if (!availableForDuty(person.availability[row.dutyType], weekday, campusId))
          warnings.push(`${person.name} ${row.businessDate}不在已填整班空闲内`);
        if (!dutyCandidateTypes(person.memberships, row.businessDate).includes(row.dutyType))
          warnings.push(`${person.name}为跨部门安排`);
      }
    }
    for (const day of dates) {
      if (!data.paused.includes(day) && !draft.some((row) => row.businessDate === day))
        warnings.push(`${day}尚未安排值班人员`);
      if (
        !data.paused.includes(day) &&
        !draft.some(
          (row) =>
            row.businessDate === day &&
            row.leaveStatus !== 'recorded' &&
            dutyLeader(
              data.people.find((person) => person.memberId === row.memberId)?.memberships || [],
              day
            )
        )
      )
        warnings.push(`${day}缺少硬件部负责人或更高职位人员`);
    }
  }
  return (
    <div className="duty-planner">
      <div className="duty-toolbar">
        <label>
          所在周
          <input
            type="date"
            value={week}
            disabled={dirty || busy}
            onChange={(event) => event.target.value && setWeek(weekRange(event.target.value).start)}
          />
        </label>
        <button disabled={dirty || busy} onClick={() => setWeek(addDays(weekRange().start, 7))}>
          下周
        </button>
        <span>维修 / 办公 · 19:00–21:00</span>
      </div>
      {failure && (
        <p role="alert" className="react-error">
          {failure}
          <button onClick={() => result.refetch()}>重试读取</button>
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <form ref={formRef} aria-busy={!data} onSubmit={(event) => void save(event).catch(() => {})}>
        <fieldset disabled={busy || !data}>
          <div className="duty-section-heading">
            <div>
              <h2>安排一周值班</h2>
              <p className="field-muted">按空闲生成建议，每人每周最多一次；手动调整可保留例外。</p>
            </div>
            <div className="schedule-actions">
              <button type="button" onClick={() => run(suggest)}>
                {draft.some((row) => row.suggested) ? '重新生成建议' : '生成建议班表'}
              </button>
              <button type="submit" className="field-primary" disabled={!dirty}>
                发布班表
              </button>
              {dirty && (
                <button
                  type="button"
                  onClick={() => {
                    setDirty(false);
                    setDraft(data.rosters.flatMap((row) => row.assignments));
                    setUnassigned([]);
                  }}
                >
                  放弃调整
                </button>
              )}
            </div>
          </div>
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
                                {dutyLeader(person?.memberships || [], day) ? ' · 负责人' : ''}
                                {row.leaveStatus === 'recorded' ? ' · 已请假' : ''}
                                {row.suggested ? ' · 建议' : ''}
                                {row.startAt !== DUTY_START || row.endAt !== DUTY_END
                                  ? ` · ${row.startAt}–${row.endAt}`
                                  : ''}
                              </span>
                              <button
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
                        type="button"
                        className="duty-add-person"
                        onClick={() => setPicker({ day, type, index })}
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
            <details className="duty-warnings" open>
              <summary>需核对 · {warnings.length}</summary>
              <ul>
                {[...new Set(warnings)].map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
              <p>这些提示供现场协调，核对后可直接发布；时间冲突仍会阻止提交。</p>
            </details>
          )}
          {!!unassigned.length && (
            <details>
              <summary>未安排成员 · {unassigned.length}</summary>
              <ul>
                {unassigned.map((person) => (
                  <li key={person.memberId}>
                    {person.name} · {person.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </fieldset>
      </form>
      {picker && data && (
        <Modal
          title={`${picker.day} · ${dutyTypeLabels[picker.type]}选择人员`}
          onClose={() => setPicker(null)}
        >
          <div className="duty-people-picker">
            {data.people.map((person) => {
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
                <label key={person.memberId}>
                  <input
                    type="checkbox"
                    disabled={busy || sameDay}
                    checked={selected}
                    onChange={() => toggle(person)}
                  />
                  <span>
                    <strong>{person.name}</strong>
                    <small>
                      {dutyCandidateTypes(person.memberships, picker.day).includes(picker.type)
                        ? '本岗位'
                        : '跨部门'}{' '}
                      ·{' '}
                      {availableForDuty(person.availability[picker.type], weekday, campusId)
                        ? '整班有空'
                        : '未填整班空闲'}
                      {person.alreadyScheduled ||
                      draft.some(
                        (row) => row.memberId === person.memberId && row.businessDate !== picker.day
                      )
                        ? ' · 本周已有安排'
                        : ''}
                      {sameDay ? ' · 同日已排其他岗位' : ''}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          <button className="field-primary" onClick={() => setPicker(null)}>
            完成选择
          </button>
        </Modal>
      )}
    </div>
  );
}
