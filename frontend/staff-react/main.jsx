import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { initStaffApplication } from '../staff/main.js';
import { setWorkspaceSession, clearWorkspaceState } from './workspace-state.js';
import './workspace.css';
import { request } from './request.js';
import { Attendance } from './Attendance';
import { Members } from './Members.jsx';
import { Permissions } from './Permissions.jsx';
import { statusLabels } from '../../shared/constants.js';
import { RosterArea } from './RosterManager.jsx';
import { WorkspacePortal } from './WorkspacePortal';
import { WorkspaceHeader } from './WorkspaceHeader';
import { StaffWorkspace } from './StaffWorkspace';
import { Records } from './Records';
import { FieldApp } from './field/FieldApp';
import { ActivityContext } from './field/ui';
import { Statistics } from './Statistics';
import { AccountSettings } from './AccountSettings';
import { Accounts } from './Accounts';
import { staffPermission, staffViewAllowed, staffSceneAllowed } from '../../shared/staff-access.js';
import { OfficeRoster } from './OfficeRoster';
import { LeaveReview } from './LeaveReview';
import { WorkspacePage } from './WorkspacePage';
import './workspace-foundation.css';

const roles = { technician: '维修人员', admin: '管理员', superadmin: '最高权限者' };
function Workbench({ user, onNavigate }) {
  const [data, setData] = useState(null); const [appointments, setAppointments] = useState([]); const [error, setError] = useState(''); const [code, setCode] = useState(''); const [scan, setScan] = useState(null);
  async function refresh() { try { const [work, list] = await Promise.all([request('/api/workbench'), request('/api/appointments?status=booked')]); setData(work); setAppointments(list.items || []); } catch (err) { setError(err.message); } }
  useEffect(() => { refresh(); }, []);
  async function resolve(event) { event.preventDefault(); setError(''); try { setScan(await request('/api/scan/resolve', { method: 'POST', body: /\.[a-f0-9]{12}$/.test(code.trim()) ? { code: code.trim() } : { id: code.trim() } })); } catch (err) { setError(err.message); } }
  return <section className="react-page"><div className="react-heading"><div><p className="react-eyebrow">G3 · G4 · G6</p><h1>角色工作台</h1><p>{user.name} · {roles[user.role]} · {user.authorizedCampuses?.join('、')}</p></div><button onClick={refresh}>刷新</button></div>{error && <p className="react-error">{error}</p>}<div className="react-grid"><article className="react-card"><h2>今日工作</h2><p>值班安排：{data?.todayDuties?.length || 0} 项</p><p>签到状态：{data?.presence?.state || '未签到'}</p><p>当前维修：{data?.currentRepair ? data.currentRepair.id : '暂无'}</p><button className="react-primary" onClick={() => onNavigate('attendance')}>打开值班签到</button></article><article className="react-card"><h2>扫码维修前台</h2><form onSubmit={resolve} className="react-inline"><input value={code} onChange={event => setCode(event.target.value)} placeholder="扫描或输入预约编号" required /><button className="react-primary">查询工单</button></form>{scan && <div className="react-result"><strong>{scan.id}</strong><span>{scan.campus} · {scan.date} · {scan.timeSlot}</span><span>{scan.deviceType} · {scan.deviceModel}</span><small>可执行：{scan.actions?.join('、') || '查看'}</small></div>}<button onClick={() => onNavigate('scan')}>进入维修前台</button></article></div><article className="react-card"><div className="react-heading"><h2>待处理预约</h2><button onClick={() => onNavigate('staff')}>完整维修列表</button></div><div className="react-table"><div className="react-row react-row-head"><span>编号</span><span>校区 / 时段</span><span>设备</span><span>状态</span></div>{appointments.slice(0, 8).map(item => <div className="react-row" key={item.id}><span>{item.id}</span><span>{item.campus}<br />{item.date} {item.timeSlot}</span><span>{item.deviceType} · {item.deviceModel}</span><span>{statusLabels[item.status] || item.status}</span></div>)}{!appointments.length && <p className="react-muted">暂无待处理预约</p>}</div></article></section>;
}

// All enabled-platform routes share one React workspace. The DOM controllers
// remain the compatibility host when the platform has not been enabled.
function Root() {
  const [user, setUser] = useState(null);
  const [page, setPage] = useState('');
  const [field, setField] = useState(null);
  const [bootProfile, setBootProfile] = useState(null), [bootError, setBootError] = useState(''), [bootRetry, setBootRetry] = useState(0);
  const [workScene, setWorkScene] = useState(null);
  const [rosterSection, setRosterSection] = useState('mine');
  const [rosterRequestSignal, setRosterRequestSignal] = useState(0);
  const [visited, setVisited] = useState([]);
  const [settingsSection, setSettingsSection] = useState('security');
  const profileRef = useRef(null);
  profileRef.current = user && { ...user, permissions: field?.permissions || user.permissions };
  useEffect(() => {
    if (!field || !user) return;
    const profile = { ...user, permissions: field.permissions || user.permissions };
    const target = page === 'settings' && settingsSection === 'capacity' ? 'capacity' : page === 'roster' && rosterSection === 'manage' ? 'roster-manage' : page;
    if (!staffViewAllowed(profile, target)) {
      setSettingsSection('security'); setRosterSection('mine'); setPage('workbench');
      setVisited(current => [...new Set([...current.filter(view => staffViewAllowed(profile, view)), 'workbench'])]);
    }
    if (page === 'workbench' && workScene && !staffSceneAllowed(profile, field, workScene)) setWorkScene('mine');
  }, [field, user, page, rosterSection, settingsSection, workScene]);
  useEffect(() => {
    let active = true; const controller = new AbortController();
    if (!user) { setField(null); return; }
    setBootError('');
    request('/api/field/home', { signal: controller.signal }).then(data => {
      if (!active) return;
      if (data.enabled) {
        setField(data); setBootProfile(null);
        setWorkScene(current => current || (data.currentRepair ? 'repair' : data.contexts.find(context => context.id === sessionStorage.getItem(`field-scene:${data.actor.memberId}`))?.id || data.contexts.find(context => context.id === 'desk')?.id || data.contexts[0]?.id || 'mine'));
        window.dispatchEvent(new CustomEvent('staff-navigate', { detail:'workbench' }));
      } else if (user.staffWorkflowEnabled) setBootError('平台配置已更新，请退出后重新登录。');
    }).catch(error => { if (active && !controller.signal.aborted && user.staffWorkflowEnabled) setBootError(error.message); });
    return () => { active = false; controller.abort(); };
  }, [user?.memberId, user?.account, user?.authVersion, bootRetry]);
  useEffect(() => {
    const session = event => { setBootProfile(event.detail?.staffWorkflowEnabled ? event.detail : null); setBootError(''); };
    const failure = event => setBootError(event.detail?.message || '暂时无法准备工作区，请重试。');
    window.addEventListener('staff-session-ready', session); window.addEventListener('staff-context-error', failure);
    return () => { window.removeEventListener('staff-session-ready', session); window.removeEventListener('staff-context-error', failure); };
  }, []);
  useEffect(() => {
    return initStaffApplication({
      onSession: profile => {
        setWorkspaceSession(`${profile.memberId || profile.account}:${profile.authVersion}:${JSON.stringify(profile.permissions || {})}`);
        setUser(profile);
        setField(current => current && current.actor.memberId === (profile.actor?.memberId || profile.memberId) ? { ...current, permissions: profile.permissions, navigation: profile.navigation,
          contexts: current.contexts.filter(context => staffSceneAllowed(profile, current, context.id)),
          capability: Object.fromEntries(Object.entries(current.capability).map(([code, allowed]) => [code, allowed && staffPermission(profile, code)])) } : current);
      },
      onView: view => { if (profileRef.current && !staffViewAllowed(profileRef.current, view)) return; setPage(view); setVisited(current => current.includes(view) ? current : [...current, view]); },
      onLogout: () => { clearWorkspaceState(); setUser(null); setField(null); setBootProfile(null); setBootError(''); setPage(''); setVisited([]); setWorkScene(null); setRosterSection('mine'); setRosterRequestSignal(0); setSettingsSection('security'); }
    }).dispose;
  }, []);
  const navigate = view => {
    if (field && !(view.startsWith('scene:') ? staffSceneAllowed(profileRef.current, field, view.slice(6)) : staffViewAllowed(profileRef.current, view))) return;
    if (view === 'roster-requests') { setRosterRequestSignal(value => value + 1); view = 'roster'; }
    if (view === 'capacity') { setSettingsSection('capacity'); view = 'settings'; }
    else if (view === 'settings') setSettingsSection('security');
    if (view.startsWith('scene:')) { setWorkScene(view.slice(6)); view = 'workbench'; }
    if (view === 'roster-manage') { setRosterSection('manage'); view = 'roster'; }
    else if (view === 'roster') setRosterSection('mine');
    if (field && view === 'scan') { setWorkScene('repair'); view = 'workbench'; }
    window.dispatchEvent(new CustomEvent('staff-navigate', { detail: view }));
  };
  if (!field && (bootProfile?.staffWorkflowEnabled || user?.staffWorkflowEnabled)) return <WorkspacePortal><div className="field-app workspace-bootstrap"><main className="field-main"><WorkspaceHeader group="工作人员平台" title={bootError ? '工作区暂时不可用' : '正在准备工作区'} description="正在加载你的岗位、授权范围与当前任务。" /><section className="field-card"><p role="status">{bootError || '请稍候，工作区准备完成后将自动进入。'}</p>{!bootError && <div className="workspace-skeleton" aria-hidden="true"><span /><span /><span /></div>}<div className="field-actions">{bootError && <button className="field-primary" onClick={() => { setBootError(''); if (user) setBootRetry(value => value + 1); else window.dispatchEvent(new CustomEvent('staff-context-retry')); }}>重新加载工作区</button>}<button onClick={() => document.getElementById('logout-btn')?.click()}>退出登录</button></div></section></main></div></WorkspacePortal>;
  if (!user) return null;
  const effectiveUser = { ...user, permissions: field?.permissions || user.permissions };
  const published = new Set((field?.navigation || user.navigation || []).map(entry => entry.id));
  const publishedView = (id, view) => published.has(id) && staffViewAllowed(effectiveUser, view);
  const workspaceLinks = [
    ...(field ? field.contexts.filter(context => staffSceneAllowed(effectiveUser, field, context.id)).map(context => ({ ...context, id: `scene:${context.id}`, group: '今日工作' })) : [{ id: 'workbench', label: '工作台', group: '今日工作' }]),
    ...(field ? [{ id: 'scene:mine', label: '个人中心', group: '我的' }] : []),
    ...(publishedView('rosters', 'roster') ? [{ id: 'roster', label: '班次与排班', group: '我的' }] : []),
    ...(staffPermission(effectiveUser, 'roster.repair.manage') ? [{ id: 'roster-manage', label: '维修排班管理', group: '值班管理' }] : []),
    ...(staffPermission(effectiveUser, 'roster.office.manage') ? [{ id: 'office-roster', label: '办公排班管理', group: '值班管理' }] : []),
    ...(staffPermission(effectiveUser, 'leave.review') ? [{ id: 'leave-review', label: '请假审批', group: '值班管理' }] : []),
    ...(field && staffPermission(effectiveUser, 'repair.summary.read') ? [{ id: 'staff', label: '预约记录', group: '今日工作' }] : []),
    ...(publishedView('members', 'members') ? [{ id: 'members', label: '成员管理', group: '平台管理' }] : []),
    ...(publishedView('roles', 'permissions') ? [{ id: 'permissions', label: '授权管理', group: '平台管理' }] : []),
    ...(publishedView('attendance', 'attendance') ? [{ id: 'attendance', label: '本人签到记录', group: '我的' }] : []),
    ...(field && staffPermission(effectiveUser, 'statistics.read') ? [{ id: 'stats', label: '统计分析', group: '数据与审计' }] : []),
    ...(field && staffPermission(effectiveUser, 'accounts.manage') ? [{ id: 'users', label: '账号管理', group: '平台管理' }] : []),
    ...(field ? [{ id: 'settings', label: '账号安全', group: '我的' }] : []),
    ...(field && staffPermission(effectiveUser, 'settings.manage') ? [{ id: 'capacity', label: '预约配置', group: '业务管理' }] : [])
  ];
  if (!field) {
    if (page === 'workbench') return <Workbench user={user} onNavigate={navigate} />;
    if (page === 'roster') return <main className="field-main"><RosterArea user={user} section={rosterSection} /></main>;
    if (page === 'office-roster') return <main className="field-main roster-area"><OfficeRoster user={user} /></main>;
    if (page === 'leave-review') return <main className="field-main"><LeaveReview user={user} onNavigate={navigate} /></main>;
    // Native pages retain their original host while the field platform is off.
    if (['staff','scan','stats','users','settings'].includes(page)) return null;
    const module = page === 'attendance' ? <Attendance onNavigate={navigate} /> : page === 'members' ? <Members user={user} /> : page === 'permissions' ? <Permissions user={user} /> : null;
    return module;
  }
  const active = page === 'workbench' ? `scene:${workScene}` : page === 'roster' && rosterSection === 'manage' ? 'roster-manage' : page === 'settings' && settingsSection === 'capacity' ? 'capacity' : page;
  // Keep route instances mounted for the signed-in session. Switching a
  // module only changes its visibility, so drafts, selected work orders and
  // dialog state survive a trip through the sidebar. Hidden field routes pass
  // `active=false`, which stops their polling and device-backed UI.
  const visible = view => page === view;
  const route = (view, child, allowed = true) => allowed && staffViewAllowed(effectiveUser, view) && visited.includes(view) ? <ActivityContext.Provider key={view} value={visible(view)}><WorkspacePage route={view} active={visible(view)}>{child}</WorkspacePage></ActivityContext.Provider> : null;
  const fieldRoute = route('workbench', <FieldApp initial={field} active={visible('workbench')} onNavigate={navigate} requestedScene={workScene} onSceneChange={setWorkScene} onContextChange={setField} workspaceLinks={workspaceLinks} />);
  const rosterRoute = route('roster', <RosterArea user={effectiveUser} section={rosterSection} requestSignal={rosterRequestSignal} />, published.has('rosters') || staffPermission(effectiveUser, 'roster.repair.manage'));
  const moduleRoutes = [
    route('leave-review', <LeaveReview user={effectiveUser} onNavigate={navigate} />, staffPermission(effectiveUser, 'leave.review')),
    route('office-roster', <section className="roster-area"><OfficeRoster user={effectiveUser} /></section>, staffPermission(effectiveUser, 'roster.office.manage')),
    route('staff', <Records user={effectiveUser} />, workspaceLinks.some(entry => entry.id === 'staff')),
    route('stats', <Statistics />, workspaceLinks.some(entry => entry.id === 'stats')),
    route('settings', <AccountSettings user={effectiveUser} section={settingsSection} onNavigate={navigate} />),
    route('users', <Accounts user={user} />, workspaceLinks.some(entry => entry.id === 'users')),
    route('attendance', <section className="workspace-module"><Attendance onNavigate={navigate} /></section>, published.has('attendance')),
    route('members', <section className="workspace-module"><Members user={effectiveUser} /></section>, published.has('members')),
    route('permissions', <section className="workspace-module"><Permissions user={user} /></section>, published.has('roles')),
  ];
  return <WorkspacePortal key={`${user.memberId || user.account}:${user.authVersion}:${JSON.stringify(effectiveUser.permissions || {})}`}><StaffWorkspace name={user.name || ''} entries={workspaceLinks} active={active} onSelect={navigate}>{fieldRoute}{rosterRoute}{moduleRoutes}</StaffWorkspace></WorkspacePortal>;

}

createRoot(document.getElementById('staff-platform-root')).render(<Root />);
