import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { drawSignature, validSignature } from '../../shared/signature.js';
import { clearSession, useStaffSession } from '../../shared/api.js';
import { request } from './request.js';
import { MemberEditor } from './MemberEditor.jsx';
import { Permissions } from './Permissions.jsx';

const roles = { technician: '维修人员', admin: '管理员', superadmin: '最高权限者' };
const tokenKey = 'pioneerToken';
const readToken = () => sessionStorage.getItem(tokenKey) || '';

useStaffSession();

function Login({ onLogin }) {
  const [account, setAccount] = useState(''); const [password, setPassword] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function submit(event) { event.preventDefault(); setBusy(true); setError(''); try { const data = await request('/api/auth/login', { method: 'POST', body: { account, password } }); sessionStorage.setItem(tokenKey, data.token); sessionStorage.setItem('pioneerAccount', data.account); const profile = await request('/api/auth/me'); if (readToken() === data.token) onLogin(profile); } catch (err) { clearSession(); setError(err.message); } finally { setBusy(false); } }
  return <main className="react-login"><div className="react-card"><p className="react-eyebrow">STAFF ACCESS · ACCOUNT LOGIN</p><h1>工作人员登录</h1><p>先锋硬件部 · Staff Platform</p><form onSubmit={submit}><label>学号<input value={account} onChange={event => setAccount(event.target.value)} autoComplete="username" required /></label><label>密码<input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" required /></label>{error && <p className="react-error">{error}</p>}<button className="react-primary" disabled={busy}>{busy ? '登录中…' : '进入系统'}</button></form></div></main>;
}

function Workbench({ user, onNavigate }) {
  const [data, setData] = useState(null); const [appointments, setAppointments] = useState([]); const [error, setError] = useState(''); const [code, setCode] = useState(''); const [scan, setScan] = useState(null);
  async function refresh() { try { const [work, list] = await Promise.all([request('/api/workbench'), request('/api/appointments?status=pending')]); setData(work); setAppointments(list.items || []); } catch (err) { setError(err.message); } }
  useEffect(() => { refresh(); }, []);
  async function resolve(event) { event.preventDefault(); setError(''); try { setScan(await request('/api/scan/resolve', { method: 'POST', body: { code } })); } catch (err) { setError(err.message); } }
  return <section className="react-page"><div className="react-heading"><div><p className="react-eyebrow">G3 · G4 · G6</p><h1>角色工作台</h1><p>{user.name} · {roles[user.role]} · {user.authorizedCampuses?.join('、')}</p></div><button onClick={refresh}>刷新</button></div>{error && <p className="react-error">{error}</p>}<div className="react-grid"><article className="react-card"><h2>今日工作</h2><p>值班安排：{data?.todayDuties?.length || 0} 项</p><p>签到状态：{data?.presence?.state || '未签到'}</p><p>当前维修：{data?.currentRepair ? data.currentRepair.id : '暂无'}</p><button className="react-primary" onClick={() => onNavigate('attendance')}>打开值班签到</button></article><article className="react-card"><h2>扫码维修前台</h2><form onSubmit={resolve} className="react-inline"><input value={code} onChange={event => setCode(event.target.value)} placeholder="扫描或输入预约编号" required /><button className="react-primary">查询工单</button></form>{scan && <div className="react-result"><strong>{scan.id}</strong><span>{scan.campus} · {scan.date} · {scan.timeSlot}</span><span>{scan.deviceType} · {scan.deviceModel}</span><small>可执行：{scan.actions?.join('、') || '查看'}</small></div>}<button onClick={() => onNavigate('repair')}>进入维修前台</button></article></div><article className="react-card"><div className="react-heading"><h2>待处理预约</h2><button onClick={() => onNavigate('repair')}>完整维修列表</button></div><div className="react-table"><div className="react-row react-row-head"><span>编号</span><span>校区 / 时段</span><span>设备</span><span>状态</span></div>{appointments.slice(0, 8).map(item => <div className="react-row" key={item.id}><span>{item.id}</span><span>{item.campus}<br />{item.date} {item.timeSlot}</span><span>{item.deviceType} · {item.deviceModel}</span><span>{item.status === 'booked' ? '已预约' : '维修中'}</span></div>)}{!appointments.length && <p className="react-muted">暂无待处理预约</p>}</div></article></section>;
}

function Members({ user }) {
  const [items, setItems] = useState([]); const [q, setQ] = useState(''); const [selected, setSelected] = useState(null); const [error, setError] = useState('');
  async function refresh() { try { const members = await request(`/api/members?q=${encodeURIComponent(q)}`); setItems(members.items || []); } catch (err) { setError(err.message); } }
  useEffect(() => { refresh(); }, [q]);
  return <section className="react-page"><div className="react-heading"><div><p className="react-eyebrow">G5 · IDENTITY</p><h1>成员管理</h1><p>成员资料与角色授权分别维护，所属校区不改变授权范围。</p></div><button onClick={refresh}>刷新</button></div>{error && <p className="react-error">{error}</p>}<div className="react-toolbar"><input value={q} onChange={event => setQ(event.target.value)} placeholder="搜索姓名、学号或账号" /><span>{items.length} 名成员</span></div><div className="react-table"><div className="react-row react-row-head"><span>姓名 / 学号</span><span>校区</span><span>状态</span><span>主要部门</span><span>操作</span></div>{items.map(item => <div className="react-row" key={item.memberId}><span><strong>{item.name}</strong><br />{item.studentId || item.account}</span><span>{item.homeCampusId === 'campus-hunnan' ? '浑南' : '南湖'}</span><span>{item.status === 'active' ? '在岗' : '停用'}</span><span>{item.primaryDepartment || '—'}</span><span><button onClick={() => setSelected(item)}>编辑成员与权限</button></span></div>)}</div>{selected && <MemberEditor member={selected} canManageRoles={user.grants?.some(grant => grant.permissionCode === 'roles.manage')} onClose={() => setSelected(null)} onSaved={refresh} />}</section>;
}



function Repair({ user }) {
  const [items, setItems] = useState([]); const [error, setError] = useState(''); const [strokes, setStrokes] = useState([]); const [onsite, setOnsite] = useState({ studentId: '', name: '', campus: user.homeCampus || '南湖', deviceType: '笔记本电脑', brand: '', deviceModel: '', faultType: '', date: '', timeSlot: '19:00–19:30', social: '', warranty: '未知' });
  const canvasRef = React.useRef(null); const requestId = React.useRef(crypto.randomUUID());
  useEffect(() => { const canvas = canvasRef.current; if (canvas) drawSignature(canvas, strokes); }, [strokes]);
  async function refresh() { try { const data = await request('/api/appointments?status=all'); setItems(data.items || []); } catch (err) { setError(err.message); } }
  useEffect(() => { refresh(); }, []);
  function point(event) { const rect = canvasRef.current.getBoundingClientRect(); return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))]; }
  function begin(event) { event.currentTarget.setPointerCapture(event.pointerId); setStrokes(current => [...current, [point(event)]]); }
  function move(event) { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; setStrokes(current => { const next = current.map(stroke => [...stroke]); next[next.length - 1].push(point(event)); return next; }); }
  async function createOnsite(event) { event.preventDefault(); if (!validSignature(strokes)) { setError('请先完成机主本人手写签名'); return; } try { await request('/api/scan/onsite', { method: 'POST', body: { ...onsite, registrationKey: requestId.current, agreementAt: new Date().toISOString(), signature: strokes } }); setOnsite(current => ({ ...current, studentId: '', name: '', brand: '', deviceModel: '', faultType: '', social: '' })); setStrokes([]); requestId.current = crypto.randomUUID(); refresh(); } catch (err) { setError(err.message); } }
  return <section className="react-page"><div className="react-heading"><div><p className="react-eyebrow">G4 · G6 · REPAIR DESK</p><h1>维修前台</h1><p>扫码查询、维修登记与现场临时工单入口。</p></div><button onClick={refresh}>刷新</button></div>{error && <p className="react-error">{error}</p>}<div className="react-grid"><article className="react-card"><h2>临时维修登记</h2><form onSubmit={createOnsite} className="react-form-grid">{[['studentId','学号'],['name','姓名'],['social','联系方式'],['brand','品牌'],['deviceModel','型号'],['faultType','故障']].map(([key, label]) => <label key={key}>{label}<input required value={onsite[key]} onChange={event => setOnsite({ ...onsite, [key]: event.target.value })} /></label>)}<label>校区<select value={onsite.campus} onChange={event => setOnsite({ ...onsite, campus: event.target.value })}><option>南湖</option><option>浑南</option></select></label><label>日期<input type="date" required value={onsite.date} onChange={event => setOnsite({ ...onsite, date: event.target.value })} /></label><label>时段<select value={onsite.timeSlot} onChange={event => setOnsite({ ...onsite, timeSlot: event.target.value })}><option>19:00–19:30</option><option>19:30–20:00</option><option>20:00–20:30</option><option>20:30–21:00</option></select></label><label>机主本人签名<canvas ref={canvasRef} width="500" height="180" className="react-signature" onPointerDown={begin} onPointerMove={move} /></label><button type="button" onClick={() => setStrokes([])}>清除签名</button><button className="react-primary">创建临时工单</button></form></article><article className="react-card"><h2>工单队列</h2><div className="react-table">{items.slice(0, 20).map(item => <div className="react-row" key={item.id}><span>{item.id}<br />{item.name || '已隐藏身份'}</span><span>{item.campus}<br />{item.timeSlot}</span><span>{item.status === 'booked' ? '待接单' : item.status === 'in_progress' ? '维修中' : '已结束'}</span></div>)}</div></article></div></section>;
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

function App({ user, onLogout }) { const [page, setPage] = useState('workbench'); const admin = ['admin', 'superadmin'].includes(user.role); const navigate = value => setPage(value); return <><header className="react-topbar"><strong>先锋硬件部</strong><nav><button className={page === 'workbench' ? 'is-active' : ''} onClick={() => setPage('workbench')}>工作台</button><button className={page === 'repair' ? 'is-active' : ''} onClick={() => setPage('repair')}>维修前台</button><button className={page === 'attendance' ? 'is-active' : ''} onClick={() => setPage('attendance')}>签到</button><button className={page === 'roster' ? 'is-active' : ''} onClick={() => setPage('roster')}>排班</button>{admin && <><button className={page === 'members' ? 'is-active' : ''} onClick={() => setPage('members')}>成员管理</button><button className={page === 'permissions' ? 'is-active' : ''} onClick={() => setPage('permissions')}>权限编辑器</button></>}</nav><span>{user.name} · {roles[user.role]} <button onClick={onLogout}>退出</button></span></header>{page === 'workbench' && <Workbench user={user} onNavigate={navigate} />}{page === 'repair' && <Repair user={user} />}{page === 'attendance' && <Attendance onNavigate={navigate} />}{page === 'roster' && <Roster />}{page === 'members' && admin && <Members user={user} />}{page === 'permissions' && admin && <Permissions />}</>; }

function Root() {
  const [user, setUser] = useState(null);
  const [restoring, setRestoring] = useState(Boolean(readToken()));
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    document.querySelectorAll('.login-view,#app-shell,#workbench-profile-dialog,.modal-backdrop').forEach(node => {
      node.dataset.reactHidden = 'true'; node.hidden = true;
    });
    function expired() {
      setUser(null);
      setError('登录已失效，请重新登录');
      setRestoring(false);
    }
    window.addEventListener('auth-expired', expired);
    const token = readToken();
    if (token) {
      request('/api/auth/me').then(data => {
        if (active && readToken() === token) setUser(data);
      }).catch(err => {
        if (active) setError(err.message);
      }).finally(() => {
        if (active) setRestoring(false);
      });
    }
    return () => { active = false; window.removeEventListener('auth-expired', expired); };
  }, []);
  function logout() {
    request('/api/auth/logout', { method: 'POST' }).catch(() => {});
    clearSession();
    setUser(null);
    setError('');
  }
  if (restoring) return <main className="react-login" role="status">正在恢复登录…</main>;
  return user ? <App user={user} onLogout={logout} /> : <>{error && <p className="react-error" role="alert">{error}</p>}<Login onLogin={data => { setError(''); setUser(data); }} /></>;
}

createRoot(document.getElementById('staff-react-root')).render(<Root />);
