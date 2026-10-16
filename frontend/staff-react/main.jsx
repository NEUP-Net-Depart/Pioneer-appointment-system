import React, { useEffect, useState } from 'react';
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
import { StaffWorkspace } from './StaffWorkspace';
import { Records } from './Records';
import { FieldApp } from './field/FieldApp';
import { ActivityContext } from './field/ui';
import { Statistics } from './Statistics';
import { AccountSettings } from './AccountSettings';
import { Accounts } from './Accounts';

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
  const [workScene, setWorkScene] = useState(null);
  const [rosterSection, setRosterSection] = useState('mine');
  const [visited, setVisited] = useState([]);
  const [settingsSection, setSettingsSection] = useState('security');
  useEffect(() => {
    let active = true;
    if (!user) { setField(null); return; }
    request('/api/field/home', { suppressAuthExpired: true }).then(data => { if (active && data.enabled) { setField(data); setWorkScene(current => current || (data.currentRepair ? 'repair' : data.contexts.find(context => context.id === sessionStorage.getItem(`field-scene:${data.actor.memberId}`))?.id || data.contexts.find(context => context.id === 'desk')?.id || data.contexts[0]?.id || 'mine')); window.dispatchEvent(new CustomEvent('staff-navigate', { detail:'workbench' })); } }).catch(() => {});
    return () => { active = false; };
  }, [user?.memberId, user?.account, user?.authVersion]);
  useEffect(() => {
    return initStaffApplication({
      onSession: profile => { setWorkspaceSession(`${profile.memberId || profile.account}:${profile.authVersion}`); setUser(profile); },
      onView: view => { setPage(view); setVisited(current => current.includes(view) ? current : [...current, view]); },
      onLogout: () => { clearWorkspaceState(); setUser(null); setPage(''); setVisited([]); setWorkScene(null); setRosterSection('mine'); setSettingsSection('security'); }
    }).dispose;
  }, []);
  const navigate = view => {
    if (view === 'capacity') { setSettingsSection('capacity'); view = 'settings'; }
    else if (view === 'settings') setSettingsSection('security');
    if (view.startsWith('scene:')) { setWorkScene(view.slice(6)); view = 'workbench'; }
    if (view === 'roster-manage') { setRosterSection('manage'); view = 'roster'; }
    else if (view === 'roster') setRosterSection('mine');
    if (field && view === 'scan') { setWorkScene('repair'); view = 'workbench'; }
    window.dispatchEvent(new CustomEvent('staff-navigate', { detail: view }));
  };
  if (!user) return null;
  const published = new Set((user.navigation || []).map(entry => entry.id));
  const workspaceLinks = [
    ...(field ? field.contexts.map(context => ({ ...context, id: `scene:${context.id}`, group: '今日工作' })) : [{ id: 'workbench', label: '工作台', group: '今日工作' }]),
    ...(field ? [{ id: 'scene:mine', label: '个人中心', group: '我的' }] : []),
    ...(published.has('rosters') ? [{ id: 'roster', label: '班次与排班', group: '我的' }] : []),
    ...(published.has('rosters') && user.grants?.some(grant => grant.permissionCode === 'roster.repair.manage') ? [{ id: 'roster-manage', label: '维修排班管理', group: '值班管理' }] : []),
    ...(field && field.capability['repair.summary.read'] ? [{ id: 'staff', label: '预约记录', group: '今日工作' }] : []),
    ...(published.has('members') ? [{ id: 'members', label: '成员管理', group: '平台管理' }] : []),
    ...(published.has('roles') ? [{ id: 'permissions', label: '授权管理', group: '平台管理' }] : []),
    ...(published.has('attendance') ? [{ id: 'attendance', label: '本人签到记录', group: '我的' }] : []),
    ...(field && ['admin','superadmin'].includes(user.role) ? [{ id: 'stats', label: '统计分析', group: '数据与审计' }, { id: 'users', label: '账号管理', group: '平台管理' }] : []),
    ...(field ? [{ id: 'settings', label: '账号安全', group: '我的' }] : []),
    ...(field && ['admin','superadmin'].includes(user.role) ? [{ id: 'capacity', label: '预约配置', group: '业务管理' }] : [])
  ];
  if (!field) {
    if (page === 'workbench') return <Workbench user={user} onNavigate={navigate} />;
    if (page === 'roster') return <RosterArea user={user} section={rosterSection} />;
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
  const route = (view, child, allowed = true) => allowed && visited.includes(view) ? <ActivityContext.Provider key={view} value={visible(view)}><div className="workspace-route" data-route={view} hidden={!visible(view)} aria-hidden={!visible(view)}>{child}</div></ActivityContext.Provider> : null;
  const fieldRoute = route('workbench', <FieldApp initial={field} active={visible('workbench')} onNavigate={navigate} requestedScene={workScene} onSceneChange={setWorkScene} onContextChange={setField} workspaceLinks={workspaceLinks} />);
  const rosterRoute = route('roster', <RosterArea user={user} section={rosterSection} />, published.has('rosters'));
  const moduleRoutes = [
    route('staff', <Records user={user} />, workspaceLinks.some(entry => entry.id === 'staff')),
    route('stats', <Statistics />, workspaceLinks.some(entry => entry.id === 'stats')),
    route('settings', <AccountSettings user={user} section={settingsSection} />),
    route('users', <Accounts user={user} />, workspaceLinks.some(entry => entry.id === 'users')),
    route('attendance', <main className="field-main workspace-module"><Attendance onNavigate={navigate} /></main>, published.has('attendance')),
    route('members', <main className="field-main workspace-module"><Members user={user} /></main>, published.has('members')),
    route('permissions', <main className="field-main workspace-module"><Permissions user={user} /></main>, published.has('roles')),
  ];
  return <WorkspacePortal key={`${user.memberId || user.account}:${user.authVersion}`}><StaffWorkspace name={user.name || ''} entries={workspaceLinks} active={active} onSelect={navigate}>{fieldRoute}{rosterRoute}{moduleRoutes}</StaffWorkspace></WorkspacePortal>;

}

createRoot(document.getElementById('staff-platform-root')).render(<Root />);
