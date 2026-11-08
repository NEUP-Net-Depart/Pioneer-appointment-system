import { workspaceModule } from './workspace-module.js';
import { WorkspaceSkeleton } from './WorkspaceSkeleton';
import { UnsavedPageContext } from './useUnsavedChanges.js';
import React, { Suspense, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useStaffIdentity } from './useStaffIdentity.js';
import { StaffLogin, StaffActivation } from './StaffAccess.jsx';
import './base.css';
import { setWorkspaceSession, clearWorkspaceState } from './workspace-state.js';
import './workspace.css';
import { request } from './request.js';
const DutyModule = workspaceModule(() => import('./DutyWorkspace.jsx'), 'DutyWorkspace');
const DutyWorkspace = DutyModule.Page;
const MembersModule = workspaceModule(() => import('./People.jsx'), 'People');
const Members = MembersModule.Page;
const PermissionsModule = workspaceModule(() => import('./Permissions.jsx'), 'Permissions');
const Permissions = PermissionsModule.Page;
import { StaffWorkspace } from './StaffWorkspace';
const RecordsModule = workspaceModule(() => import('./Records'), 'Records');
const Records = RecordsModule.Page;
import { FieldApp } from './field/FieldApp';
import { ActivityContext } from './field/ui';
const StatisticsModule = workspaceModule(() => import('./Statistics'), 'Statistics');
const Statistics = StatisticsModule.Page;
const AccountSettingsModule = workspaceModule(() => import('./AccountSettings'), 'AccountSettings');
const AccountSettings = AccountSettingsModule.Page;
import { staffPermission, staffViewAllowed, staffSceneAllowed } from '../../shared/staff-access.js';
import { WorkspacePage } from './WorkspacePage';
import './workspace-foundation.css';
import './workspace-design.css';
import { workspaceEntry } from './workspace-navigation.js';

const pageModules = {
  duties: DutyModule,
  members: MembersModule,
  permissions: PermissionsModule,
  staff: RecordsModule,
  stats: StatisticsModule,
  settings: AccountSettingsModule,
  capacity: AccountSettingsModule,
  users: MembersModule
};

function Workspace({ profile, identityError, onRetryIdentity, onLogout }) {
  const user = profile || { permissions: {}, navigation: [] };
  const [opening, setOpening] = useState(null);
  const navigationSequence = useRef(0);
  useEffect(
    () => () => {
      navigationSequence.current++;
    },
    []
  );
  const [page, setPage] = useState('duties');
  const [field, setField] = useState(null);
  const [bootError, setBootError] = useState(''),
    [bootRetry, setBootRetry] = useState(0);
  const [workScene, setWorkScene] = useState(null);
  const [visited, setVisited] = useState(['workbench', 'duties']);
  const [settingsSection, setSettingsSection] = useState('security');
  const profileRef = useRef(null);
  profileRef.current = user && { ...user, permissions: field?.permissions || user.permissions };
  useEffect(() => {
    if (!profile) return;
    const currentProfile = { ...user, permissions: field?.permissions || user.permissions };
    const target = page === 'settings' && settingsSection === 'capacity' ? 'capacity' : page;
    if (!staffViewAllowed(currentProfile, target)) {
      setSettingsSection('security');
      setPage('workbench');
      setVisited((current) => [
        ...new Set([
          ...current.filter((view) => staffViewAllowed(currentProfile, view)),
          'workbench'
        ])
      ]);
    }
    if (
      field &&
      page === 'workbench' &&
      workScene &&
      !staffSceneAllowed(currentProfile, field, workScene)
    )
      setWorkScene('mine');
  }, [field, user, profile, page, settingsSection, workScene]);
  useEffect(() => {
    if (!profile) return;
    let active = true;
    const controller = new AbortController();
    setBootError('');
    request('/api/field/home', { signal: controller.signal, timeoutMs: 15000 })
      .then((data) => {
        if (!active) return;
        setField(data);
        setWorkScene(
          (current) =>
            current ||
            data.contexts.find(
              (context) =>
                context.id === sessionStorage.getItem(`field-scene:${data.actor.memberId}`)
            )?.id ||
            data.contexts[0]?.id ||
            'mine'
        );
      })
      .catch((error) => {
        if (active && !controller.signal.aborted)
          setBootError(
            error.name === 'AbortError'
              ? '工作台请求超时，请重试；你也可以先进入其他页面。'
              : error.message
          );
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [user?.memberId, user?.account, user?.authVersion, bootRetry]);
  useEffect(() => {
    if (!profile) return;
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
  }, [profile]);
  useEffect(() => () => clearWorkspaceState(), []);
  const navigate = (view) => {
    if (view === 'users') view = 'members';
    if (
      !profile ||
      !(view.startsWith('scene:')
        ? staffSceneAllowed(profileRef.current, field, view.slice(6))
        : staffViewAllowed(profileRef.current, view))
    )
      return;
    const sequence = ++navigationSequence.current;
    const module = pageModules[view];
    if (module && !module.ready()) {
      setOpening(view);
      // Keep the current page, focus and draft intact while code is in flight.
      // Re-enter the navigation guard afterwards in case the user kept editing.
      module
        .preload()
        .catch(() => {})
        .then(() => {
          if (sequence !== navigationSequence.current) return;
          setOpening(null);
          window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: view }));
        });
      return;
    }
    setOpening(null);
    if (view === 'capacity') {
      setSettingsSection('capacity');
      view = 'settings';
    } else if (view === 'settings') setSettingsSection('security');
    if (view.startsWith('scene:')) {
      setWorkScene(view.slice(6));
      view = 'workbench';
    }
    if (field && view === 'scan') {
      setWorkScene('today');
      view = 'workbench';
    }
    setPage(view);
    setVisited((current) => (current.includes(view) ? current : [...current, view]));
  };
  const requestNavigate = (view) =>
    window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: view }));
  const effectiveUser = { ...user, permissions: field?.permissions || user.permissions };
  const published = new Set((field?.navigation || user.navigation || []).map((entry) => entry.id));
  const publishedView = (id, view) => published.has(id) && staffViewAllowed(effectiveUser, view);
  const workspaceLinks = [
    ...(field?.contexts || [])
      .filter((context) => staffSceneAllowed(effectiveUser, field, context.id))
      .map((context) => ({ ...context, id: `scene:${context.id}` })),
    ...(profile && field ? [{ id: 'scene:mine', label: '个人中心' }] : []),
    ...(staffViewAllowed(effectiveUser, 'duties')
      ? [
          {
            id: 'duties',
            label:
              staffPermission(effectiveUser, 'attendance.correct') ||
              staffPermission(effectiveUser, 'roster.manage')
                ? '值班'
                : '我的值班'
          }
        ]
      : []),
    ...(staffPermission(effectiveUser, 'repair.summary.read')
      ? [{ id: 'staff', label: '预约记录' }]
      : []),
    ...(publishedView('members', 'members') ||
    staffPermission(effectiveUser, 'accounts.manage') ||
    staffPermission(effectiveUser, 'settings.manage')
      ? [{ id: 'members', label: '人员管理' }]
      : []),
    ...(publishedView('roles', 'permissions') ? [{ id: 'permissions', label: '系统权限' }] : []),
    ...(staffPermission(effectiveUser, 'statistics.read')
      ? [{ id: 'stats', label: '统计分析' }]
      : []),
    ...(profile ? [{ id: 'settings', label: '账号安全' }] : []),
    ...(staffPermission(effectiveUser, 'settings.manage')
      ? [{ id: 'capacity', label: '预约配置' }]
      : [])
  ].map(workspaceEntry);
  const active =
    page === 'workbench'
      ? `scene:${workScene}`
      : page === 'settings' && settingsSection === 'capacity'
        ? 'capacity'
        : page;
  // Keep loaded data, filters, selected records and retained drafts mounted.
  // Hidden routes stop polling and device-backed UI.
  const visible = (view) => page === view;
  const route = (view, child, allowed = true) =>
    profile && allowed && staffViewAllowed(effectiveUser, view) && visited.includes(view) ? (
      <ActivityContext.Provider key={view} value={visible(view)}>
        <UnsavedPageContext.Provider value={visible(view)}>
          <WorkspacePage route={view} active={visible(view)}>
            <WorkspaceModuleBoundary>
              <Suspense fallback={<WorkspacePending code />}>{child}</Suspense>
            </WorkspaceModuleBoundary>
          </WorkspacePage>
        </UnsavedPageContext.Provider>
      </ActivityContext.Provider>
    ) : null;
  const fieldRoute = route(
    'workbench',
    field ? (
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
    ) : (
      <WorkspacePending
        error={identityError || bootError}
        onRetry={identityError ? onRetryIdentity : () => setBootRetry((value) => value + 1)}
      />
    )
  );
  const dutyRoute = route(
    'duties',
    <DutyWorkspace user={effectiveUser} initialCampus={field?.campusId} />
  );
  const moduleRoutes = [
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
      'members',
      <section className="workspace-module">
        <Members user={effectiveUser} />
      </section>,
      workspaceLinks.some((entry) => entry.id === 'members')
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
    <div data-workspace-host="true">
      <StaffWorkspace
        loading={!profile || (page === 'workbench' && !field && !bootError)}
        name={user.name || ''}
        entries={workspaceLinks}
        active={active}
        onSelect={navigate}
        onPrepare={(view) => {
          if (profile && staffViewAllowed(profileRef.current, view))
            pageModules[view]?.preload().catch(() => {});
        }}
        opening={workspaceLinks.find((entry) => entry.id === opening)?.label}
        onLogout={onLogout}
      >
        {!profile && (
          <main className="workspace-page">
            <WorkspacePending error={identityError} onRetry={onRetryIdentity} />
          </main>
        )}
        {fieldRoute}
        {dutyRoute}
        {moduleRoutes}
      </StaffWorkspace>
    </div>
  );
}

class WorkspaceModuleBoundary extends React.Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <WorkspacePending
        error="此页面暂时无法加载，请刷新后重试。"
        onRetry={() => window.location.reload()}
      />
    ) : (
      this.props.children
    );
  }
}
function WorkspacePending({ error, onRetry, code = false }) {
  return (
    <section className="workspace-pending" aria-busy={!error} aria-label="工作区内容">
      {error && (
        <p data-motion-value="text" role="alert">
          {error}
        </p>
      )}
      {error ? (
        <button className="field-primary" onClick={onRetry}>
          重新加载工作区
        </button>
      ) : (
        <WorkspaceSkeleton label={code ? '正在加载页面组件' : '正在加载工作区'} />
      )}
    </section>
  );
}
function StaffApp() {
  const identity = useStaffIdentity();
  if (new URLSearchParams(location.search).get('activate') === '1') return <StaffActivation />;
  if (!identity.user && !identity.hasSession)
    return <StaffLogin {...identity} onLogin={identity.login} onRetry={identity.retry} />;
  return (
    <Workspace
      profile={identity.user}
      identityError={identity.error}
      onRetryIdentity={identity.retry}
      onLogout={identity.logout}
    />
  );
}
createRoot(document.getElementById('staff-react-root')).render(<StaffApp />);
