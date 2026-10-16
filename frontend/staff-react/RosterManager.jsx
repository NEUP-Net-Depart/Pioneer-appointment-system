import React, { useContext, useEffect, useRef, useState } from 'react';
import { request } from './request.js';
import { ActivityContext, Modal } from './field/ui';
import { Roster } from './Roster.jsx';
import { addDays, dateKey, weekRange } from '../../shared/time.js';
import './roster.css';

const campusNames = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' };
const campusIds = { '南湖': 'campus-nanhu', '浑南': 'campus-hunnan' };
const slotKey = slot => `${slot.businessDate}:${slot.campusId}:${slot.startAt}:${slot.endAt}`;
const slotLabel = slot => `${slot.businessDate.slice(5).replace('-', '/')} · ${campusNames[slot.campusId] || slot.campusId} · ${slot.startAt}–${slot.endAt}`;
const issues = { SLOTS_REQUIRED: '没有服务班次', COVERAGE_MISSING: '尚未安排人员', LEAD_COVERAGE_MISSING: '缺少有资格的负责人', MEMBER_UNAVAILABLE: '成员可用时间或资格已变化', LEAD_INELIGIBLE: '负责人资格已变化', MEMBER_WEEK_DUPLICATE: '同一成员本周重复排班', LOCKED_ASSIGNMENT_CHANGED: '锁定安排已变化', DUTY_TYPE_MISMATCH: '岗位类型不一致' };

export function RosterArea({ user, section = 'mine' }) {
  const active = useContext(ActivityContext);
  const [visited, setVisited] = useState([section]);
  useEffect(() => { setVisited(current => current.includes(section) ? current : [...current, section]); }, [section]);
  const canManage = user?.grants?.some(grant => grant.permissionCode === 'roster.repair.manage');
  return <main className="field-main roster-area">{visited.includes('manage') && canManage && <ActivityContext.Provider value={active && section === 'manage'}><div hidden={section !== 'manage'} className="roster-section"><RosterManager user={user} /></div></ActivityContext.Provider>}{visited.includes('mine') && <ActivityContext.Provider value={active && section !== 'manage'}><div hidden={section === 'manage'} className="roster-section"><Roster user={user} /></div></ActivityContext.Provider>}</main>;
}

function RosterManager({ user }) {
  const routeActive = useContext(ActivityContext);
  const [tasks, setTasks] = useState([]), [taskId, setTaskId] = useState('');
  const [data, setData] = useState(null), [rows, setRows] = useState([]);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false), [confirming, setConfirming] = useState(false);
  const serial = useRef(0), commandLock = useRef(false);
  const campuses = (user?.authorizedCampuses || []).map(value => ({ id: campusIds[value] || value, name: value }));
  const nextWeek = addDays(weekRange(dateKey()).start, 7);
  const [form, setForm] = useState({ weekStart: nextWeek, campusId: campuses[0]?.id || '', slotStart: '19:00', slotEnd: '21:00', deadline: `${addDays(nextWeek, -1)}T18:00`, description: '' });
  const task = tasks.find(item => item.id === taskId);
  const draft = data?.draft;
  const editable = draft?.status === 'draft';

  async function loadTasks() {
    const result = await request('/api/roster-tasks');
    const available = (result.items || []).filter(item => item.campusScope?.campusIds?.length);
    setTasks(available);
    setTaskId(current => current || available[0]?.id || '');
  }
  async function load(id) {
    const sequence = ++serial.current;
    setLoading(true); setError('');
    try {
      const result = await request(`/api/roster-tasks/${encodeURIComponent(id)}/roster`);
      if (sequence !== serial.current) return;
      setData(result); setRows(result.draft?.assignments || []); setDirty(false);
    } catch (failure) { if (sequence === serial.current) setError(failure.message); }
    finally { if (sequence === serial.current) setLoading(false); }
  }
  useEffect(() => { loadTasks().catch(failure => setError(failure.message)); }, []);
  useEffect(() => {
    setData(null); setRows([]); setDirty(false);
    if (taskId) load(taskId);
    return () => { serial.current += 1; };
  }, [taskId]);
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = event => { event.preventDefault(); event.returnValue = ''; };
    const beforeNavigation = event => event.preventDefault();
    window.addEventListener('beforeunload', beforeUnload);
    if (routeActive) window.addEventListener('staff-before-navigation', beforeNavigation);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('staff-before-navigation', beforeNavigation); };
  }, [dirty, routeActive]);

  async function run(operation) {
    if (commandLock.current) return;
    commandLock.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); } catch (failure) { setError(failure.message); }
    finally { commandLock.current = false; setBusy(false); }
  }
  function generate() { return run(async () => {
    await request('/api/rosters/generate', { method: 'POST', body: { taskId, requestId: crypto.randomUUID() } });
    await load(taskId); setNotice('草稿已保存。请核对人员安排和覆盖提示。');
  }); }
  function save() { return run(async () => {
    await request(`/api/rosters/${encodeURIComponent(draft.id)}`, { method: 'PATCH', body: { version: draft.version, assignments: rows, requestId: crypto.randomUUID() } });
    await load(taskId); setNotice('调整已保存，已重新校验。');
  }); }
  function publish() { return run(async () => {
    await request(`/api/rosters/${encodeURIComponent(draft.id)}/publish`, { method: 'POST', body: { version: draft.version, requestId: crypto.randomUUID() } });
    setConfirming(false); await load(taskId); setNotice('班表已发布，成员可在“我的安排与申请”查看。');
  }); }
  function create(event) {
    event.preventDefault();
    return run(async () => {
      const result = await request('/api/roster-tasks', { method: 'POST', body: { ...form, deadline: new Date(form.deadline).toISOString(), requestId: crypto.randomUUID() } });
      await loadTasks(); setTaskId(result.id); setCreating(false); setNotice('收集任务已创建，成员现在可以填报时间。');
    });
  }
  function move(member, key) {
    const slot = member.available.find(item => slotKey(item) === key);
    setRows(current => [...current.filter(item => item.memberId !== member.memberId), ...(slot ? [{ memberId: member.memberId, ...slot, roleKind: member.leadSlots.some(item => slotKey(item) === key) ? 'repair_lead' : '' }] : [])]);
    setDirty(true); setNotice('');
  }
  const members = data?.members || [];
  const missingMembers = rows.filter(row => !members.some(member => member.memberId === row.memberId));
  const changes = [...new Set([...rows, ...(data?.publishedAssignments || [])].map(item => item.memberId))].filter(id => {
    const previous = data?.publishedAssignments?.find(item => item.memberId === id), current = rows.find(item => item.memberId === id);
    return (previous ? slotKey(previous) + previous.roleKind : '') !== (current ? slotKey(current) + current.roleKind : '');
  }).length;

  return <section className="react-page roster-planner">
    <header className="react-heading"><div><h1>维修排班</h1><p>收集时间 → 核对安排 → 发布给成员</p></div><button type="button" disabled={busy || dirty} onClick={() => setCreating(true)}>新建收集任务</button></header>
    {error && <p className="react-error" role="alert">{error}</p>}
    {notice && <p className="react-message" role="status">{notice}</p>}
    <div className="planner-toolbar"><label>排班周与校区<select disabled={busy || dirty} value={taskId} onChange={event => setTaskId(event.target.value)}><option value="">选择收集任务</option>{tasks.map(item => <option key={item.id} value={item.id}>{item.weekStart} · {item.campusScope.campusIds.map(id => campusNames[id] || id).join('、')} · {item.slotStart}–{item.slotEnd}</option>)}</select></label><button type="button" disabled={!taskId || busy || dirty || loading} onClick={() => load(taskId)}>刷新</button></div>
    {!taskId && <div className="react-card empty-state"><strong>先收集成员的可用时间</strong><span>创建任务后，成员在个人页面填报；生成的草稿会保存在服务端。</span></div>}
    {task && <p className="react-muted">填报截止：{new Date(task.deadline).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}{task.description ? ` · ${task.description}` : ''}</p>}
    {loading && <p role="status">正在读取最新安排…</p>}
    {data && <>
      <div className="planner-summary"><strong>{draft ? (editable ? '排班草稿' : '已发布班表') : '等待生成草稿'}</strong><span>已安排 {rows.length} / {members.length} 人</span>{dirty && <span>有未保存的调整</span>}</div>
      <div className="planner-days">{data.slots.map(slot => {
        const assigned = rows.filter(item => slotKey(item) === slotKey(slot));
        return <article className="react-card" key={slotKey(slot)}><h2>{slot.businessDate.slice(5).replace('-', '/')}</h2><p>{campusNames[slot.campusId] || slot.campusId} · {slot.startAt}–{slot.endAt}</p><strong>{assigned.length} 人</strong><p className={assigned.some(item => item.roleKind === 'repair_lead') ? 'react-muted' : 'planner-warning'}>{assigned.some(item => item.roleKind === 'repair_lead') ? '已安排负责人' : '待补负责人'}</p><ul>{assigned.map(item => <li key={item.memberId}>{members.find(member => member.memberId === item.memberId)?.name || '资格已变化的成员'}{item.roleKind === 'repair_lead' && <small>负责人</small>}</li>)}</ul></article>;
      })}</div>
      {draft && <section className="react-card planner-editor"><h2>成员安排</h2><p className="react-muted">只提供可参加的时段。锁定并保存的安排会在重新生成时保留。</p>{members.map(member => {
        const assigned = rows.find(item => item.memberId === member.memberId);
        return <div className="planner-member" key={member.memberId}><span><strong>{member.name}</strong><small>{assigned?.roleKind === 'repair_lead' ? '值班负责人' : member.available.length ? `${member.available.length} 个可选时段` : '暂无符合条件的时段'}</small></span><select aria-label={`安排${member.name}`} disabled={!editable || busy || assigned?.locked} value={assigned ? slotKey(assigned) : ''} onChange={event => move(member, event.target.value)}><option value="">待安排</option>{member.available.map(slot => <option key={slotKey(slot)} value={slotKey(slot)}>{slotLabel(slot)}</option>)}</select>{editable && assigned && <label className="planner-lock"><input type="checkbox" checked={!!assigned.locked} disabled={busy} onChange={event => { const locked = event.target.checked; setRows(current => current.map(item => item.memberId === member.memberId ? { ...item, locked } : item)); setDirty(true); }} />锁定安排</label>}</div>;
      })}{missingMembers.map(item => <div className="planner-member" key={item.memberId}><span>有成员的账号或资格已变化，请移除后补位。</span><button disabled={!editable || busy} onClick={() => { setRows(current => current.filter(row => row.memberId !== item.memberId)); setDirty(true); }}>移除失效安排</button></div>)}</section>}
      {!dirty && draft?.validation?.errors?.length > 0 && <section className="react-card planner-issues"><h2>发布前需要处理</h2><ul>{draft.validation.errors.map((item, index) => <li key={index}>{issues[item.code] || '安排需要核对'}{item.slot?.businessDate ? ` · ${item.slot.businessDate}` : ''}</li>)}</ul></section>}
      <div className="planner-actions"><p>{dirty ? '先保存调整，再确认发布。' : draft?.status === 'published' ? '成员正在使用此班表。新草稿发布后才会替换。' : '发布前会再次检查成员资格和班次覆盖。'}</p><div>
        <button type="button" disabled={busy || dirty || loading} onClick={generate}>{draft ? '重新生成草稿' : '生成草稿'}</button>
        {dirty && <button type="button" className="react-primary" disabled={busy} onClick={save}>保存并校验</button>}
        {editable && !dirty && <button type="button" className="react-primary" disabled={busy || loading || !draft.validation.valid} onClick={() => setConfirming(true)}>预览并发布</button>}
      </div></div>
    </>}
    {creating && <Modal title="收集下周可用时间" onClose={() => { if (!busy) setCreating(false); }}><form className="roster-create-form" onSubmit={create}><label>周一日期<input type="date" required value={form.weekStart} onChange={event => setForm({ ...form, weekStart: event.target.value })} /></label><label>校区<select required value={form.campusId} onChange={event => setForm({ ...form, campusId: event.target.value })}>{campuses.map(campus => <option key={campus.id} value={campus.id}>{campus.name}</option>)}</select></label><div className="react-inline"><label>开始<input type="time" required value={form.slotStart} onChange={event => setForm({ ...form, slotStart: event.target.value })} /></label><label>结束<input type="time" required value={form.slotEnd} onChange={event => setForm({ ...form, slotEnd: event.target.value })} /></label></div><label>填报截止<input type="datetime-local" required value={form.deadline} onChange={event => setForm({ ...form, deadline: event.target.value })} /></label><label>说明<input value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} /></label>{error && <p role="alert" className="react-error">{error}</p>}<button className="field-primary" disabled={busy}>创建收集任务</button></form></Modal>}
    {confirming && <Modal title="确认发布排班" onClose={() => { if (!busy) setConfirming(false); }}><p>{task?.weekStart} 起的班表，共安排 {rows.length} 人。</p><p>{changes} 位成员的安排与当前发布班表不同。确认后，成员端将显示这份班表。</p>{error && <p role="alert" className="react-error">{error}</p>}<div className="field-actions"><button disabled={busy} onClick={() => setConfirming(false)}>返回核对</button><button className="field-primary" disabled={busy} onClick={publish}>确认发布</button></div></Modal>}
  </section>;
}
