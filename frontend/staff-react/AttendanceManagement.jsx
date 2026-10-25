import { DataValue } from './DataValue';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { WeeklyAttendanceExport } from './WeeklyAttendanceExport';
import { ActivityContext, Modal, time } from './field/ui';
import { WorkspaceHeader } from './WorkspaceHeader';
import { StaffIdentity } from './StaffIdentity';
import { request } from './request.js';
import { apiFetch } from '../../shared/api.js';
import { dateKey } from '../../shared/time.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';

const campusNames = { 'campus-nanhu': '南湖校区', 'campus-hunnan': '浑南校区' };
const campusIds = { 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' };
const localTime = (value) =>
  new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16);

export function AttendanceManagement({ user }) {
  const active = useContext(ActivityContext),
    lock = useRef(false);
  const campuses = (user.authorizedCampuses || []).map((value) => ({
    id: campusIds[value] || value,
    name: campusNames[campusIds[value] || value] || value
  }));
  const [filters, setFilters] = useState({
    month: dateKey().slice(0, 7),
    campusId: campuses[0]?.id || ''
  });
  const [items, setItems] = useState([]),
    [cursor, setCursor] = useState(''),
    [refresh, setRefresh] = useState(0),
    [next, setNext] = useState(null);
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [form, setForm] = useState(null),
    [options, setOptions] = useState({ events: [], members: [] }),
    [query, setQuery] = useState(''),
    [finding, setFinding] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [discarding, setDiscarding] = useState(false),
    [exportOpen, setExportOpen] = useState(false);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const params = new URLSearchParams({
      ...filters,
      all: '1',
      type: 'duty',
      ...(cursor ? { cursor } : {})
    });
    request(`/api/attendance?${params}`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setItems((previous) =>
          cursor
            ? [...new Map([...previous, ...result.items].map((item) => [item.id, item])).values()]
            : result.items
        );
        setNext(result.nextCursor);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [active, filters, cursor, refresh]);
  useEffect(() => {
    if (!active || !form) return;
    const controller = new AbortController();
    setFinding(true);
    const timer = setTimeout(
      () =>
        request(
          `/api/attendance/options?${new URLSearchParams({ businessDate: form.businessDate, campusId: form.campusId, q: query })}`,
          { signal: controller.signal }
        )
          .then((result) => {
            if (!controller.signal.aborted) setOptions(result);
          })
          .catch((failure) => {
            if (!controller.signal.aborted) setError(failure.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setFinding(false);
          }),
      250
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, form?.businessDate, form?.campusId, query, !!form]);
  const navigationForm = useUnsavedChanges({
    dirty,
    active,
    busy,
    save,
    discard: () => {
      setForm(null);
      setDirty(false);
      setDiscarding(false);
    }
  });
  function changeFilters(value) {
    setCursor('');
    setFilters((current) => ({ ...current, ...value }));
  }
  function edit(item) {
    setError('');
    setQuery('');
    setOptions({ events: [], members: [] });
    setDirty(false);
    setDiscarding(false);
    setForm(
      item
        ? {
            recordId: item.id,
            revision: item.revision,
            memberId: item.memberId,
            memberName: item.identitySnapshot?.name || '工作人员',
            eventId: item.eventId,
            campusId: item.campusId,
            businessDate: item.businessDate,
            occurredAt: localTime(item.occurredAt),
            reason: '',
            requestId: crypto.randomUUID()
          }
        : {
            memberId: '',
            memberName: '',
            eventId: '',
            campusId: filters.campusId,
            businessDate: dateKey(),
            occurredAt: `${dateKey()}T19:00`,
            reason: '',
            requestId: crypto.randomUUID()
          }
    );
  }
  function update(value) {
    setDirty(true);
    setForm((current) => ({ ...current, ...value, requestId: crypto.randomUUID() }));
  }
  async function save(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await request('/api/attendance/corrections', {
        method: 'POST',
        body: { ...form, occurredAt: new Date(`${form.occurredAt}:00+08:00`).toISOString() }
      });
      setForm(null);
      setDirty(false);
      setCursor('');
      setRefresh((value) => value + 1);
      setNotice('考勤已保存，历史身份和归属保留；不会改变今天的在岗状态。');
      return true;
    } catch (failure) {
      setError(failure.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function download() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await apiFetch(`/api/attendance/export.csv?${new URLSearchParams(filters)}`);
      if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || '导出失败');
      }
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement('a');
      link.href = url;
      link.download = `考勤-${filters.month}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(failure.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="react-page attendance-management">
      <WorkspaceHeader group="值班管理" title="考勤核查">
        <button disabled={busy} onClick={() => edit(null)}>
          补录签到
        </button>
      </WorkspaceHeader>
      {error && !form && (
        <p data-motion-value="text" className="react-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p data-motion-value="text" className="react-message" role="status">
          {notice}
        </p>
      )}
      <div className="planner-toolbar">
        <label>
          考勤月份
          <input
            aria-label="考勤月份"
            type="month"
            required
            value={filters.month}
            onChange={(event) => {
              if (event.target.value) changeFilters({ month: event.target.value });
            }}
          />
        </label>
        <label>
          校区
          <select
            aria-label="考勤校区"
            value={filters.campusId}
            onChange={(event) => changeFilters({ campusId: event.target.value })}
          >
            {campuses.map((campus) => (
              <option key={campus.id} value={campus.id}>
                {campus.name}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={loading}
          onClick={() => {
            setCursor('');
            setRefresh((value) => value + 1);
          }}
        >
          刷新
        </button>
        {user.permissions?.['attendance.export'] && (
          <>
            <button disabled={busy} onClick={() => setExportOpen(true)}>
              按周核算导出
            </button>
            <button disabled={busy} onClick={download}>
              按月导出
            </button>
          </>
        )}
      </div>
      <section className="react-card" aria-busy={loading}>
        <div className="field-section-heading">
          <h2>到岗记录</h2>
          <span data-motion-value="number" className="react-muted">
            {loading ? '正在更新…' : `已显示 ${items.length} 条`}
          </span>
        </div>
        {!items.length && loading && !error && <DataValue label="考勤记录" />}
        {!items.length && !loading && !error && (
          <p className="react-muted">当前范围内没有可查看的签到记录。</p>
        )}
        <ul className="attendance-history-list">
          {items.map((item) => (
            <li data-motion-item="" key={item.id}>
              <div>
                <strong data-motion-value="text">
                  {item.identitySnapshot?.name || '工作人员'}
                </strong>
                <StaffIdentity identities={item.identitySnapshot?.identities} />
                <span data-motion-value="text">
                  {item.primaryDepartmentNameSnapshot || '历史部门未记录'} ·{' '}
                  {item.nonScheduled ? '非排班到岗' : '排班到岗'}
                  {item.servicePaused ? ' · 暂停日记录，不计有效考勤' : ''}
                </span>
              </div>
              <div>
                <strong data-motion-value="text">
                  {item.businessDate} · {time(item.occurredAt)}
                </strong>
                <span data-motion-value="text">{campusNames[item.campusId] || '指定校区'}</span>
                <button disabled={busy} onClick={() => edit(item)}>
                  修正时间
                </button>
              </div>
            </li>
          ))}
        </ul>
        {next && (
          <div className="field-actions">
            <button disabled={loading} onClick={() => setCursor(next)}>
              加载更多
            </button>
          </div>
        )}
      </section>
      {exportOpen && (
        <WeeklyAttendanceExport campuses={campuses} onClose={() => setExportOpen(false)} />
      )}
      {form && (
        <Modal
          title={form.recordId ? '修正签到时间' : '补录工作人员签到'}
          onClose={() => {
            if (busy) return;
            if (dirty) setDiscarding(true);
            else setForm(null);
          }}
        >
          <form ref={navigationForm} className="roster-create-form" onSubmit={save}>
            {discarding && (
              <div className="react-error" role="alert">
                <p>修改尚未保存，是否放弃？</p>
                <div className="field-actions">
                  <button type="button" onClick={() => setDiscarding(false)}>
                    继续填写
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setForm(null);
                      setDirty(false);
                      setDiscarding(false);
                    }}
                  >
                    放弃修改
                  </button>
                </div>
              </div>
            )}
            <p className="react-muted">
              这是历史考勤记录操作。需要加入今天工作时，请使用现场工作人员签到码。
            </p>
            {error && (
              <p data-motion-value="text" className="react-error" role="alert">
                {error}
              </p>
            )}
            <div className="react-inline">
              <label>
                签到日期
                <input
                  type="date"
                  required
                  disabled={!!form.recordId || busy}
                  value={form.businessDate}
                  onChange={(event) =>
                    update({
                      businessDate: event.target.value,
                      eventId: '',
                      memberId: '',
                      memberName: ''
                    })
                  }
                />
              </label>
              <label>
                签到校区
                <select
                  aria-label="补录校区"
                  disabled={!!form.recordId || busy}
                  value={form.campusId}
                  onChange={(event) =>
                    update({
                      campusId: event.target.value,
                      eventId: '',
                      memberId: '',
                      memberName: ''
                    })
                  }
                >
                  {campuses.map((campus) => (
                    <option key={campus.id} value={campus.id}>
                      {campus.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {!form.recordId && (
              <>
                <label>
                  签到场次
                  <select
                    aria-label="签到场次"
                    required
                    value={form.eventId}
                    disabled={finding || busy}
                    onChange={(event) => {
                      const found = options.events.find((item) => item.id === event.target.value);
                      update({
                        eventId: event.target.value,
                        ...(found ? { occurredAt: localTime(found.startsAt) } : {})
                      });
                    }}
                  >
                    <option value="">{finding ? '正在读取场次…' : '选择当天签到场次'}</option>
                    {options.events
                      .filter((item) => item.type === 'duty')
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {time(item.startsAt)}–{time(item.endsAt)} · 值班签到
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  查找工作人员
                  <input
                    value={query}
                    disabled={busy}
                    placeholder="输入姓名或学号"
                    onChange={(event) => {
                      setQuery(event.target.value);
                      update({ memberId: '', memberName: '' });
                    }}
                  />
                </label>
                {!!query && (
                  <div className="attendance-member-options" aria-busy={finding}>
                    {options.members.map((member) => (
                      <button
                        type="button"
                        key={member.memberId}
                        aria-pressed={form.memberId === member.memberId}
                        disabled={busy || finding}
                        onClick={() =>
                          update({ memberId: member.memberId, memberName: member.name })
                        }
                      >
                        <strong data-motion-value="text">{member.name}</strong>
                        <StaffIdentity identities={member.identities} />
                        <small data-motion-value="text">
                          {member.departmentName} · {member.studentId}
                        </small>
                      </button>
                    ))}
                    {!finding && !options.members.length && (
                      <p>当前范围没有匹配成员，请调整姓名或学号。</p>
                    )}
                  </div>
                )}
              </>
            )}
            {form.memberId && (
              <p data-motion-value="text" className="react-message">
                已选择：{form.memberName}
              </p>
            )}
            <label>
              实际签到时间
              <input
                type="datetime-local"
                required
                disabled={busy}
                value={form.occurredAt}
                onChange={(event) => update({ occurredAt: event.target.value })}
              />
            </label>
            <label>
              修正原因
              <textarea
                aria-label="修正原因"
                required
                maxLength={500}
                value={form.reason}
                disabled={busy}
                onChange={(event) => update({ reason: event.target.value })}
              />
            </label>
            <div className="field-actions">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setForm(null);
                  setDirty(false);
                }}
              >
                放弃并关闭
              </button>
              <button className="field-primary" disabled={busy || !form.memberId || !form.eventId}>
                {busy ? '正在保存…' : '确认保存考勤'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
