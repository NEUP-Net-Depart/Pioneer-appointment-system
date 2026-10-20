import { UnsavedPageContext } from './useUnsavedChanges.js';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useStaffIdentity } from './useStaffIdentity.js';
import { StaffLogin, StaffActivation } from './StaffAccess.jsx';
import './base.css';
import { setWorkspaceSession, clearWorkspaceState } from './workspace-state.js';
import './workspace.css';
import { request } from './request.js';
import { Attendance } from './Attendance';
import { AttendanceManagement } from './AttendanceManagement.jsx';
import { Members } from './Members.jsx';
import { Permissions } from './Permissions.jsx';
import { RosterArea } from './RosterManager.jsx';
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
import { RosterWorkflow } from './RosterWorkflow.jsx';
import './workspace-foundation.css';

function Workspace({ user, onLogout }) {
  const [page, setPage] = useState('workbench');
  const [field, setField] = useState(null);
  const [bootError, setBootError] = useState(''),
    [bootRetry, setBootRetry] = useState(0);
  const [workScene, setWorkScene] = useState(null);
  const [rosterSection, setRosterSection] = useState('mine');
  const [rosterRequestSignal, setRosterRequestSignal] = useState(0);
  const [visited, setVisited] = useState(['workbench']);
  const [settingsSection, setSettingsSection] = useState('security');
  const profileRef = useRef(null);
  profileRef.current = user && { ...user, permissions: field?.permissions || user.permissions };
  useEffect(() => {
    if (!field || !user) return;
    const profile = { ...user, permissions: field.permissions || user.permissions };
    const target =
      page === 'settings' && settingsSection === 'capacity'
        ? 'capacity'
        : page === 'roster' && rosterSection === 'manage'
          ? 'roster-manage'
          : page;
    if (!staffViewAllowed(profile, target)) {
      setSettingsSection('security');
      setRosterSection('mine');
      setPage('workbench');
      setVisited((current) => [
        ...new Set([...current.filter((view) => staffViewAllowed(profile, view)), 'workbench'])
      ]);
    }
    if (page === 'workbench' && workScene && !staffSceneAllowed(profile, field, workScene))
      setWorkScene('mine');
  }, [field, user, page, rosterSection, settingsSection, workScene]);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setBootError('');
    request('/api/field/home', { signal: controller.signal })
      .then((data) => {
        if (!active) return;
        setField(data);
        setWorkScene(
          (current) =>
            current ||
            (data.currentRepair
              ? 'repair'
              : data.contexts.find(
                  (context) =>
                    context.id === sessionStorage.getItem(`field-scene:${data.actor.memberId}`)
                )?.id ||
                data.contexts.find((context) => context.id === 'desk')?.id ||
                data.contexts[0]?.id ||
                'mine')
        );
      })
      .catch((error) => {
        if (active && !controller.signal.aborted) setBootError(error.message);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [user?.memberId, user?.account, user?.authVersion, bootRetry]);
  useEffect(() => {
    setWorkspaceSession(
      `${user.memberId || user.account}:${user.authVersion}:${JSON.stringify(user.permissions || {})}`
    );
    setField((current) =>
      current
        ? {
            ...current,
            permissions: user.permissions,
            navigation: user.navigation,
            contexts: current.contexts.filter((context) =>
              staffSceneAllowed(user, current, context.id)
            ),
            capability: Object.fromEntries(
              Object.entries(current.capability).map(([code, allowed]) => [
                code,
                allowed && staffPermission(user, code)
              ])
            )
          }
        : current
    );
  }, [user]);
  useEffect(() => () => clearWorkspaceState(), []);
  const navigate = (view) => {
    if (
      field &&
      !(view.startsWith('scene:')
        ? staffSceneAllowed(profileRef.current, field, view.slice(6))
        : staffViewAllowed(profileRef.current, view))
    )
      return;
    if (view === 'roster-requests') {
      setRosterRequestSignal((value) => value + 1);
      view = 'roster';
    }
    if (view === 'capacity') {
      setSettingsSection('capacity');
      view = 'settings';
    } else if (view === 'settings') setSettingsSection('security');
    if (view.startsWith('scene:')) {
      setWorkScene(view.slice(6));
      view = 'workbench';
    }
    if (view === 'roster-manage') {
      setRosterSection('manage');
      view = 'roster';
    } else if (view === 'roster') setRosterSection('mine');
    if (field && view === 'scan') {
      setWorkScene('repair');
      view = 'workbench';
    }
    setPage(view);
    setVisited((current) => (current.includes(view) ? current : [...current, view]));
  };
  const requestNavigate = (view) =>
    window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: view }));
  if (!field)
    return (
      <WorkspaceBootstrap
        error={bootError}
        onRetry={() => {
          setBootError('');
          setBootRetry((value) => value + 1);
        }}
        onLogout={onLogout}
      />
    );
  const effectiveUser = { ...user, permissions: field?.permissions || user.permissions };
  const published = new Set((field?.navigation || user.navigation || []).map((entry) => entry.id));
  const publishedView = (id, view) => published.has(id) && staffViewAllowed(effectiveUser, view);
  const workspaceLinks = [
    ...field.contexts
      .filter((context) => staffSceneAllowed(effectiveUser, field, context.id))
      .map((context) => ({ ...context, id: `scene:${context.id}`, group: '今日工作' })),
    { id: 'scene:mine', label: '个人中心', group: '我的' },
    ...(publishedView('rosters', 'roster')
      ? [{ id: 'roster', label: '班次与排班', group: '我的' }]
      : []),
    ...(staffPermission(effectiveUser, 'roster.repair.manage') ||
    staffPermission(effectiveUser, 'roster.repair.configure')
      ? [{ id: 'roster-manage', label: '维修排班管理', group: '值班管理' }]
      : []),
    ...(staffPermission(effectiveUser, 'roster.office.manage')
      ? [{ id: 'office-roster', label: '办公排班管理', group: '值班管理' }]
      : []),
    ...(staffPermission(effectiveUser, 'leave.review')
      ? [{ id: 'leave-review', label: '请假审批', group: '值班管理' }]
      : []),
    ...(staffPermission(effectiveUser, 'attendance.correct')
      ? [{ id: 'attendance-manage', label: '考勤核查', group: '值班管理' }]
      : []),
    ...(staffPermission(effectiveUser, 'repair.summary.read')
      ? [{ id: 'staff', label: '预约记录', group: '今日工作' }]
      : []),
    ...(publishedView('members', 'members')
      ? [{ id: 'members', label: '成员管理', group: '平台管理' }]
      : []),
    ...(publishedView('roles', 'permissions')
      ? [{ id: 'permissions', label: '授权管理', group: '平台管理' }]
      : []),
    ...(publishedView('attendance', 'attendance')
      ? [{ id: 'attendance', label: '本人签到记录', group: '我的' }]
      : []),
    ...(staffPermission(effectiveUser, 'statistics.read')
      ? [{ id: 'stats', label: '统计分析', group: '数据与审计' }]
      : []),
    ...(staffPermission(effectiveUser, 'accounts.manage')
      ? [{ id: 'users', label: '账号管理', group: '平台管理' }]
      : []),
    { id: 'settings', label: '账号安全', group: '我的' },
    ...(staffPermission(effectiveUser, 'settings.manage')
      ? [{ id: 'capacity', label: '预约配置', group: '业务管理' }]
      : [])
  ];
  const active =
    page === 'workbench'
      ? `scene:${workScene}`
      : page === 'roster' && rosterSection === 'manage'
        ? 'roster-manage'
        : page === 'settings' && settingsSection === 'capacity'
          ? 'capacity'
          : page;
  // Keep loaded data, filters and selected records mounted. Navigation resolves
  // unsaved edits first; hidden routes stop polling and device-backed UI.
  const visible = (view) => page === view;
  const route = (view, child, allowed = true) =>
    allowed && staffViewAllowed(effectiveUser, view) && visited.includes(view) ? (
      <ActivityContext.Provider key={view} value={visible(view)}>
        <UnsavedPageContext.Provider value={visible(view)}>
          <WorkspacePage route={view} active={visible(view)}>
            {child}
          </WorkspacePage>
        </UnsavedPageContext.Provider>
      </ActivityContext.Provider>
    ) : null;
  const fieldRoute = route(
    'workbench',
    <FieldApp
      initial={field}
      active={visible('workbench')}
      onNavigate={requestNavigate}
      onLogout={() => requestNavigate('__logout__')}
      requestedScene={workScene}
      onSceneChange={setWorkScene}
      onContextChange={setField}
      workspaceLinks={workspaceLinks}
    />
  );
  const rosterRoute = route(
    'roster',
    <RosterArea user={effectiveUser} section={rosterSection} requestSignal={rosterRequestSignal} />,
    published.has('rosters') ||
      staffPermission(effectiveUser, 'roster.repair.manage') ||
      staffPermission(effectiveUser, 'roster.repair.configure')
  );
  const moduleRoutes = [
    route(
      'leave-review',
      <LeaveReview user={effectiveUser} onNavigate={requestNavigate} />,
      staffPermission(effectiveUser, 'leave.review')
    ),
    route(
      'office-roster',
      <section className="roster-area">
        <OfficeRoster user={effectiveUser} />
      </section>,
      staffPermission(effectiveUser, 'roster.office.manage')
    ),
    route(
      'staffing',
      <RosterWorkflow user={effectiveUser} />,
      staffPermission(effectiveUser, 'roster.repair.configure')
    ),
    route(
      'attendance-manage',
      <AttendanceManagement user={effectiveUser} />,
      staffPermission(effectiveUser, 'attendance.correct')
    ),
    route(
      'staff',
      <Records user={effectiveUser} />,
      workspaceLinks.some((entry) => entry.id === 'staff')
    ),
    route(
      'stats',
      <Statistics />,
      workspaceLinks.some((entry) => entry.id === 'stats')
    ),
    route(
      'settings',
      <AccountSettings
        user={effectiveUser}
        section={settingsSection}
        onNavigate={requestNavigate}
      />
    ),
    route(
      'users',
      <Accounts user={user} />,
      workspaceLinks.some((entry) => entry.id === 'users')
    ),
    route(
      'attendance',
      <section className="workspace-module">
        <Attendance onNavigate={requestNavigate} />
      </section>,
      published.has('attendance')
    ),
    route(
      'members',
      <section className="workspace-module">
        <Members user={effectiveUser} />
      </section>,
      published.has('members')
    ),
    route(
      'permissions',
      <section className="workspace-module">
        <Permissions user={user} />
      </section>,
      published.has('roles')
    )
  ];
  return (
    <div data-workspace-host="true" key={`${user.memberId || user.account}:${user.authVersion}`}>
      <StaffWorkspace
        name={user.name || ''}
        entries={workspaceLinks}
        active={active}
        onSelect={navigate}
        onLogout={onLogout}
      >
        {fieldRoute}
        {rosterRoute}
        {moduleRoutes}
      </StaffWorkspace>
    </div>
  );
}

function WorkspaceBootstrap({ error, onRetry, onLogout }) {
  return (
    <div data-workspace-host="true">
      <div className="field-app workspace-bootstrap">
        <main className="field-main">
          <WorkspaceHeader
            group="工作人员平台"
            title={error ? '工作区暂时不可用' : '正在准备工作区'}
            description="正在加载你的岗位、授权范围与当前任务。"
          />
          <section className="field-card">
            <p role="status">{error || '请稍候，工作区准备完成后将自动进入。'}</p>
            {!error && (
              <div className="workspace-skeleton" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            )}
            <div className="field-actions">
              {error && (
                <button className="field-primary" onClick={onRetry}>
                  重新加载工作区
                </button>
              )}
              <button onClick={onLogout}>退出登录</button>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
function StaffApp() {
  const identity = useStaffIdentity();
  if (new URLSearchParams(location.search).get('activate') === '1') return <StaffActivation />;
  if (!identity.user && identity.hasSession)
    return (
      <WorkspaceBootstrap
        error={identity.error}
        onRetry={identity.retry}
        onLogout={identity.logout}
      />
    );
  if (!identity.user)
    return <StaffLogin {...identity} onLogin={identity.login} onRetry={identity.retry} />;
  return <Workspace key={identity.user.account} user={identity.user} onLogout={identity.logout} />;
}
createRoot(document.getElementById('staff-react-root')).render(<StaffApp />);
