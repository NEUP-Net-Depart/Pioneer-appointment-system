import React, { useEffect, useState } from 'react';
import { request } from './request.js';
import { WorkspaceHeader } from './WorkspaceHeader';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import './schedule.css';

const campusNames = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' };
const campusIds = { 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' };
const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const typeNames = { repair: '维修', office: '办公' };
function monday(value = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' })) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
function shiftText(row) {
  return `${row.businessDate} ${row.campusName || campusNames[row.campusId]} ${typeNames[row.dutyType]} ${row.startAt}–${row.endAt}`;
}
function timeText(row) {
  return `${days[row.weekday - 1]} ${campusNames[row.campusId]} ${row.startAt}–${row.endAt}`;
}

function AvailabilityEditor({ initial, campuses, onSave, onCancel, busy }) {
  const [windows, setWindows] = useState(initial);
  const save = (event) => {
    event.preventDefault();
    return onSave(windows);
  };
  const form = useUnsavedChanges({ dirty: true, busy, save, discard: onCancel });
  const update = (index, patch) =>
    setWindows(windows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <form
      ref={form}
      onSubmit={(event) => {
        save(event).catch(() => {});
      }}
      className="schedule-editor"
    >
      <fieldset disabled={busy}>
        {windows.map((row, index) => (
          <div className="schedule-window" key={index}>
            <label>
              星期
              <select
                value={row.weekday}
                onChange={(e) => update(index, { weekday: Number(e.target.value) })}
              >
                {days.map((day, i) => (
                  <option key={day} value={i + 1}>
                    {day}
                  </option>
                ))}
              </select>
            </label>
            <label>
              校区
              <select
                value={row.campusId}
                onChange={(e) => update(index, { campusId: e.target.value })}
              >
                {campuses.map((id) => (
                  <option key={id} value={id}>
                    {campusNames[id]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              开始
              <input
                type="time"
                required
                value={row.startAt}
                onChange={(e) => update(index, { startAt: e.target.value })}
              />
            </label>
            <label>
              结束
              <input
                type="time"
                required
                value={row.endAt}
                onChange={(e) => update(index, { endAt: e.target.value })}
              />
            </label>
            <button type="button" onClick={() => setWindows(windows.filter((_, i) => i !== index))}>
              移除
            </button>
          </div>
        ))}
        <p>保存空列表表示此范围内没有可用时间。</p>
        <div className="schedule-actions">
          <button
            type="button"
            onClick={() =>
              setWindows([
                ...windows,
                { weekday: 1, campusId: campuses[0], startAt: '19:00', endAt: '21:00' }
              ])
            }
          >
            添加时间
          </button>
          <button type="submit">保存可用时间</button>
          <button type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function WeekEditor({ data, onSave, onCancel, busy }) {
  const [items, setItems] = useState(data.assignments);
  const save = (event) => {
    event.preventDefault();
    return onSave(items);
  };
  const form = useUnsavedChanges({ dirty: true, busy, save, discard: onCancel });
  const update = (index, patch) =>
    setItems(items.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  return (
    <form
      ref={form}
      onSubmit={(event) => {
        save(event).catch(() => {});
      }}
      className="schedule-editor"
    >
      <fieldset disabled={busy}>
        <p>保存后立即发布。可按线下协调结果调整人员或时间；移除、替换的原班次保留在历史中。</p>
        {items.map((row, index) => (
          <div key={row.id} className="schedule-window">
            <label>
              成员
              <select
                required
                value={row.memberId}
                onChange={(e) => update(index, { memberId: e.target.value })}
              >
                <option value="">请选择</option>
                {data.people.map((person) => (
                  <option key={person.memberId} value={person.memberId}>
                    {person.name} · {person.studentId}
                  </option>
                ))}
              </select>
            </label>
            <label>
              日期
              <input
                type="date"
                required
                value={row.businessDate}
                onChange={(e) => update(index, { businessDate: e.target.value })}
              />
            </label>
            <label>
              开始
              <input
                type="time"
                required
                value={row.startAt}
                onChange={(e) => update(index, { startAt: e.target.value })}
              />
            </label>
            <label>
              结束
              <input
                type="time"
                required
                value={row.endAt}
                onChange={(e) => update(index, { endAt: e.target.value })}
              />
            </label>
            <button type="button" onClick={() => setItems(items.filter((_, i) => i !== index))}>
              移除
            </button>
          </div>
        ))}
        <div className="schedule-actions">
          <button
            type="button"
            onClick={() =>
              setItems([
                ...items,
                {
                  id: crypto.randomUUID(),
                  memberId: '',
                  businessDate: data.weekStart,
                  startAt: '19:00',
                  endAt: '21:00'
                }
              ])
            }
          >
            添加班次
          </button>
          <button type="submit">发布班表</button>
          <button type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function AssignmentAction({ item, kind, onSave, onCancel, busy }) {
  const [reason, setReason] = useState(''),
    [toMemberId, setRecipient] = useState('');
  const [people, setPeople] = useState([]),
    [error, setError] = useState('');
  useEffect(() => {
    if (kind !== 'cover') return;
    const controller = new AbortController();
    request(`/api/rosters/assignments/${item.id}/cover-candidates`, { signal: controller.signal })
      .then((data) => setPeople(data.items))
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [item.id, kind]);
  const save = (event) => {
    event.preventDefault();
    return onSave(kind === 'leave' ? { reason } : { note: reason, toMemberId });
  };
  const form = useUnsavedChanges({ dirty: true, busy, save, discard: onCancel });
  return (
    <form
      ref={form}
      onSubmit={(event) => {
        save(event).catch(() => {});
      }}
    >
      <fieldset disabled={busy}>
        {error && <p role="alert">{error}</p>}
        {kind === 'cover' && (
          <label>
            接替成员
            <select required value={toMemberId} onChange={(e) => setRecipient(e.target.value)}>
              <option value="">请选择</option>
              {people.map((person) => (
                <option key={person.memberId} value={person.memberId}>
                  {person.name} · {person.studentId}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          {kind === 'leave' ? '请假原因' : '给接替者的说明（可选）'}
          <input
            required={kind === 'leave'}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="schedule-actions">
          <button type="submit">{kind === 'leave' ? '登记请假' : '发送接替邀请'}</button>
          <button type="button" onClick={onCancel}>
            取消
          </button>
        </div>
      </fieldset>
    </form>
  );
}

function HistoryContent({ item, people }) {
  const name = (id) => people.find((person) => person.memberId === id)?.name || '历史成员';
  const rows = (value) =>
    value?.assignments ||
    value?.changes ||
    (value?.businessDate
      ? [value]
      : value?.business_date
        ? [
            {
              memberId: value.member_id,
              businessDate: value.business_date,
              campusId: value.campus_id,
              dutyType: value.duty_type,
              startAt: value.start_at,
              endAt: value.end_at
            }
          ]
        : []);
  return (
    <div>
      {[
        ['变更前', item.before],
        ['变更后', item.after]
      ].map(([label, value]) => (
        <div key={label}>
          <strong>{label}</strong>
          {rows(value).map((row, index) => (
            <p key={index}>
              {name(row.memberId)} · {shiftText(row)}
              {row.leaveStatus === 'recorded' ? ' · 已请假' : ''}
            </p>
          ))}
          {value?.reason && <p>{value.reason}</p>}
          {value?.note && <p>{value.note}</p>}
          {value?.toMemberId && <p>邀请 {name(value.toMemberId)} 接替</p>}
          {value?.status && (
            <p>
              {
                { pending: '待确认', accepted: '已接替', declined: '已拒绝', cancelled: '已撤回' }[
                  value.status
                ]
              }
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function Schedule({ user }) {
  const campuses = (user.authorizedCampuses || []).map((value) => campusIds[value] || value);
  const [weekStart, setWeek] = useState(monday()),
    [campusId, setCampus] = useState(campuses[0] || ''),
    [dutyType, setType] = useState('repair');
  const [data, setData] = useState(null),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0),
    [editing, setEditing] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError('');
    const query = new URLSearchParams({ weekStart, campusId, dutyType });
    Promise.all([
      request(`/api/me/availability?${query}`, { signal: controller.signal }),
      request(`/api/me/roster?${query}`, { signal: controller.signal }),
      request(`/api/rosters/week?${query}`, { signal: controller.signal }),
      request('/api/rosters/covers', { signal: controller.signal })
    ])
      .then(([availability, mine, week, covers]) =>
        setData({ availability, mine: mine.items, week, covers: covers.items })
      )
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [weekStart, campusId, dutyType, refresh]);
  async function mutate(path, body, method = 'POST') {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request(path, { method, body: { ...body, requestId: crypto.randomUUID() } });
      setEditing(null);
      setMessage('已保存');
      setRefresh((value) => value + 1);
    } catch (error) {
      setError(error.message);
      throw error;
    } finally {
      setBusy(false);
    }
  }
  // Event handlers report errors in the page; navigation saves propagate them to the guard.
  const action = (path, body, method) => mutate(path, body, method).catch(() => {});
  const cancel = () => setEditing(null);
  return (
    <section className="react-page schedule-page">
      <WorkspaceHeader group="排班考勤" title="排班与可用时间" />
      <div className="schedule-filters">
        <label>
          所在周
          <input
            type="date"
            disabled={!!editing || busy}
            value={weekStart}
            onChange={(e) => {
              if (e.target.value) setWeek(monday(e.target.value));
            }}
          />
        </label>
        <label>
          校区
          <select
            disabled={!!editing || busy}
            value={campusId}
            onChange={(e) => setCampus(e.target.value)}
          >
            {campuses.map((id) => (
              <option key={id} value={id}>
                {campusNames[id]}
              </option>
            ))}
          </select>
        </label>
        <label>
          班次类型
          <select
            disabled={!!editing || busy}
            value={dutyType}
            onChange={(e) => setType(e.target.value)}
          >
            <option value="repair">维修</option>
            <option value="office">办公</option>
          </select>
        </label>
        <button disabled={busy || !!editing} onClick={() => setRefresh((value) => value + 1)}>
          刷新
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!data ? (
        <p>{error ? '加载失败，可点击刷新重试。' : '正在读取班表…'}</p>
      ) : (
        <>
          <section className="schedule-card">
            <h2>我的可用时间 · {typeNames[dutyType]}</h2>
            <p>通常时间持续沿用。临时变化仅修改所选周，无需每周重新确认。</p>
            <h3>通常可用时间</h3>
            <p>{data.availability.usual.windows.map(timeText).join('；') || '尚未设置可用时间'}</p>
            <h3>本周安排</h3>
            <p>
              {data.availability.source === 'exception'
                ? '本周有单独修改'
                : '沿用通常时间（未作本周确认）'}
              ：{data.availability.effectiveWindows.map(timeText).join('；') || '没有可用时间'}
            </p>
            {['usual', 'exception'].includes(editing) ? (
              <AvailabilityEditor
                key={editing}
                initial={
                  editing === 'usual'
                    ? data.availability.usual.windows
                    : data.availability.effectiveWindows
                }
                campuses={campuses}
                busy={busy}
                onCancel={cancel}
                onSave={(windows) =>
                  mutate(
                    '/api/me/availability',
                    {
                      dutyType,
                      weekStart: editing === 'usual' ? '' : weekStart,
                      revision:
                        editing === 'usual'
                          ? data.availability.usual.revision
                          : (data.availability.exception?.revision ?? -1),
                      windows
                    },
                    'PUT'
                  )
                }
              />
            ) : (
              <div className="schedule-actions">
                <button disabled={busy || !!editing} onClick={() => setEditing('usual')}>
                  修改通常时间
                </button>
                <button disabled={busy || !!editing} onClick={() => setEditing('exception')}>
                  只修改本周
                </button>
                {data.availability.source === 'exception' && (
                  <button
                    disabled={busy || !!editing}
                    onClick={() =>
                      action(
                        '/api/me/availability',
                        {
                          dutyType,
                          weekStart,
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
            )}
          </section>
          <section className="schedule-card">
            <h2>我的本周班次</h2>
            <p>请假直接登记，接替由对方确认。签到单独记录实际到岗。</p>
            {!data.mine.length && <p>本周暂无班次。</p>}
            {data.mine.map((item) => (
              <article key={item.id}>
                <strong>{shiftText(item)}</strong>
                <p>{item.leaveStatus === 'recorded' ? '已请假' : '未登记请假'}</p>
                {editing?.id === item.id ? (
                  <AssignmentAction
                    key={`${item.id}-${editing.kind}`}
                    item={item}
                    kind={editing.kind}
                    busy={busy}
                    onCancel={cancel}
                    onSave={(body) =>
                      mutate(`/api/rosters/assignments/${item.id}/${editing.kind}`, {
                        ...body,
                        revision: item.revision
                      })
                    }
                  />
                ) : (
                  <div className="schedule-actions">
                    {item.leaveStatus === 'recorded' ? (
                      <button
                        disabled={busy || !!editing}
                        onClick={() =>
                          action(`/api/rosters/assignments/${item.id}/leave-withdraw`, {
                            revision: item.revision
                          })
                        }
                      >
                        撤销请假
                      </button>
                    ) : (
                      <button
                        disabled={busy || !!editing}
                        onClick={() => setEditing({ id: item.id, kind: 'leave' })}
                      >
                        登记请假
                      </button>
                    )}
                    <button
                      disabled={busy || !!editing}
                      onClick={() => setEditing({ id: item.id, kind: 'cover' })}
                    >
                      邀请接替
                    </button>
                  </div>
                )}
              </article>
            ))}
          </section>
          <section className="schedule-card">
            <h2>接替邀请</h2>
            {!data.covers.length && <p>暂无邀请。</p>}
            {data.covers.map((item) => (
              <article key={item.id}>
                <strong>
                  {item.fromName} → {item.toName}
                </strong>
                <p>{shiftText(item.assignment)}</p>
                {item.exchangeAssignment && <p>互换班次：{shiftText(item.exchangeAssignment)}</p>}
                <p>
                  {item.note} ·{' '}
                  {
                    {
                      pending: '待对方确认',
                      accepted: '已接替',
                      declined: '已拒绝',
                      cancelled: '已撤回或班次已调整'
                    }[item.status]
                  }
                </p>
                <div className="schedule-actions">
                  {(item.canRespond
                    ? ['accepted', 'declined']
                    : item.canCancel
                      ? ['cancelled']
                      : []
                  ).map((decision) => (
                    <button
                      key={decision}
                      disabled={busy || !!editing}
                      onClick={() =>
                        action(`/api/rosters/covers/${item.id}/response`, {
                          revision: item.revision,
                          decision
                        })
                      }
                    >
                      {{ accepted: '确认接替', declined: '拒绝', cancelled: '撤回邀请' }[decision]}
                    </button>
                  ))}
                </div>
              </article>
            ))}
          </section>
          {data.week.canManage && (
            <section className="schedule-card">
              <h2>
                {campusNames[campusId]} · {typeNames[dutyType]}班表
              </h2>
              <p>
                {data.week.publishedAt
                  ? `最近发布：${new Date(data.week.publishedAt).toLocaleString('zh-CN')}`
                  : '本周尚未发布'}
              </p>
              <details>
                <summary>成员可用时间</summary>
                {data.week.people.map((person) => (
                  <p key={person.memberId}>
                    <strong>{person.name}</strong> ·{' '}
                    {
                      { usual: '沿用通常时间', exception: '本周已修改', unset: '尚未设置' }[
                        person.availabilitySource
                      ]
                    }
                    ：
                    {person.windows
                      .filter((row) => row.campusId === campusId)
                      .map(timeText)
                      .join('；') || '无可用时间'}
                  </p>
                ))}
              </details>
              {editing === 'manager' ? (
                <WeekEditor
                  data={data.week}
                  busy={busy}
                  onCancel={cancel}
                  onSave={(assignments) =>
                    mutate(
                      '/api/rosters/week',
                      { weekStart, campusId, dutyType, revision: data.week.revision, assignments },
                      'PUT'
                    )
                  }
                />
              ) : (
                <>
                  <ul>
                    {data.week.assignments.map((item) => (
                      <li key={item.id}>
                        {item.memberName} · {shiftText(item)}
                        {item.leaveStatus === 'recorded' ? ' · 已请假' : ''}
                      </li>
                    ))}
                  </ul>
                  <button disabled={busy || !!editing} onClick={() => setEditing('manager')}>
                    {data.week.publishedAt ? '调整班表' : '编排并发布'}
                  </button>
                </>
              )}
              <details>
                <summary>修改记录</summary>
                {data.week.history.map((item, index) => (
                  <div key={index} className="schedule-history">
                    <p>
                      {new Date(item.occurredAt).toLocaleString('zh-CN')} ·{' '}
                      {item.actorAccount || '迁移'} ·{' '}
                      {{
                        'rosters.week.published': '发布或调整班表',
                        'rosters.leave.recorded': '登记请假',
                        'rosters.leave.withdrawn': '撤销请假',
                        'rosters.cover.requested': '发起接替',
                        'rosters.cover.responded': '处理接替邀请',
                        'rosters.model.migrated': '迁移保留的班次'
                      }[item.action] || item.action}
                    </p>
                    <details>
                      <summary>查看变更内容</summary>
                      <HistoryContent item={item} people={data.week.people} />
                    </details>
                  </div>
                ))}
              </details>
            </section>
          )}
        </>
      )}
    </section>
  );
}
