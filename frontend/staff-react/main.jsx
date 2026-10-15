import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initStaffApplication } from '../staff/main.js';
import { request } from './request.js';
import { Members } from './Members.jsx';
import { Permissions } from './Permissions.jsx';
import { statusLabels } from '../../shared/constants.js';
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

function Roster() {
  const [assignments, setAssignments] = useState([]); const [tasks, setTasks] = useState([]); const [leaves, setLeaves] = useState([]); const [swaps, setSwaps] = useState([]); const [reason, setReason] = useState(''); const [availability, setAvailability] = useState({ taskId: '', businessDate: '', startAt: '19:00', endAt: '21:00', campusId: 'campus-nanhu' }); const [swapForm, setSwapForm] = useState({ fromAssignmentId: '', toAssignmentId: '', toMemberId: '', fromRevision: 0, toRevision: 0, note: '' }); const [message, setMessage] = useState('');
  async function refresh() { try { const [mine, taskData, leaveData, swapData] = await Promise.all([request('/api/me/roster'), request('/api/roster-tasks'), request('/api/leaves'), request('/api/swaps')]); setAssignments(mine.items || []); setTasks(taskData.items || []); setLeaves(leaveData.items || []); setSwaps(swapData.items || []); if (!availability.taskId && taskData.items?.[0]) setAvailability(current => ({ ...current, taskId: taskData.items[0].id })); } catch (error) { setMessage(error.message); } }
  useEffect(() => { refresh(); }, []);
  async function saveAvailability(event) { event.preventDefault(); try { await request(`/api/roster-tasks/${encodeURIComponent(availability.taskId)}/availability`, { method: 'PUT', body: availability }); setMessage('可值班时间已提交'); } catch (error) { setMessage(error.message); } }
  async function applyLeave(event) { event.preventDefault(); if (!assignments[0]) return setMessage('当前没有可请假的已发布班次'); try { await request('/api/leaves', { method: 'POST', body: { assignmentId: assignments[0].id, reason, requestId: crypto.randomUUID() } }); setReason(''); setMessage('请假申请已提交'); refresh(); } catch (error) { setMessage(error.message); } }
  async function applySwap(event) { event.preventDefault(); try { await request('/api/swaps', { method: 'POST', body: { ...swapForm, requestId: crypto.randomUUID(), fromRevision: Number(swapForm.fromRevision), toRevision: Number(swapForm.toRevision) } }); setMessage('换班申请已提交'); refresh(); } catch (error) { setMessage(error.message); } }
  async function decideLeave(item, decision) { try { await request(`/api/leaves/${encodeURIComponent(item.id)}/decision`, { method: 'POST', body: { decision, revision: item.revision } }); refresh(); } catch (error) { setMessage(error.message); } }
  async function decideSwap(item, decision) { try { await request(`/api/swaps/${encodeURIComponent(item.id)}/decision`, { method: 'POST', body: { decision, revision: item.revision } }); refresh(); } catch (error) { setMessage(error.message); } }
  return <section className="react-page"><div className="react-heading"><div><p className="react-eyebrow">G8 · G9 · G10</p><h1>排班、换班与请假</h1><p>查看已发布班表，填报可用时间并提交协作申请。</p></div><button onClick={refresh}>刷新</button></div>{message && <p className="react-message">{message}</p>}<div className="react-grid"><article className="react-card"><h2>我的已发布班次</h2>{assignments.map(item => <div className="react-list-item" key={item.id}>{item.businessDate} · {item.startAt}–{item.endAt} · {item.campusName || item.campusId} · {item.roleKind || item.dutyType}<button type="button" onClick={() => setSwapForm(current => ({ ...current, fromAssignmentId: item.id, fromRevision: item.revision }))}>发起换班</button></div>)}{!assignments.length && <p className="react-muted">本周班表正在安排</p>}</article><article className="react-card"><h2>可值班时间</h2><form onSubmit={saveAvailability}>{tasks.length ? <select value={availability.taskId} onChange={event => setAvailability({ ...availability, taskId: event.target.value })}>{tasks.map(task => <option key={task.id} value={task.id}>{task.weekStart} · {task.slotStart}–{task.slotEnd}</option>)}</select> : <p className="react-muted">暂无开放的排班任务</p>}<input type="date" required value={availability.businessDate} onChange={event => setAvailability({ ...availability, businessDate: event.target.value })} /><div className="react-inline"><input type="time" value={availability.startAt} onChange={event => setAvailability({ ...availability, startAt: event.target.value })} /><input type="time" value={availability.endAt} onChange={event => setAvailability({ ...availability, endAt: event.target.value })} /></div><button className="react-primary" disabled={!tasks.length}>提交可值班时间</button></form></article><article className="react-card"><h2>请假申请</h2><form onSubmit={applyLeave}><textarea value={reason} onChange={event => setReason(event.target.value)} minLength="2" required placeholder="请填写请假原因" /><button className="react-primary">提交请假</button></form>{leaves.map(item => <div className="react-list-item" key={item.id}>{item.reason} · {item.status}{item.status === 'pending' && <button type="button" onClick={() => request(`/api/leaves/${encodeURIComponent(item.id)}/withdraw`, { method: 'POST', body: { revision: item.revision } }).then(refresh).catch(error => setMessage(error.message))}>撤回</button>}{item.status === 'pending' && <span><button type="button" onClick={() => decideLeave(item, 'approve')}>批准</button><button type="button" onClick={() => decideLeave(item, 'reject')}>拒绝</button></span>}</div>)}</article><article className="react-card"><h2>换班申请</h2><form onSubmit={applySwap}><input required placeholder="目标班次 ID" value={swapForm.toAssignmentId} onChange={event => setSwapForm({ ...swapForm, toAssignmentId: event.target.value })} /><input required placeholder="目标成员 ID" value={swapForm.toMemberId} onChange={event => setSwapForm({ ...swapForm, toMemberId: event.target.value })} /><input type="number" required placeholder="目标班次版本" value={swapForm.toRevision} onChange={event => setSwapForm({ ...swapForm, toRevision: event.target.value })} /><input placeholder="说明" value={swapForm.note} onChange={event => setSwapForm({ ...swapForm, note: event.target.value })} /><button className="react-primary">提交换班</button></form>{swaps.map(item => <div className="react-list-item" key={item.id}>{item.fromAssignmentId} → {item.toAssignmentId} · {item.status}{item.status === 'pending' && <span><button type="button" onClick={() => decideSwap(item, 'accept')}>接受</button><button type="button" onClick={() => decideSwap(item, 'decline')}>拒绝</button></span>}</div>)}</article></div></section>;
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
    {page === 'roster' && <Roster />}
    {page === 'members' && <Members user={user} />}
    {page === 'permissions' && <Permissions user={user} />}</>;
}

createRoot(document.getElementById('staff-platform-root')).render(<Root />);
