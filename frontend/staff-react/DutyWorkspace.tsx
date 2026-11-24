import type { ReactNode } from 'react';
import type { StaffProfileDto } from '../../shared/staff-types.ts';
import type { DutyFocus } from './management-types.ts';

const campusIds: Partial<Record<string, string>> = { 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' };
import { failureFrom } from '../../shared/api-types.ts';
import { useContext, useEffect, useState } from 'react';
import { WorkspaceHeader } from './WorkspaceHeader';
import { ActivityContext } from './field/ui';
import { Schedule } from './Schedule.tsx';
import { DutyPlanner } from './DutyPlanner.tsx';
import { AttendanceManagement } from './AttendanceManagement.tsx';
import { AttendanceReports } from './AttendanceReports.tsx';
import { CampusScope } from './CampusScope.tsx';
import { WorkspaceSections } from './WorkspaceSections';
import { UnsavedChangesDialog } from './UnsavedChangesDialog';
import { pendingEditors } from './useUnsavedChanges.ts';
import { staffPermission } from '../../shared/staff-access.ts';
import { dutyCampusName } from '../../shared/duty.ts';
import './schedule.css';

export function DutyWorkspace({
  user,
  initialCampus,
  focus
}: {
  user: StaffProfileDto;
  initialCampus?: string;
  focus?: DutyFocus | null;
}) {
  const active = useContext(ActivityContext);
  const manage = staffPermission(user, 'attendance.correct'),
    plan = staffPermission(user, 'roster.manage'),
    canExport = staffPermission(user, 'attendance.export'),
    settings = staffPermission(user, 'settings.manage');
  const staffing = manage || staffPermission(user, 'attendance.token.issue');
  const campuses = (user.authorizedCampuses || []).map((value) => campusIds[value] || value);
  const preferred =
    [initialCampus, campusIds[user.homeCampus], campuses[0]].find(
      (id): id is string => typeof id === 'string' && campuses.includes(id)
    ) ?? '';
  const [scopes, setScopes] = useState({ today: preferred, plan: preferred });
  const [historyFocus, setHistoryFocus] = useState<DutyFocus | null>(null);
  const campusFor = (task: keyof typeof scopes) =>
    campuses.includes(scopes[task]) ? scopes[task] : preferred;
  const [tab, setTab] = useState(staffing ? 'today' : plan ? 'plan' : 'mine'),
    [, setMineDirty] = useState(false),
    [dayDirty, setDayDirty] = useState(false),
    [planDirty, setPlanDirty] = useState(false),
    [pendingNavigation, setPendingNavigation] = useState<{
      next: () => void;
      editor: ReturnType<typeof pendingEditors>[number];
    } | null>(null),
    [navigationBusy, setNavigationBusy] = useState(false),
    [navigationError, setNavigationError] = useState('');
  function navigateFromPlan(next: () => void) {
    if (pendingNavigation) return;
    if (tab !== 'plan' || !planDirty) {
      next();
      return;
    }
    const [editor] = pendingEditors();
    if (!editor) return;
    setNavigationError('');
    setPendingNavigation({ next, editor });
  }
  async function resolveNavigation(save: boolean) {
    if (navigationBusy || !pendingNavigation) return;
    const { editor, next } = pendingNavigation;
    setNavigationBusy(true);
    setNavigationError('');
    try {
      if (save) {
        if ((await editor.save()) !== true) throw new Error('班表尚未发布，请检查草稿。');
      } else editor.discard();
      setPendingNavigation(null);
      next();
    } catch (errorValue) {
      const error = failureFrom(errorValue);
      setNavigationError(error.message);
    } finally {
      setNavigationBusy(false);
    }
  }
  useEffect(() => {
    if (!active || !focus || !staffing || !campuses.includes(focus.campusId)) return;
    setHistoryFocus(null);
    setScopes((current) => ({ ...current, today: focus.campusId }));
    setTab('today');
  }, [active, focus, staffing]);
  const scope = (task: keyof typeof scopes, disabled?: boolean) => (
    <CampusScope
      data-track="staff.dutyworkspace.select.1"
      label={task === 'today' ? '考勤校区' : '排班校区'}
      campuses={campuses.map((id: string) => ({ id, name: dutyCampusName(id) || id }))}
      value={campusFor(task)}
      disabled={disabled}
      onChange={(id) => {
        if (id === campusFor(task)) return;
        const apply = () => setScopes((current) => ({ ...current, [task]: id }));
        if (task === 'plan') navigateFromPlan(apply);
        else apply();
      }}
    />
  );
  const tabs = [
    ...(staffing ? [['today', '今日值班']] : []),
    ...(plan ? [['plan', '安排下周']] : []),
    ['mine', '我的值班'],
    ...(canExport || settings ? [['history', '统计与历史']] : [])
  ];
  const panel = (id: string, child: ReactNode) => (
    <div role="region" aria-label={tabs.find(([key]) => key === id)?.[1]} hidden={tab !== id}>
      <ActivityContext.Provider value={active && tab === id}>{child}</ActivityContext.Provider>
    </div>
  );
  return (
    <section className="react-page schedule-page duty-workspace">
      <WorkspaceHeader group="排班考勤" title={staffing || plan ? '值班' : '我的值班'} />
      <WorkspaceSections
        label="值班任务"
        items={tabs.map(([id, label]) => ({ id, label }))}
        value={tab}
        onChange={(id) => {
          if (id !== tab) navigateFromPlan(() => setTab(id));
        }}
      />
      {staffing &&
        panel(
          'today',
          <>
            <AttendanceManagement
              focus={historyFocus || focus}
              campusId={campusFor('today')}
              onDirtyChange={setDayDirty}
              campusControl={scope('today', dayDirty)}
            />
          </>
        )}
      {plan &&
        panel(
          'plan',
          <>
            <DutyPlanner
              campusId={campusFor('plan')}
              onDirtyChange={setPlanDirty}
              onNavigate={navigateFromPlan}
              campusControl={scope('plan')}
            />
          </>
        )}
      {panel('mine', <Schedule user={user} campusId={preferred} onDirtyChange={setMineDirty} />)}
      {(canExport || settings) &&
        panel(
          'history',
          <>
            <AttendanceReports
              user={user}
              canExport={canExport}
              onOpenDay={
                staffing
                  ? (target) => {
                      setScopes((current) => ({ ...current, today: target.campusId }));
                      setHistoryFocus({ ...target, id: crypto.randomUUID(), kind: 'history' });
                      setTab('today');
                    }
                  : undefined
              }
              embedded
              campuses={campuses.map((id: string) => ({ id, name: dutyCampusName(id) || id }))}
            />
          </>
        )}
      {pendingNavigation && (
        <UnsavedChangesDialog
          busy={navigationBusy}
          error={navigationError}
          message={
            pendingNavigation.editor.canSave
              ? '继续前将发布当前排班调整。'
              : pendingNavigation.editor.leaveMessage
          }
          saveLabel={pendingNavigation.editor.saveLabel}
          onCancel={() => setPendingNavigation(null)}
          onDiscard={() => void resolveNavigation(false)}
          onSave={pendingNavigation.editor.canSave ? () => void resolveNavigation(true) : undefined}
        />
      )}
    </section>
  );
}
