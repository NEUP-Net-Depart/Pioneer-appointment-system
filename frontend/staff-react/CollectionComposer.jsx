import { useEffect, useRef, useState } from 'react';
import { request } from './request.js';
import { Modal } from './field/ui';
import { StaffIdentity } from './StaffIdentity';
import { addDays, dateKey, weekRange } from '../../shared/time.js';
import { WeekPicker } from './WeekPicker';
import { dutyEnd } from '../../shared/duty-window.js';
import { campuses, days, key, label } from './roster-workflow-shared.js';
export function CollectionComposer({ office, onClose, onCreated, onError }) {
  const next = addDays(weekRange(dateKey()).start, 7);
  const [form, setForm] = useState({
    weekStart: next,
    campusIds: [],
    departmentIds: [],
    slotStart: '19:00',
    slotEnd: '21:00',
    deadline: `${addDays(next, -1)}T18:00`,
    description: '',
    collectionName: '',
    recurrence: {
      enabled: false,
      publishWeekday: 4,
      publishTime: '18:00',
      deadlineWeekday: 7,
      deadlineTime: '18:00'
    }
  });
  const [options, setOptions] = useState([]),
    [people, setPeople] = useState([]),
    [selected, setSelected] = useState([]),
    [requirements, setRequirements] = useState({}),
    [uniform, setUniform] = useState(1);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [search, setSearch] = useState(''),
    [step, setStep] = useState(0);
  const lock = useRef(false),
    id = useRef(crypto.randomUUID());
  const change = (patch) => setForm((current) => ({ ...current, ...patch }));
  useEffect(() => {
    const controller = new AbortController();
    request(`/api/roster-tasks/options?dutyType=${office ? 'office' : 'repair'}`, {
      signal: controller.signal
    })
      .then((result) => {
        setOptions(result.items);
        const first = result.items[0];
        if (first)
          change({
            campusIds: [first.campusId],
            departmentIds: first.allDepartments ? [] : [first.departments[0]?.id].filter(Boolean)
          });
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, [office]);
  useEffect(() => {
    if (!form.campusIds.length) return;
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(
      () =>
        request('/api/roster-tasks/candidates', {
          method: 'POST',
          body: { ...form, dutyType: office ? 'office' : 'repair' },
          signal: controller.signal
        })
          .then((result) => {
            setPeople(result.items);
            setSelected(result.items.map((item) => item.memberId));
            setError('');
          })
          .catch((failure) => {
            if (!controller.signal.aborted) {
              setError(failure.message);
              setPeople([]);
            }
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          }),
      250
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [office, form.weekStart, JSON.stringify(form.campusIds), JSON.stringify(form.departmentIds)]);
  const chosen = options.filter((item) => form.campusIds.includes(item.campusId));
  const allDepartments = chosen.length > 0 && chosen.every((item) => item.allDepartments);
  const departments = (chosen[0]?.departments || []).filter((dept) =>
    chosen.every((item) => item.departments.some((row) => row.id === dept.id))
  );
  function chooseCampus(campusId) {
    const ids = form.campusIds.includes(campusId)
      ? form.campusIds.filter((id) => id !== campusId)
      : [...form.campusIds, campusId];
    const scope = options.filter((item) => ids.includes(item.campusId));
    const shared = (scope[0]?.departments || []).filter((item) =>
      scope.every((row) => row.departments.some((dept) => dept.id === item.id))
    );
    change({
      campusIds: ids,
      departmentIds: scope.every((item) => item.allDepartments)
        ? []
        : shared.slice(0, 1).map((item) => item.id)
    });
  }
  async function submit(event) {
    event.preventDefault();
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await request('/api/roster-tasks', {
        method: 'POST',
        body: {
          ...form,
          campusId: form.campusIds[0],
          dutyType: office ? 'office' : 'repair',
          workflowVersion: 1,
          deadline: new Date(form.deadline).toISOString(),
          memberIds: selected,
          requirements: form.campusIds.flatMap((campusId) =>
            days.map((_, index) => ({
              campusId,
              businessDate: addDays(form.weekStart, index),
              ordinaryMinimum: Number(requirements[`${campusId}:${index}`] ?? 1)
            }))
          ),
          requestId: id.current
        }
      });
      onCreated(result.id);
    } catch (failure) {
      setError(failure.message);
      onError?.(failure.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={office ? '发布办公收集任务' : '发布收集任务'}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form className="roster-compose" onSubmit={submit}>
        <ol className="roster-compose-steps" aria-label="收集发布步骤">
          {['范围与时间', '人数与名单', '确认发布'].map((text, index) => (
            <li data-motion-item="" key={text} aria-current={step === index ? 'step' : undefined}>
              <span data-motion-value="text">{index + 1}</span>
              {text}
            </li>
          ))}
        </ol>
        {step === 0 && (
          <section className="roster-compose-section">
            <h2>先确定收集范围与时间</h2>
            <WeekPicker
              label="周一日期"
              value={form.weekStart}
              onChange={(weekStart) =>
                change({ weekStart, deadline: `${addDays(weekStart, -1)}T18:00` })
              }
            />
            <fieldset disabled={busy}>
              <legend>参与校区</legend>
              <div className="roster-choice-row">
                {options.map((item) => (
                  <label key={item.campusId}>
                    <input
                      type="checkbox"
                      checked={form.campusIds.includes(item.campusId)}
                      onChange={() => chooseCampus(item.campusId)}
                    />
                    {item.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset disabled={busy}>
              <legend>参与部门</legend>
              <div className="roster-choice-row">
                {allDepartments && (
                  <button
                    type="button"
                    aria-pressed={!form.departmentIds.length}
                    onClick={() => change({ departmentIds: [] })}
                  >
                    全部部门
                  </button>
                )}
                {departments.map((item) => (
                  <button
                    type="button"
                    aria-pressed={form.departmentIds.includes(item.id)}
                    key={item.id}
                    onClick={() =>
                      change({
                        departmentIds: form.departmentIds.includes(item.id)
                          ? form.departmentIds.filter((id) => id !== item.id)
                          : [...form.departmentIds, item.id]
                      })
                    }
                  >
                    {item.name}
                  </button>
                ))}
              </div>
              {!allDepartments && !form.departmentIds.length && (
                <p className="react-error">请至少选择一个可管理的部门。</p>
              )}
            </fieldset>
            <div className="roster-time-fields">
              <label>
                开始时间
                <input
                  type="time"
                  required
                  value={form.slotStart}
                  onChange={(event) =>
                    change({ slotStart: event.target.value, slotEnd: dutyEnd(event.target.value) })
                  }
                />
              </label>
              <label>
                结束时间
                <output>{form.slotEnd || '请选择 22:00 之前的开始时间'} · 整次两小时</output>
              </label>
            </div>
            <label>
              填报截止
              <input
                type="datetime-local"
                required
                value={form.deadline}
                onChange={(event) => change({ deadline: event.target.value })}
              />
            </label>
            <fieldset>
              <legend>后续收集</legend>
              <label className="roster-choice-row">
                <input
                  type="checkbox"
                  checked={form.recurrence.enabled}
                  onChange={(event) =>
                    change({ recurrence: { ...form.recurrence, enabled: event.target.checked } })
                  }
                />
                结束后继续收集下一周
              </label>
              {form.recurrence.enabled && (
                <>
                  <label>
                    收集名称
                    <input
                      maxLength={80}
                      value={form.collectionName}
                      onChange={(event) => change({ collectionName: event.target.value })}
                      placeholder={office ? '办公可用时间收集' : '维修可用时间收集'}
                    />
                  </label>
                  <p className="react-muted">
                    发布一次即可。本次到期或提前结束后立即开放下一工作周；历史周可以同时重新开放补填。截止时间为值班前一周，北京时间。
                  </p>
                  {[['deadline', '填报截止']].map(([prefix, text]) => (
                    <div className="roster-time-fields" key={prefix}>
                      <label>
                        {text}星期
                        <select
                          aria-label={`${text}星期`}
                          value={form.recurrence[`${prefix}Weekday`]}
                          onChange={(event) =>
                            change({
                              recurrence: {
                                ...form.recurrence,
                                [`${prefix}Weekday`]: Number(event.target.value)
                              }
                            })
                          }
                        >
                          {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                            <option key={i} value={i}>
                              周{['一', '二', '三', '四', '五', '六', '日'][i - 1]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        {text}时间
                        <input
                          type="time"
                          required
                          value={form.recurrence[`${prefix}Time`]}
                          onChange={(event) =>
                            change({
                              recurrence: {
                                ...form.recurrence,
                                [`${prefix}Time`]: event.target.value
                              }
                            })
                          }
                        />
                      </label>
                    </div>
                  ))}
                </>
              )}
            </fieldset>
            <label>
              任务说明
              <textarea
                maxLength={500}
                value={form.description}
                onChange={(event) => change({ description: event.target.value })}
              />
            </label>
          </section>
        )}
        {step === 1 && (
          <section className="roster-compose-section">
            <h2>安排多少人，向谁收集</h2>
            {
              <fieldset className="roster-demand-matrix" disabled={busy}>
                <legend>{office ? '每日办公人员目标人数' : '每日普通维修人员最低需求'}</legend>
                <p data-motion-value="text" className="react-muted">
                  {office
                    ? '自动排班按目标人数安排，优先均衡周内次数，每人每天最多一班。'
                    : '每个校区每天另排 1 名负责人，普通人员允许超过最低人数。'}
                </p>
                <div className="roster-uniform">
                  <label>
                    统一人数
                    <input
                      type="number"
                      min="0"
                      max="300"
                      required
                      value={uniform}
                      onChange={(event) => setUniform(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setRequirements(
                        Object.fromEntries(
                          form.campusIds.flatMap((id) =>
                            days.map((_, i) => [`${id}:${i}`, Number(uniform)])
                          )
                        )
                      )
                    }
                  >
                    应用到所有工作日
                  </button>
                </div>
                {form.campusIds.map((campusId) => (
                  <div className="roster-campus-demand" key={campusId}>
                    <div>
                      <strong data-motion-value="text">{campuses[campusId]}</strong>
                      <button
                        type="button"
                        onClick={() =>
                          setRequirements((current) => ({
                            ...current,
                            ...Object.fromEntries(
                              days.map((_, i) => [
                                `${campusId}:${i}`,
                                current[`${campusId}:0`] ?? 1
                              ])
                            )
                          }))
                        }
                      >
                        周一复制到整周
                      </button>
                    </div>
                    <div>
                      {days.map((day, i) => (
                        <label key={day}>
                          {day}
                          <small data-motion-value="text">
                            {addDays(form.weekStart, i).slice(5)}
                          </small>
                          <input
                            aria-label={`${campuses[campusId]}${day}最低人数`}
                            required
                            type="number"
                            min="0"
                            max="300"
                            value={requirements[`${campusId}:${i}`] ?? 1}
                            onChange={(event) =>
                              setRequirements((current) => ({
                                ...current,
                                [`${campusId}:${i}`]: event.target.value
                              }))
                            }
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </fieldset>
            }
            <details className="roster-audience">
              <summary>参与名单 · {loading ? '正在读取' : `${selected.length} 人`}</summary>
              <p className="react-muted">
                排班资格按工作周判断，交流人员不参加维修收集。发布后保存本次名单。
              </p>
              <label>
                查找成员
                <input value={search} onChange={(event) => setSearch(event.target.value)} />
              </label>
              <button
                type="button"
                onClick={() => setSelected(people.map((item) => item.memberId))}
              >
                选择全部
              </button>
              <div>
                {people
                  .filter((item) => item.name.includes(search))
                  .map((item) => (
                    <label key={item.memberId}>
                      <input
                        type="checkbox"
                        checked={selected.includes(item.memberId)}
                        onChange={() =>
                          setSelected((current) =>
                            current.includes(item.memberId)
                              ? current.filter((id) => id !== item.memberId)
                              : [...current, item.memberId]
                          )
                        }
                      />
                      <span>
                        {item.name}
                        <StaffIdentity identities={item.identities} />
                      </span>
                    </label>
                  ))}
              </div>
            </details>
          </section>
        )}
        {step === 2 && (
          <section className="roster-compose-section">
            <h2>确认后向工作人员开放</h2>
            <dl className="roster-review-summary">
              <div>
                <dt>工作周</dt>
                <dd data-motion-value="text">
                  {form.weekStart} — {addDays(form.weekStart, 3)}
                </dd>
              </div>
              <div>
                <dt>参与范围</dt>
                <dd>
                  {form.campusIds.map((id) => campuses[id]).join('、')} · {selected.length} 人
                </dd>
              </div>
              <div>
                <dt>班次</dt>
                <dd data-motion-value="text">
                  {form.slotStart}–{form.slotEnd}
                </dd>
              </div>
              <div>
                <dt>首周截止</dt>
                <dd data-motion-value="text">{form.deadline.replace('T', ' ')}</dd>
              </div>
              <div>
                <dt>后续填写</dt>
                <dd data-motion-value="text">
                  {form.recurrence.enabled ? '本次结束后立即收集下一工作周' : '仅收集本次工作周'}
                </dd>
              </div>
            </dl>
            <div className="roster-review-needs">
              {form.campusIds.map((id) => (
                <div key={id}>
                  <strong data-motion-value="text">{campuses[id]}</strong>
                  <span>
                    {days
                      .map((day, i) => `${day} ${requirements[`${id}:${i}`] ?? 1} 人`)
                      .join(' · ')}
                  </span>
                </div>
              ))}
            </div>
            {!office && (
              <p className="react-muted">以上为普通人员最低需求；每校区每天另排一名维修负责人。</p>
            )}
            <div className="roster-review-edit">
              <button type="button" onClick={() => setStep(0)}>
                修改范围与时间
              </button>
              <button type="button" onClick={() => setStep(1)}>
                修改人数与名单
              </button>
            </div>
          </section>
        )}
        {error && (
          <p data-motion-value="text" role="alert" className="react-error">
            {error}
          </p>
        )}
        <div className="roster-modal-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => (step ? setStep(step - 1) : onClose())}
          >
            {step ? '上一步' : '取消'}
          </button>
          <button
            className="field-primary"
            disabled={
              busy ||
              loading ||
              !form.campusIds.length ||
              (!allDepartments && !form.departmentIds.length) ||
              !selected.length
            }
          >
            {busy
              ? '正在提交…'
              : step === 0
                ? '下一步：人数与名单'
                : step === 1
                  ? '下一步：确认发布'
                  : office
                    ? '发布办公收集'
                    : '发布收集任务'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
