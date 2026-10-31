import { workspaceModule } from './workspace-module.js';
import { DataFields } from './DataValue';
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
const AttendanceModule = workspaceModule(() => import('./Attendance'), 'Attendance');
const Attendance = AttendanceModule.Page;
const AttendanceManagementModule = workspaceModule(
  () => import('./AttendanceManagement.jsx'),
  'AttendanceManagement'
);
const AttendanceManagement = AttendanceManagementModule.Page;
const AttendanceReportsModule = workspaceModule(
  () => import('./AttendanceReports.jsx'),
  'AttendanceReports'
);
const AttendanceReports = AttendanceReportsModule.Page;
const MembersModule = workspaceModule(() => import('./People.jsx'), 'People');
const Members = MembersModule.Page;
const PermissionsModule = workspaceModule(() => import('./Permissions.jsx'), 'Permissions');
const Permissions = PermissionsModule.Page;
const RosterAreaModule = workspaceModule(() => import('./RosterManager.jsx'), 'RosterArea');
const RosterArea = RosterAreaModule.Page;
import { WorkspaceHeader } from './WorkspaceHeader';
import { StaffWorkspace } from './StaffWorkspace';
const RecordsModule = workspaceModule(() => import('./Records'), 'Records');
const Records = RecordsModule.Page;
import { FieldApp } from './field/FieldApp';
import { ActivityContext } from './field/ui';
const StatisticsModule = workspaceModule(() => import('./Statistics'), 'Statistics');
const Statistics = StatisticsModule.Page;
const AccountSettingsModule = workspaceModule(() => import('./AccountSettings'), 'AccountSettings');
const AccountSettings = AccountSettingsModule.Page;
import {
  staffPermission,
  staffViewAllowed,
  staffSceneAllowed,
  normalizeStaffScene
} from '../../shared/staff-access.js';
const OfficeRosterModule = workspaceModule(() => import('./OfficeRoster'), 'OfficeRoster');
const OfficeRoster = OfficeRosterModule.Page;
const LeaveReviewModule = workspaceModule(() => import('./LeaveReview'), 'LeaveReview');
const LeaveReview = LeaveReviewModule.Page;
import { WorkspacePage } from './WorkspacePage';
import './workspace-foundation.css';

const pageModules = {
  attendance: AttendanceModule,
  'attendance-manage': AttendanceManagementModule,
  reports: AttendanceReportsModule,
  members: MembersModule,
  permissions: PermissionsModule,
  roster: RosterAreaModule,
  'roster-manage': RosterAreaModule,
  'roster-requests': RosterAreaModule,
  staff: RecordsModule,
  stats: StatisticsModule,
  settings: AccountSettingsModule,
  capacity: AccountSettingsModule,
  users: MembersModule,
  'office-roster': OfficeRosterModule,
  'leave-review': LeaveReviewModule
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
            (data.currentRepair
              ? 'repair'
              : data.contexts.find(
                  (context) =>
                    context.id ===
                    normalizeStaffScene(
                      sessionStorage.getItem(`field-scene:${data.actor.memberId}`)
                    )
                )?.id ||
                data.contexts.find((context) => context.id === 'desk')?.id ||
                data.contexts[0]?.id ||
                'mine')
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
    if (view.startsWith('scene:')) view = `scene:${normalizeStaffScene(view.slice(6))}`;
    if (view === 'users') view = 'members';
    if (view === 'report-settings') view = 'reports';
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
  const effectiveUser = { ...user, permissions: field?.permissions || user.permissions };
  const published = new Set((field?.navigation || user.navigation || []).map((entry) => entry.id));
  const publishedView = (id, view) => published.has(id) && staffViewAllowed(effectiveUser, view);
  const workspaceLinks = [
    ...(field?.contexts || [])
      .filter((context) => staffSceneAllowed(effectiveUser, field, context.id))
      .map((context) => ({ ...context, id: `scene:${context.id}`, group: '今日工作' })),
    ...(profile && field ? [{ id: 'scene:mine', label: '个人中心', group: '我的' }] : []),
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
    ...(publishedView('members', 'members') ||
    staffPermission(effectiveUser, 'accounts.manage') ||
    staffPermission(effectiveUser, 'settings.manage')
      ? [{ id: 'members', label: '人员管理', group: '平台管理' }]
      : []),
    ...(publishedView('roles', 'permissions')
      ? [{ id: 'permissions', label: '角色与权限', group: '平台管理' }]
      : []),
    ...(publishedView('attendance', 'attendance')
      ? [{ id: 'attendance', label: '本人签到记录', group: '我的' }]
      : []),
    ...(staffPermission(effectiveUser, 'statistics.read')
      ? [{ id: 'stats', label: '统计分析', group: '数据与审计' }]
      : []),
    ...(staffPermission(effectiveUser, 'attendance.export') ||
    staffPermission(effectiveUser, 'settings.manage')
      ? [
          {
            id: 'reports',
            label: staffPermission(effectiveUser, 'attendance.export') ? '报表导出' : '导出规则',
            group: '数据与审计'
          }
        ]
      : []),
    ...(profile ? [{ id: 'settings', label: '账号安全', group: '我的' }] : []),
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
      <>
        <WorkspaceHeader group="今日工作" title="今日工作" />
        <WorkspacePending
          error={identityError || bootError}
          onRetry={identityError ? onRetryIdentity : () => setBootRetry((value) => value + 1)}
        />
      </>
    )
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
      'attendance-manage',
      <AttendanceManagement user={effectiveUser} />,
      staffPermission(effectiveUser, 'attendance.correct')
    ),
    route(
      'reports',
      <AttendanceReports canExport={staffPermission(effectiveUser, 'attendance.export')} />,
      staffPermission(effectiveUser, 'attendance.export') ||
        staffPermission(effectiveUser, 'settings.manage')
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
            <WorkspaceHeader group="今日工作" title="今日工作" />
            <WorkspacePending error={identityError} onRetry={onRetryIdentity} />
          </main>
        )}
        {fieldRoute}
        {rosterRoute}
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
      ) : code ? (
        <WorkspaceSkeleton label="正在加载页面组件" />
      ) : (
        <section className="field-card">
          <h2>今日工作概况</h2>
          <p className="field-muted">查看到岗状态和当前任务，从对应岗位继续工作。</p>
          <DataFields fields={[['当前岗位'], ['到岗状态'], ['当前任务']]} />
        </section>
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
