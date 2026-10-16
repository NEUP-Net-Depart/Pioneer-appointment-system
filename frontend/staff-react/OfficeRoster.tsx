import React, { useEffect, useRef, useState } from 'react';
import { request } from './request.js';
import { requestStatusLabel } from '../../shared/staff-request-status.js';
import { WorkspaceHeader } from './WorkspaceHeader';
import { Modal } from './field/ui';
import { addDays, dateKey, weekRange } from '../../shared/time.js';
import './roster.css';
import './office-roster.css';

type Slot = { businessDate: string; campusId: string; startAt: string; endAt: string; dutyType: string };
type Assignment = Slot & { memberId: string; roleKind?: string; leaveStatus?: string };
type Member = { memberId: string; name: string; available: Slot[]; departmentNames?: string[] };
type Task = { id: string; weekStart: string; campusScope: { campusIds: string[] }; slotStart: string; slotEnd: string; dutyType: string };
type State = { members: Member[]; slots: Slot[]; draft: null | { id: string; version: number; status: string; assignments: Assignment[]; validation: { valid: boolean; errors: { code: string; slot?: Slot }[] } }; publishedAssignments: Assignment[] };
const campusName = (id: string) => ({ 'campus-nanhu': '南湖校区', 'campus-hunnan': '浑南校区' }[id] || id);
const slotKey = (slot: Slot) => `${slot.businessDate}:${slot.campusId}:${slot.startAt}:${slot.endAt}`;
const rowKey = (row: Assignment) => `${row.memberId}:${slotKey(row)}:${row.roleKind || ''}`;
const dateLabel = (value: string) => `${value.slice(5).replace('-', '/')} 周${'日一二三四五六'[new Date(`${value}T12:00:00`).getDay()]}`;

export function OfficeRoster({ user }: { user: { authorizedCampuses?: string[] } }) {
  const [tasks, setTasks] = useState<Task[]>([]), [taskId, setTaskId] = useState('');
  const [data, setData] = useState<State | null>(null), [rows, setRows] = useState<Assignment[]>([]);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false), [dirty, setDirty] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false), [confirming, setConfirming] = useState(false);
  const [selectedDay, setSelectedDay] = useState(0), [choosing, setChoosing] = useState<Slot | null>(null), [query, setQuery] = useState('');
  const campuses = (user.authorizedCampuses || []).map(value => ({ id: ({ '南湖': 'campus-nanhu', '浑南': 'campus-hunnan' }[value] || value), name: value }));
  const [form, setForm] = useState({ weekStart: addDays(weekRange(dateKey()).start, 7), campusId: campuses[0]?.id || '', slotStart: '19:00', slotEnd: '21:00' });
  const serial = useRef(0), command = useRef(false);
  const draft = data?.draft, editable = draft?.status === 'draft';
  const currentTask = tasks.find(task => task.id === taskId);
  async function loadTasks(preferred?: string) {
    const result = await request('/api/roster-tasks');
    const available = (result.items || []).filter((task: Task) => task.dutyType === 'office');
    setTasks(available); setTaskId(current => preferred || current || available[0]?.id || '');
  }
  async function load(id: string) {
    const sequence = ++serial.current; setLoading(true); setError('');
    try {
      const result = await request(`/api/roster-tasks/${encodeURIComponent(id)}/roster`);
      if (sequence !== serial.current) return;
      setData(result); setRows(result.draft?.assignments || []); setDirty(false);
    } catch (failure) { if (sequence === serial.current) setError((failure as Error).message); }
    finally { if (sequence === serial.current) setLoading(false); }
  }
  useEffect(() => { loadTasks().catch(failure => setError(failure.message)); }, []);
  useEffect(() => { setData(null); setRows([]); setDirty(false); setSelectedDay(0); if (taskId) load(taskId); return () => { serial.current++; }; }, [taskId]);
  useEffect(() => {
    if (!dirty) return;
    const stop = (event: Event) => event.preventDefault();
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('staff-before-navigation', stop); window.addEventListener('beforeunload', unload);
    return () => { window.removeEventListener('staff-before-navigation', stop); window.removeEventListener('beforeunload', unload); };
  }, [dirty]);
  async function run(operation: () => Promise<void>) {
    if (command.current) return; command.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (failure) { setError((failure as Error).message); }
    finally { command.current = false; setBusy(false); }
  }
  function create(event: React.FormEvent) { event.preventDefault(); run(async () => {
    const task = await request('/api/roster-tasks', { method: 'POST', body: { ...form, dutyType: 'office', deadline: `${form.weekStart}T00:00:00+08:00`, requestId: crypto.randomUUID() } });
    await request('/api/rosters/generate', { method: 'POST', body: { taskId: task.id, requestId: crypto.randomUUID() } });
    await loadTasks(task.id); setCreating(false); setNotice('办公班表草稿已建立，按日期添加人员后发布。');
  }); }
  function save() { run(async () => {
    await request(`/api/rosters/${draft!.id}`, { method: 'PATCH', body: { version: draft!.version, assignments: rows, requestId: crypto.randomUUID() } });
    await load(taskId); setNotice('草稿已保存并校验。');
  }); }
  function publish() { run(async () => {
    await request(`/api/rosters/${draft!.id}/publish`, { method: 'POST', body: { version: draft!.version, requestId: crypto.randomUUID() } });
    setConfirming(false); await load(taskId); setNotice('办公班表已发布，成员可在个人中心查看。');
  }); }
  function edit() { run(async () => {
    await request('/api/rosters/generate', { method: 'POST', body: { taskId, requestId: crypto.randomUUID() } });
    await load(taskId); setNotice('已复制当前班表为草稿，发布前成员仍使用原班表。');
  }); }
  function change(next: Assignment[]) { setRows(next); setDirty(true); setNotice(''); }
  const names = new Map(data?.members.map(member => [member.memberId, member.name]));
  const prior = data?.publishedAssignments || [];
  const changes = [...prior.filter(row => !rows.some(item => rowKey(item) === rowKey(row))).map(row => ({ row, kind: '移除' })), ...rows.filter(row => !prior.some(item => rowKey(item) === rowKey(row))).map(row => ({ row, kind: '安排' }))];
  const candidates = choosing ? (data?.members || []).filter(member => member.name.includes(query.trim()) && member.available.some(slot => slotKey(slot) === slotKey(choosing)) && !rows.some(row => row.memberId === member.memberId && row.businessDate === choosing.businessDate)) : [];
  return <section className="react-page roster-planner office-planner">
    <WorkspaceHeader group="值班管理" title="办公排班管理" description="按工作日安排接待人员，核对覆盖后发布给成员。"><button disabled={busy || dirty} onClick={() => setCreating(true)}>新建办公班表</button></WorkspaceHeader>
    {error && <p role="alert" className="react-error">{error}</p>}{notice && <p role="status" className="react-message">{notice}</p>}
    <div className="planner-toolbar"><label>排班周与校区<select value={taskId} disabled={dirty || busy} onChange={event => setTaskId(event.target.value)}><option value="">选择办公班表</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.weekStart} · {task.campusScope.campusIds.map(campusName).join('、')} · {task.slotStart}–{task.slotEnd}</option>)}</select></label><button disabled={!taskId || dirty || busy || loading} onClick={() => load(taskId)}>刷新</button></div>
    {loading && <p role="status">正在读取班表…</p>}
    {!taskId && <div className="react-card empty-state"><strong>安排下一次办公值班</strong><span>选择校区和工作周，分别为周一至周四安排接待人员。每人每天一班。</span><button onClick={() => setCreating(true)}>建立办公班表</button></div>}
    {data && <>
      <div className="planner-summary"><strong>{editable ? '办公班表草稿' : draft ? '已发布班表' : '待建立草稿'}</strong><span>{new Set(rows.map(row => row.memberId)).size} 人 · {rows.length} 班</span>{dirty && <span>有未保存调整</span>}</div>
      <div className="office-day-tabs" aria-label="选择值班日期">{data.slots.map((slot, index) => <button key={slotKey(slot)} aria-pressed={selectedDay === index} onClick={() => setSelectedDay(index)}><span>{slot.businessDate.slice(5).replace("-", "/")}</span><small>周{"日一二三四五六"[new Date(slot.businessDate + "T12:00:00").getDay()]}</small></button>)}</div>
      <div className="planner-days office-days">{data.slots.map((slot, index) => {
        const assigned = rows.filter(row => slotKey(row) === slotKey(slot));
        const expected = assigned.filter(row => row.leaveStatus !== 'approved');
        return <section className="react-card office-day" data-selected={selectedDay === index} key={slotKey(slot)}><div className="office-day-heading"><h2>{dateLabel(slot.businessDate)}</h2><span>预计 {expected.length} 人</span></div><p>{campusName(slot.campusId)} · {slot.startAt}–{slot.endAt}</p>
          {!expected.length && <p className="planner-warning">{assigned.length ? '已排班人员均已请假，请安排补位' : '尚未安排接待人员'}</p>}
          <ul>{assigned.map(row => <li className="office-assignment" key={row.memberId}><div><strong>{names.get(row.memberId) || '成员资格已变化'}</strong>{row.roleKind === 'coordinator' && <small>当日协调人</small>}{row.leaveStatus && <small>请假 · {requestStatusLabel(row.leaveStatus)}</small>}</div>{editable && <div className="office-row-actions"><label><input type="checkbox" disabled={busy} checked={row.roleKind === 'coordinator'} onChange={event => change(rows.map(item => item === row ? { ...item, roleKind: event.target.checked ? 'coordinator' : '' } : item))} />协调人</label><button disabled={busy} aria-label={`移除${names.get(row.memberId) || '成员'} ${slot.businessDate}`} onClick={() => change(rows.filter(item => item !== row))}>移除</button></div>}</li>)}</ul>
          {editable && <button className="office-add" disabled={busy} onClick={() => { setQuery(''); setChoosing(slot); }}>添加办公人员</button>}
        </section>;
      })}</div>
      {!dirty && draft?.validation.errors.length! > 0 && <section className="react-card planner-issues"><h2>发布前需要处理</h2><ul>{draft?.validation.errors.map((issue, index) => <li key={index}>{issue.slot ? `${dateLabel(issue.slot.businessDate)}：` : ''}{({ COVERAGE_MISSING: '请安排接待人员', MEMBER_UNAVAILABLE: '成员资格或已有班次发生变化，请重新选择', MEMBER_DAY_DUPLICATE: '同一成员每天只能安排一班', DUTY_TYPE_MISMATCH: '岗位不匹配' }[issue.code] || '请核对人员安排')}</li>)}</ul></section>}
      <div className="planner-actions"><p>{dirty ? '保存调整后核对发布。' : '成员每个自然日一班，跨岗位时间冲突会阻止发布。'}</p><div>{(!draft || draft.status === 'published') && <button disabled={busy} onClick={edit}>{draft ? '调整已发布班表' : '建立草稿'}</button>}{dirty && <><button disabled={busy} onClick={() => { setRows(draft?.assignments || []); setDirty(false); }}>撤销本次调整</button><button className="react-primary" disabled={busy} onClick={save}>保存并校验</button></>}{editable && !dirty && <button className="react-primary" disabled={busy || !draft?.validation.valid} onClick={() => setConfirming(true)}>预览并发布</button>}</div></div>
    </>}
    {creating && <Modal title="新建办公班表" onClose={() => { if (!busy) setCreating(false); }}><form className="roster-create-form" onSubmit={create}><label>工作周（周一）<input type="date" required value={form.weekStart} onChange={event => setForm({ ...form, weekStart: event.target.value })} /></label><label>校区<select value={form.campusId} required onChange={event => setForm({ ...form, campusId: event.target.value })}>{campuses.map(campus => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select></label><div className="react-inline"><label>开始时间<input required type="time" value={form.slotStart} onChange={event => setForm({ ...form, slotStart: event.target.value })} /></label><label>结束时间<input required type="time" value={form.slotEnd} onChange={event => setForm({ ...form, slotEnd: event.target.value })} /></label></div><p className="react-muted">建立周一至周四的班表草稿，由你直接安排办公成员，无需填报。</p>{error && <p role="alert" className="react-error">{error}</p>}<button className="field-primary" disabled={busy}>建立草稿</button></form></Modal>}
    {choosing && <Modal title={`安排 ${dateLabel(choosing.businessDate)}`} onClose={() => setChoosing(null)}><p>{campusName(choosing.campusId)} · {choosing.startAt}–{choosing.endAt}</p><label className="office-member-search">查找办公成员<input value={query} onChange={event => setQuery(event.target.value)} placeholder="输入姓名" /></label><p className="react-muted">仅显示具有办公资格、校区权限且当天无冲突班次的成员。</p><div className="office-member-options">{candidates.map(member => <button key={member.memberId} onClick={() => { change([...rows, { ...choosing, memberId: member.memberId, roleKind: '' }]); setChoosing(null); }}><div><strong>{member.name}</strong><small>{member.departmentNames?.join("、") || "办公人员"}</small></div><span>添加到本日</span></button>)}{!candidates.length && <p>没有符合条件的成员。请检查办公资格、校区授权或已有班次。</p>}</div></Modal>}
    {confirming && <Modal title="发布办公排班" onClose={() => { if (!busy) setConfirming(false); }}><p>{currentTask?.weekStart} 起 · {currentTask?.campusScope.campusIds.map(campusName).join('、')}</p><p>安排 {new Set(rows.map(row => row.memberId)).size} 人、{rows.length} 班。发布后替换当前班表。</p><ul className="office-publish-diff">{changes.map(({ row, kind }, index) => <li key={index}><span>{kind}</span><strong>{names.get(row.memberId) || '成员'}</strong><span>{dateLabel(row.businessDate)}{row.roleKind === 'coordinator' ? ' · 协调人' : ''}</span></li>)}</ul>{error && <p role="alert" className="react-error">{error}</p>}<div className="field-actions"><button disabled={busy} onClick={() => setConfirming(false)}>返回核对</button><button className="field-primary" disabled={busy} onClick={publish}>发布办公排班</button></div></Modal>}
  </section>;
}
