import type { ReactNode } from 'react';
import type { StaffProfileDto } from '../../shared/staff-types.ts';
import { failureFrom } from '../../shared/api-types.ts';
import type { Home } from './field/types.ts';

interface DutyFocus {
  id: string;
  campusId: string;
  kind: string;
  businessDate?: string;
  memberId?: string;
}
interface WorkspaceProps {
  profile?: StaffProfileDto | null;
  identityError: string;
  onRetryIdentity: () => unknown;
  onLogout: () => void;
}

import { reportClientError, trackPage } from '../../shared/telemetry-client.ts';
import './web-update.ts';
import { workspaceModule } from './workspace-module.ts';
import { QueryCache, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { createQueryClient } from './query-client.ts';
import { UnsavedPageContext } from './useUnsavedChanges.ts';
import React, { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useStaffIdentity } from './useStaffIdentity.ts';
import { StaffLogin, StaffActivation } from './StaffAccess.tsx';
import './base.css';
import './workspace.css';
const DutyModule = workspaceModule(() => import('./DutyWorkspace.tsx'), 'DutyWorkspace');
const DutyWorkspace = DutyModule.Page;
const MembersModule = workspaceModule(() => import('./People.tsx'), 'People');
const Members = MembersModule.Page;
const PermissionsModule = workspaceModule(() => import('./Permissions.tsx'), 'Permissions');
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
import { staffPermission, staffViewAllowed, staffSceneAllowed } from '../../shared/staff-access.ts';
import { WorkspacePage } from './WorkspacePage';
import './workspace-foundation.css';
import './workspace-design.css';
import './workspace-mobile.css';
import { workspaceEntry } from './workspace-navigation.ts';

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

function Workspace({ profile, identityError, onRetryIdentity, onLogout }: WorkspaceProps) {
  const user: StaffProfileDto = profile || {
    account: '',
    memberId: '',
    name: '',
    role: 'technician',
    status: 'disabled',
    homeCampus: '',
    authorizedCampuses: [],
    authVersion: 0,
    permissions: {},
    navigation: []
  };
  const [opening, setOpening] = useState<string | null>(null);
  const navigationSequence = useRef(0);
  useEffect(
    () => () => {
      navigationSequence.current++;
    },
    []
  );
  const [page, setPage] = useState('workbench');
  const [fieldSelection, setFieldSelection] = useState({
    resource: '/api/field/home',
    campusId: ''
  });
  const home = useQuery<Home>({
    queryKey: ['/api/field/home'],
    enabled: !fieldSelection.campusId,
    refetchInterval: false
  });
  const context = useQuery<Home>({
    queryKey: fieldSelection.campusId
      ? [fieldSelection.resource, { campusId: fieldSelection.campusId }]
      : ['/api/field/home'],
    enabled: false
  });
  const field = context.data || home.data;
  const [dutyFocus, setDutyFocus] = useState<DutyFocus | null>(null);
  const selectField = useCallback(
    (resource: string, campusId: string) =>
      setFieldSelection((current) =>
        current.resource === resource && current.campusId === campusId
          ? current
          : { resource, campusId }
      ),
    []
  );
  const [workScene, setWorkScene] = useState<string | null>(null);
  const [visited, setVisited] = useState(['workbench', 'duties']);
  const [settingsSection, setSettingsSection] = useState('security');
  useEffect(() => {
    trackPage(
      'staff.' +
        (page === 'workbench'
          ? workScene || 'workbench'
          : page === 'settings' && settingsSection === 'capacity'
            ? 'capacity'
            : page)
    );
  }, [page, workScene, settingsSection]);
  const profileRef = useRef<StaffProfileDto | null>(null);
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
    const available = home.data;
    if (!available) return;
    setWorkScene(
      (current) =>
        current ||
        available.contexts.find((context) => context.id === 'today')?.id ||
        available.contexts[0]?.id ||
        'mine'
    );
  }, [home.data]);
  const navigate = (view: string) => {
    if (view === 'users') view = 'members';
    if (
      !profile ||
      !(view.startsWith('scene:')
        ? staffSceneAllowed(profileRef.current, field, view.slice(6))
        : staffViewAllowed(profileRef.current, view))
    )
      return;
    const sequence = ++navigationSequence.current;
    const module = pageModules[view as keyof typeof pageModules];
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
  const requestNavigate = (view: string) =>
    window.dispatchEvent(new CustomEvent('staff-request-navigation', { detail: view }));
  const effectiveUser = { ...user, permissions: field?.permissions || user.permissions };
  const published = new Set((field?.navigation || user.navigation || []).map((entry) => entry.id));
  const publishedView = (id: string, view: string) =>
    published.has(id) && staffViewAllowed(effectiveUser, view);
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
    ...(publishedView('members', 'members') || staffPermission(effectiveUser, 'accounts.manage')
      ? [{ id: 'members', label: '人员管理' }]
      : []),
    ...(publishedView('roles', 'permissions') ? [{ id: 'permissions', label: '系统权限' }] : []),
    ...(staffPermission(effectiveUser, 'statistics.read')
      ? [{ id: 'stats', label: '统计分析' }]
      : []),
    ...(profile ? [{ id: 'settings', label: '账号安全' }] : []),
    ...(staffPermission(effectiveUser, 'booking.manage')
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
  const visible = (view: string) => page === view;
  const route = (view: string, child: ReactNode, allowed = true) =>
    profile && allowed && staffViewAllowed(effectiveUser, view) && visited.includes(view) ? (
      <ActivityContext.Provider key={view} value={visible(view)}>
        <UnsavedPageContext.Provider value={visible(view)}>
          <WorkspacePage route={view} active={visible(view)}>
            <WorkspaceModuleBoundary>
              <Suspense fallback={<WorkspacePending />}>{child}</Suspense>
            </WorkspaceModuleBoundary>
          </WorkspacePage>
        </UnsavedPageContext.Provider>
      </ActivityContext.Provider>
    ) : null;
  const fieldRoute = route(
    'workbench',
    field ? (
      <FieldApp
        key={`${field.actor.memberId}:${field.authVersion}`}
        initial={field}
        active={visible('workbench')}
        onNavigate={requestNavigate}
        onPeople={(campusId, kind) => {
          setDutyFocus({ campusId, kind, id: crypto.randomUUID() });
          requestNavigate('duties');
        }}
        onLogout={() => requestNavigate('__logout__')}
        requestedScene={workScene}
        onSceneChange={setWorkScene}
        onContextChange={selectField}
        workspaceLinks={workspaceLinks}
      />
    ) : (
      <WorkspacePending
        error={identityError || home.error?.message}
        onRetry={identityError ? onRetryIdentity : () => home.refetch()}
      />
    )
  );
  const dutyRoute = route(
    'duties',
    <DutyWorkspace user={effectiveUser} initialCampus={field?.campusId} focus={dutyFocus} />
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
        <Permissions />
      </section>,
      published.has('roles')
    )
  ];
  return (
    <div data-workspace-host="true">
      <StaffWorkspace
        loading={!profile || (page === 'workbench' && !field && !home.error)}
        name={user.name || ''}
        entries={workspaceLinks}
        active={active}
        onSelect={navigate}
        onPrepare={(view) => {
          if (profile && staffViewAllowed(profileRef.current, view))
            pageModules[view as keyof typeof pageModules]?.preload().catch(() => {});
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

class WorkspaceModuleBoundary extends React.Component<{ children: ReactNode }> {
  state = { failed: false };
  componentDidCatch(error: Error) {
    reportClientError(error, 'REACT_RENDER_ERROR');
  }
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
function WorkspacePending({ error, onRetry }: { error?: string; onRetry?: () => unknown }) {
  return (
    <section
      className={`workspace-pending${!error ? ' workspace-pending-code' : ''}`}
      aria-busy={!error}
      aria-label="工作区内容"
    >
      {error && (
        <p data-motion-value="text" role="alert">
          {error}
        </p>
      )}
      {error ? (
        <button data-track="staff.main.button.1" className="field-primary" onClick={onRetry}>
          重新加载工作区
        </button>
      ) : (
        <div className="workspace-code-progress" aria-hidden="true">
          <span />
        </div>
      )}
    </section>
  );
}
function WorkspaceSession({ identity }: { identity: ReturnType<typeof useStaffIdentity> }) {
  const [accessError, setAccessError] = useState('');
  const [client] = useState(() =>
    createQueryClient({
      queryCache: new QueryCache({
        onError: (caught, query) => {
          const error = failureFrom(caught);
          if (error.status !== 403) return;
          if (
            query.queryKey[0] === 'attendance-confirmation' &&
            error.code === 'ATTENDANCE_CHECK_IN_DENIED'
          ) {
            void identity.retry();
            return;
          }
          // Hide every mounted route before another authorization scope can render.
          client.clear();
          setAccessError(error.message);
          void identity.retry();
        }
      })
    })
  );
  useLayoutEffect(() => () => client.clear(), [client]);
  return (
    <QueryClientProvider client={client}>
      {accessError ? (
        <WorkspacePending
          error={accessError}
          onRetry={async () => {
            await identity.retry();
            setAccessError('');
          }}
        />
      ) : (
        <Workspace
          profile={identity.user}
          identityError={identity.error}
          onRetryIdentity={identity.retry}
          onLogout={identity.logout}
        />
      )}
    </QueryClientProvider>
  );
}
function StaffApp() {
  const identity = useStaffIdentity();
  useEffect(() => {
    if (new URLSearchParams(location.search).get('activate') === '1') trackPage('staff.activation');
    else if (!identity.user) trackPage('staff.login');
  }, [identity.user]);
  if (new URLSearchParams(location.search).get('activate') === '1') return <StaffActivation />;
  if (!identity.user && !identity.hasSession)
    return <StaffLogin {...identity} onLogin={identity.login} onRetry={identity.retry} />;
  if (!identity.user) return <WorkspacePending error={identity.error} onRetry={identity.retry} />;
  const user = identity.user;
  const scope = JSON.stringify([
    user.account,
    user.memberId,
    user.authVersion,
    user.role,
    user.permissions,
    user.authorizedCampuses,
    user.memberships
  ]);
  return <WorkspaceSession key={scope} identity={identity} />;
}
const identityClient = createQueryClient();
const mount = document.getElementById('staff-react-root');
if (!mount) throw new Error('Missing staff application root');
createRoot(mount).render(
  <WorkspaceModuleBoundary>
    <QueryClientProvider client={identityClient}>
      <StaffApp />
    </QueryClientProvider>
  </WorkspaceModuleBoundary>
);
