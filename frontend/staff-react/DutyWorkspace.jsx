import React, { useContext, useEffect, useState } from 'react';
import { WorkspaceHeader } from './WorkspaceHeader';
import { ActivityContext } from './field/ui';
import { Schedule } from './Schedule.jsx';
import { DutyPlanner } from './DutyPlanner.jsx';
import { AttendanceManagement } from './AttendanceManagement.jsx';
import { AttendanceReports } from './AttendanceReports.jsx';
import { CampusScope } from './CampusScope.jsx';
import { WorkspaceSections } from './WorkspaceSections';
import { staffPermission } from '../../shared/staff-access.js';
import { dutyCampusNames } from '../../shared/duty.js';
import './schedule.css';

export function DutyWorkspace({ user, initialCampus, focus }) {
  const active = useContext(ActivityContext);
  const manage = staffPermission(user, 'attendance.correct'),
    plan = staffPermission(user, 'roster.manage'),
    canExport = staffPermission(user, 'attendance.export'),
    settings = staffPermission(user, 'settings.manage');
  const staffing = manage || staffPermission(user, 'attendance.token.issue');
  const campuses = (user.authorizedCampuses || []).map(
    (value) => ({ 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' })[value] || value
  );
  const preferred = [
    initialCampus,
    { 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' }[user.homeCampus],
    campuses[0]
  ].find((id) => campuses.includes(id));
  const [scopes, setScopes] = useState({ today: preferred, plan: preferred });
  const [historyFocus, setHistoryFocus] = useState(null);
  const campusFor = (task) => (campuses.includes(scopes[task]) ? scopes[task] : preferred);
  const [tab, setTab] = useState(staffing ? 'today' : plan ? 'plan' : 'mine'),
    [, setMineDirty] = useState(false),
    [dayDirty, setDayDirty] = useState(false),
    [planDirty, setPlanDirty] = useState(false);
  useEffect(() => {
    if (!active || !focus || !staffing || !campuses.includes(focus.campusId)) return;
    setHistoryFocus(null);
    setScopes((current) => ({ ...current, today: focus.campusId }));
    setTab('today');
  }, [active, focus, staffing]);
  const scope = (task, disabled) => (
    <CampusScope
      data-track="staff.dutyworkspace.select.1"
      label={task === 'today' ? '考勤校区' : '排班校区'}
      campuses={campuses.map((id) => ({ id, name: dutyCampusNames[id] }))}
      value={campusFor(task)}
      disabled={disabled}
      onChange={(id) => setScopes((current) => ({ ...current, [task]: id }))}
    />
  );
  const tabs = [
    ...(staffing ? [['today', '今日值班']] : []),
    ...(plan ? [['plan', '安排下周']] : []),
    ['mine', '我的值班'],
    ...(canExport || settings ? [['history', '统计与历史']] : [])
  ];
  const panel = (id, child) => (
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
        onChange={setTab}
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
              campusControl={scope('plan', planDirty)}
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
              campuses={campuses.map((id) => ({ id, name: dutyCampusNames[id] }))}
            />
          </>
        )}
    </section>
  );
}
