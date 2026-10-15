import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initStaffApplication } from '../staff/main.js';
import { request } from './request.js';
import { Members } from './Members.jsx';
import { Permissions } from './Permissions.jsx';
import { statusLabels } from '../../shared/constants.js';
import { Roster } from './Roster.jsx';
import { FieldApp } from './field/FieldApp';

const roles = { technician: '维修人员', admin: '管理员', superadmin: '最高权限者' };
function Workbench({ user, onNavigate }) {
  const [data, setData] = useState(null); const [appointments, setAppointments] = useState([]); const [error, setError] = useState(''); const [code, setCode] = useState(''); const [scan, setScan] = useState(null);
  async function refresh() { try { const [work, list] = await Promise.all([request('/api/workbench'), request('/api/appointments?status=booked')]); setData(work); setAppointments(list.items || []); } catch (err) { setError(err.message); } }
  useEffect(() => { refresh(); }, []);
  async function resolve(event) { event.preventDefault(); setError(''); try { setScan(await request('/api/scan/resolve', { method: 'POST', body: /\.[a-f0-9]{12}$/.test(code.trim()) ? { code: code.trim() } : { id: code.trim() } })); } catch (err) { setError(err.message); } }
  return <section className="react-page"><div className="react-heading"><div><p className="react-eyebrow">G3 · G4 · G6</p><h1>角色工作台</h1><p>{user.name} · {roles[user.role]} · {user.authorizedCampuses?.join('、')}</p></div><button onClick={refresh}>刷新</button></div>{error && <p className="react-error">{error}</p>}<div className="react-grid"><article className="react-card"><h2>今日工作</h2><p>值班安排：{data?.todayDuties?.length || 0} 项</p><p>签到状态：{data?.presence?.state || '未签到'}</p><p>当前维修：{data?.currentRepair ? data.currentRepair.id : '暂无'}</p><button className="react-primary" onClick={() => onNavigate('attendance')}>打开值班签到</button></article><article className="react-card"><h2>扫码维修前台</h2><form onSubmit={resolve} className="react-inline"><input value={code} onChange={event => setCode(event.target.value)} placeholder="扫描或输入预约编号" required /><button className="react-primary">查询工单</button></form>{scan && <div className="react-result"><strong>{scan.id}</strong><span>{scan.campus} · {scan.date} · {scan.timeSlot}</span><span>{scan.deviceType} · {scan.deviceModel}</span><small>可执行：{scan.actions?.join('、') || '查看'}</small></div>}<button onClick={() => onNavigate('scan')}>进入维修前台</button></article></div><article className="react-card"><div className="react-heading"><h2>待处理预约</h2><button onClick={() => onNavigate('staff')}>完整维修列表</button></div><div className="react-table"><div className="react-row react-row-head"><span>编号</span><span>校区 / 时段</span><span>设备</span><span>状态</span></div>{appointments.slice(0, 8).map(item => <div className="react-row" key={item.id}><span>{item.id}</span><span>{item.campus}<br />{item.date} {item.timeSlot}</span><span>{item.deviceType} · {item.deviceModel}</span><span>{statusLabels[item.status] || item.status}</span></div>)}{!appointments.length && <p className="react-muted">暂无待处理预约</p>}</div></article></section>;
}

function Attendance({ onNavigate }) {
  const [items, setItems] = useState([]); const [token, setToken] = useState(''); const [message, setMessage] = useState('');
  async function refresh() { try { const data = await request('/api/me/attendance'); setItems(data.items || []); } catch (error) { setMessage(error.message); } }
  useEffect(() => { refresh(); }, []);
  async function checkIn(event) { event.preventDefault(); try { await request('/api/attendance/check-ins', { method: 'POST', body: { token } }); setMessage('签到成功'); setToken(''); refresh(); } catch (error) { setMessage(error.message); } }
  return <section className="react-page"><div className="react-heading"><div><p className="react-eyebrow">G7 · ATTENDANCE</p><h1>值班签到</h1><p>使用值班二维码或短 token 完成本人签到，签到后可进入维修工作台。</p></div><button onClick={() => onNavigate('roster')}>排班与申请</button></div><article className="react-card"><form onSubmit={checkIn} className="react-inline"><input value={token} onChange={event => setToken(event.target.value)} placeholder="输入签到 token" required /><button className="react-primary">确认签到</button></form>{message && <p className="react-message">{message}</p>}<h2>我的签到记录</h2>{items.map(item => <div className="react-list-item" key={item.id}>{item.businessDate} · {item.type} · {item.campusId || '全局'}</div>)}</article></section>;
}

function RosterManager({ user }) {
  const canManage = (user?.grants || []).some(grant => ['roster.repair.manage', 'roster.office.manage'].includes(grant.permissionCode));
  const [tasks, setTasks] = useState([]); const [selectedTask, setSelectedTask] = useState(''); const [form, setForm] = useState({ weekStart: '', slotStart: '19:00', slotEnd: '21:00', deadline: '', campusId: 'campus-nanhu', description: '' }); const [draft, setDraft] = useState(null); const [message, setMessage] = useState('');
  async function refresh() { if (!canManage) return; try { const data = await request('/api/roster-tasks'); setTasks(data.items || []); if (!selectedTask && data.items?.[0]) setSelectedTask(data.items[0].id); } catch (error) { setMessage(error.message); } }
  useEffect(() => { refresh(); }, [canManage]);
  async function createTask(event) { event.preventDefault(); try { const result = await request('/api/roster-tasks', { method: 'POST', body: { ...form, requestId: crypto.randomUUID() } }); setMessage('排班收集任务已创建'); setSelectedTask(result.id); await refresh(); } catch (error) { setMessage(error.message); } }
  async function generate() { if (!selectedTask) return setMessage('请先选择排班任务'); try { const availability = await request(`/api/roster-tasks/${encodeURIComponent(selectedTask)}/availability`); const rows = availability.items || []; const members = Object.values(rows.reduce((map, item) => { const current = map[item.memberId] || { memberId: item.memberId, available: [], isLead: false }; current.available.push(item); map[item.memberId] = current; return map; }, {})); const slots = [...new Map(rows.map(item => [`${item.businessDate}:${item.campusId}:${item.startAt}:${item.endAt}`, { businessDate: item.businessDate, campusId: item.campusId || form.campusId, startAt: item.startAt, endAt: item.endAt }])).values()]; const task = tasks.find(item => item.id === selectedTask); const result = await request('/api/rosters/generate', { method: 'POST', body: { taskId: selectedTask, weekStart: task?.weekStart || form.weekStart, campusId: form.campusId, members, slots, requestId: crypto.randomUUID() } }); setDraft(result); setMessage(result.validation?.valid ? '草稿已生成，可以发布' : '草稿已生成，请先处理覆盖校验问题'); } catch (error) { setMessage(error.message); } }
  async function publish() { if (!draft?.version) return; try { await request(`/api/rosters/${encodeURIComponent(draft.version.id)}/publish`, { method: 'POST', body: { version: draft.version.version, campusId: form.campusId, requestId: crypto.randomUUID() } }); setMessage('班表已发布，成员端会自动看到新班次'); setDraft(null); await refresh(); } catch (error) { setMessage(error.message); } }
  if (!canManage) return null;
  return <section className="react-page roster-manager"><div className="react-heading"><div><p className="react-eyebrow">ROSTER CONTROL</p><h2>排班负责人</h2><p>先收集可用时间，再生成草稿并发布；每次发布都会保留版本。</p></div></div>{message && <p className="react-message" role="status">{message}</p>}<div className="manager-layout"><article className="react-card"><h3>创建收集任务</h3><form className="roster-form" onSubmit={createTask}><label>周一日期<input type="date" required value={form.weekStart} onChange={event => setForm({ ...form, weekStart: event.target.value })} /></label><div className="react-inline"><label>开始<input type="time" value={form.slotStart} onChange={event => setForm({ ...form, slotStart: event.target.value })} /></label><label>结束<input type="time" value={form.slotEnd} onChange={event => setForm({ ...form, slotEnd: event.target.value })} /></label></div><label>截止时间<input type="datetime-local" required value={form.deadline} onChange={event => setForm({ ...form, deadline: event.target.value })} /></label><label>校区<select value={form.campusId} onChange={event => setForm({ ...form, campusId: event.target.value })}><option value="campus-nanhu">南湖</option><option value="campus-hunnan">浑南</option></select></label><label>说明<input value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="例如：下周维修值班收集" /></label><button className="react-primary">发布收集任务</button></form></article><article className="react-card"><h3>生成与发布</h3><label>收集任务<select value={selectedTask} onChange={event => setSelectedTask(event.target.value)}><option value="">请选择任务</option>{tasks.map(task => <option key={task.id} value={task.id}>{task.weekStart} · {task.slotStart}–{task.slotEnd}</option>)}</select></label><div className="manager-actions"><button className="react-primary" type="button" disabled={!selectedTask} onClick={generate}>生成排班草稿</button><button type="button" disabled={!draft?.validation?.valid} onClick={publish}>确认发布</button></div>{draft && <div className={`validation-summary ${draft.validation?.valid ? 'is-valid' : 'is-invalid'}`}><strong>{draft.validation?.valid ? '校验通过' : '需要处理覆盖问题'}</strong><span>覆盖 {draft.coverage?.covered || 0} / {draft.coverage?.required || 0} 个时段</span>{draft.validation?.errors?.slice(0, 3).map(error => <small key={`${error.code}-${error.memberId || ''}`}>{error.code}{error.memberId ? ` · ${error.memberId}` : ''}</small>)}</div>}</article></div></section>;
}

// The React host mounts new modules alongside the existing operational modules.
// Authentication, navigation and camera lifecycle have one owner in main.js.
function Root() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState('');
  const [field, setField] = useState(null);
  useEffect(() => {
    let active = true;
    if (!user) { setField(null); return; }
    request('/api/field/home', { suppressAuthExpired: true }).then(data => { if (active && data.enabled) { setField(data); window.dispatchEvent(new CustomEvent('staff-navigate', { detail:'workbench' })); } }).catch(() => {});
    return () => { active = false; };
  }, [user?.memberId, user?.account, user?.authVersion]);
  useEffect(() => {
    return initStaffApplication({
      onSession: setUser,
      onView: setPage,
      onLogout: () => { setUser(null); setPage(''); }
    }).dispose;
  }, []);
  const navigate = view => window.dispatchEvent(new CustomEvent('staff-navigate', { detail: view }));
  if (!user) return null;
  return <>{page === 'workbench' && (field ? <FieldApp initial={field} onNavigate={navigate} /> : <Workbench user={user} onNavigate={navigate} />)}
    {page === 'attendance' && <Attendance onNavigate={navigate} />}
    {page === 'roster' && <><Roster user={user} /><RosterManager user={user} /></>}
    {page === 'members' && <Members user={user} />}
    {page === 'permissions' && <Permissions user={user} />}</>;
}

createRoot(document.getElementById('staff-platform-root')).render(<Root />);
