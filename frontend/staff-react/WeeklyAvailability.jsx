import React, { useContext, useEffect, useRef, useState } from 'react';
import { request } from './request.js';
import { ActivityContext } from './field/ui';
import { CollectionScope } from './CollectionScope';
import { preferredRosterPeriod } from '../../shared/roster-collections.js';
import { fullDutyWindows } from '../../shared/duty-window.js';
import { addDays } from '../../shared/time.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';
const campusNames = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' };
export function WeeklyAvailability({ tasks }) {
  const active = useContext(ActivityContext),
    [taskId, setTaskId] = useState(''),
    [windows, setWindows] = useState([]),
    [unavailable, setUnavailable] = useState(false);
  const [submission, setSubmission] = useState(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [autoContinue, setAutoContinue] = useState(false),
    [preferences, setPreferences] = useState([]);
  const [selectableSlots, setSelectableSlots] = useState([]),
    [reload, setReload] = useState(0);
  const savedSelection = useRef({ windows: [], unavailable: false, autoContinue: false });
  const controller = useRef(null),
    lock = useRef(false),
    command = useRef(null),
    task = tasks.find((item) => item.id === taskId);
  useEffect(() => {
    if (dirty) return;
    const current = tasks.find((item) => item.id === taskId);
    if (current?.actions?.fill) return;
    const preferred = preferredRosterPeriod(tasks)?.id || '';
    if (preferred !== taskId) setTaskId(preferred);
  }, [tasks, taskId, dirty]);
  useEffect(() => {
    if (active)
      request('/api/me/availability-preferences')
        .then((result) => setPreferences(result.items))
        .catch((failure) => setError(failure.message));
  }, [active]);
  useEffect(() => {
    if (!taskId) return;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setError('');
    request(`/api/roster-tasks/${taskId}/availability`, { signal: abort.signal })
      .then((result) => {
        if (abort.signal.aborted) return;
        const restored = fullDutyWindows(result.items, task).filter((row) =>
          (result.selectableSlots || []).some(
            (slot) => slot.businessDate === row.businessDate && slot.campusId === row.campusId
          )
        );
        setWindows(restored);
        savedSelection.current = {
          windows: restored,
          unavailable: !!result.submission?.unavailable,
          autoContinue: result.autoContinue
        };
        setSelectableSlots(result.selectableSlots || []);
        setSubmission(result.submission);
        setAutoContinue(result.autoContinue);
        setUnavailable(!!result.submission?.unavailable);
        setDirty(false);
        setNotice(
          result.items.some((row) => row.startAt > task.slotStart || row.endAt < task.slotEnd)
            ? '原填报包含不足整次值班的时间，请重新勾选完整日期并提交。'
            : ''
        );
      })
      .catch((failure) => {
        if (!abort.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [taskId, reload]);
  const navigationForm = useUnsavedChanges({
    dirty,
    active,
    busy,
    save: submit,
    discard: () => {
      setWindows(savedSelection.current.windows);
      setUnavailable(savedSelection.current.unavailable);
      setAutoContinue(savedSelection.current.autoContinue);
      setDirty(false);
      setError('');
      command.current = null;
    }
  });
  function toggle(day, campusId) {
    setWindows((current) =>
      current.some((row) => row.businessDate === day && row.campusId === campusId)
        ? current.filter((row) => row.businessDate !== day || row.campusId !== campusId)
        : [
            ...current,
            { businessDate: day, campusId, startAt: task.slotStart, endAt: task.slotEnd }
          ]
    );
    setDirty(true);
    setUnavailable(false);
    setNotice('');
  }
  async function submit(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const body = {
      windows: unavailable
        ? []
        : windows.map(({ businessDate, campusId, startAt, endAt }) => ({
            businessDate,
            campusId,
            startAt,
            endAt
          })),
      unavailable,
      autoContinue,
      revision: submission?.revision ?? -1
    };
    const signature = JSON.stringify(body);
    if (command.current?.signature !== signature)
      command.current = { signature, id: crypto.randomUUID() };
    try {
      if (!task?.actions?.fill || (!unavailable && !windows.length)) {
        setError('请选择可参加日期或整周无法参加。');
        return false;
      }
      const result = await request(`/api/roster-tasks/${taskId}/submission`, {
        method: 'PUT',
        body: { ...body, requestId: command.current.id }
      });
      savedSelection.current = { windows: result.items, unavailable, autoContinue };
      setWindows(result.items);
      setSubmission(result.submission);
      setDirty(false);
      command.current = null;
      setNotice('整周可用时间已提交，截止前可以修改。');
      setPreferences((await request('/api/me/availability-preferences')).items);
      return true;
    } catch (failure) {
      setError(failure.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="weekly-availability">
      <div className="weekly-heading">
        <div>
          <h2>填报整周可用时间</h2>
          <p className="react-muted">按收集任务选择工作周，勾选可参加的日期与校区。</p>
        </div>
        {task && (
          <span className="weekly-state" data-dirty={dirty}>
            {dirty
              ? '有未提交修改'
              : submission
                ? '已提交'
                : task.actions?.fill
                  ? '待填报'
                  : '暂不可填报'}
          </span>
        )}
      </div>
      {preferences
        .filter((item) => item.enabled)
        .map((item) => (
          <div className="react-message" key={item.duty_type}>
            <span data-motion-value="text">
              {item.duty_type === 'office' ? '办公' : '维修'}可用时间自动延续已开启
            </span>
            <button
              disabled={busy}
              onClick={() =>
                request('/api/me/availability-preferences', {
                  method: 'PATCH',
                  body: { dutyType: item.duty_type, enabled: false }
                })
                  .then((result) => {
                    setPreferences(result.items);
                    if (task?.dutyType === item.duty_type) {
                      setAutoContinue(false);
                      savedSelection.current = { ...savedSelection.current, autoContinue: false };
                    }
                  })
                  .catch((failure) => setError(failure.message))
              }
            >
              关闭后续自动延续
            </button>
          </div>
        ))}
      {!tasks.length ? (
        <div className="empty-state">
          <strong>暂无开放任务</strong>
        </div>
      ) : (
        <form ref={navigationForm} onSubmit={submit}>
          <div className="weekly-scope">
            <CollectionScope
              tasks={tasks}
              taskId={taskId}
              onChange={setTaskId}
              disabled={busy || dirty}
            />
            {task && (
              <p className="weekly-deadline">
                <span>填报截止</span>
                <time data-motion-value="text" dateTime={task.deadline}>
                  {new Date(task.deadline).toLocaleString('zh-CN', {
                    timeZone: 'Asia/Shanghai',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                  })}
                </time>
              </p>
            )}
          </div>
          {task && (
            <>
              {task.collectionIssue && (
                <p data-motion-value="text" className="react-message" role="status">
                  {task.collectionIssue}
                </p>
              )}
              {!task.actions?.fill && (
                <p data-motion-value="text" className="react-message" role="status">
                  {task.collectionState === 'scheduled'
                    ? '本周填报尚未开放，请在开放时间后填写。'
                    : '当前周收集已结束，可查看原填报。开放下一周时仍从这个任务填写。'}
                </p>
              )}
              <div className="weekly-selection-heading">
                <div>
                  <h3>可参加日期与校区</h3>
                  <p data-motion-value="text" className="react-muted">
                    完整值班 · {task.slotStart}–{task.slotEnd}
                  </p>
                </div>
                <label className="roster-choice-row">
                  <input
                    type="checkbox"
                    checked={unavailable}
                    disabled={busy || !task.actions?.fill}
                    onChange={(event) => {
                      setUnavailable(event.target.checked);
                      setDirty(true);
                    }}
                  />
                  整周无法参加
                </label>
              </div>
              {!selectableSlots.length && (
                <p className="react-message">
                  本周没有可参加的服务日（暂停或范围已变化），可提交整周无法参加。
                </p>
              )}
              <fieldset
                className="weekly-days"
                aria-label="可参加日期与校区"
                disabled={busy || unavailable || !task.actions?.fill}
              >
                {Array.from({ length: 4 }, (_, i) => addDays(task.weekStart, i)).map(
                  (day, index) => (
                    <section data-motion-item="" className="weekly-day" key={day}>
                      <h3 data-motion-value="text">
                        <span>{['周一', '周二', '周三', '周四'][index]}</span>
                        <time dateTime={day}>{day.slice(5)}</time>
                      </h3>
                      {!selectableSlots.some((slot) => slot.businessDate === day) && (
                        <p className="react-muted">当天暂无可选班次</p>
                      )}
                      {task.campusScope.campusIds
                        .filter((campusId) =>
                          selectableSlots.some(
                            (slot) => slot.businessDate === day && slot.campusId === campusId
                          )
                        )
                        .map((campusId) => {
                          const window = windows.find(
                            (row) => row.businessDate === day && row.campusId === campusId
                          );
                          return (
                            <label
                              className={`weekly-campus ${window ? 'is-selected' : ''}`}
                              key={campusId}
                            >
                              <input
                                type="checkbox"
                                checked={!!window}
                                onChange={() => toggle(day, campusId)}
                              />
                              {campusNames[campusId]}校区
                            </label>
                          );
                        })}
                    </section>
                  )
                )}
              </fieldset>
              <div className="weekly-preferences">
                <label className="roster-choice-row">
                  <input
                    type="checkbox"
                    checked={autoContinue}
                    disabled={busy || !task.actions?.fill}
                    onChange={(event) => {
                      setAutoContinue(event.target.checked);
                      setDirty(true);
                    }}
                  />
                  后续同岗位收集自动延续本周选择
                </label>
                {autoContinue && (
                  <details className="workspace-help">
                    <summary>自动延续规则</summary>
                    <p>
                      按星期和校区带入后续完整班次，不覆盖已提交内容；资格和任务范围变化时仍会校验。
                    </p>
                  </details>
                )}
              </div>
              {submission && (
                <p data-motion-value="text" className="react-muted">
                  {submission.source === 'carried' ? '本周由自动延续提交' : '上次手动提交'}：
                  {new Date(submission.submittedAt).toLocaleString('zh-CN', {
                    timeZone: 'Asia/Shanghai'
                  })}
                </p>
              )}
              {error && (
                <p data-motion-value="text" role="alert" className="react-error">
                  {error}
                </p>
              )}
              {notice && (
                <p data-motion-value="text" role="status" className="react-message">
                  {notice}
                </p>
              )}
              <div className="weekly-submitbar">
                <div className="weekly-summary" aria-live="polite">
                  <strong data-motion-value="text">
                    {unavailable
                      ? '整周无法参加'
                      : windows.length
                        ? `已选 ${new Set(windows.map((row) => row.businessDate)).size} 天 · ${windows.length} 个班次`
                        : '尚未选择可参加日期'}
                  </strong>
                  <span>截止前可修改，提交后生效。</span>
                </div>
                <div className="field-actions">
                  {dirty && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setDirty(false);
                        setReload((value) => value + 1);
                      }}
                    >
                      放弃本次修改
                    </button>
                  )}
                  <button
                    className="field-primary"
                    disabled={
                      busy || !task.actions?.fill || !dirty || (!unavailable && !windows.length)
                    }
                  >
                    提交整周可用时间
                  </button>
                </div>
              </div>
            </>
          )}
        </form>
      )}
      {!task && dirty && (
        <p role="alert" className="react-error">
          本任务已结束或填报资格已变化。输入仍保留，可联系负责人重新开放收集。
          <button
            type="button"
            onClick={() => {
              setDirty(false);
              setTaskId(preferredRosterPeriod(tasks)?.id || '');
            }}
          >
            放弃本次未提交内容
          </button>
        </p>
      )}
      {!tasks.length && error && (
        <p data-motion-value="text" role="alert" className="react-error">
          {error}
        </p>
      )}
    </section>
  );
}
