import React, { useContext, useEffect, useState } from 'react';
import { WorkspaceHeader } from './WorkspaceHeader';
import { ActivityContext } from './field/ui';
import { Schedule } from './Schedule.jsx';
import { DutyPlanner } from './DutyPlanner.jsx';
import { AttendanceManagement } from './AttendanceManagement.jsx';
import { AttendanceReports } from './AttendanceReports.jsx';
import { Attendance } from './Attendance';
import { WeeklyAttendanceExport } from './WeeklyAttendanceExport';
import { staffPermission } from '../../shared/staff-access.js';
import { dutyCampusNames } from '../../shared/duty.js';
import './schedule.css';

export function DutyWorkspace({ user, initialCampus }) {
  const active = useContext(ActivityContext);
  const manage = staffPermission(user, 'attendance.correct'),
    plan = staffPermission(user, 'roster.manage'),
    canExport = staffPermission(user, 'attendance.export'),
    settings = staffPermission(user, 'settings.manage');
  const campuses = (user.authorizedCampuses || []).map(
    (value) => ({ 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' })[value] || value
  );
  const [campus, setCampus] = useState(
    initialCampus || { 南湖: 'campus-nanhu', 浑南: 'campus-hunnan' }[user.homeCampus] || campuses[0]
  );
  const [tab, setTab] = useState(manage ? 'today' : plan ? 'plan' : 'mine'),
    [mineDirty, setMineDirty] = useState(false),
    [dayDirty, setDayDirty] = useState(false),
    [planDirty, setPlanDirty] = useState(false),
    [weekly, setWeekly] = useState(false);
  const locked = mineDirty || dayDirty || planDirty;
  useEffect(() => {
    if (initialCampus) setCampus(initialCampus);
  }, [initialCampus]);
  const tabs = [
    ...(manage ? [['today', '今日值班']] : []),
    ...(plan ? [['plan', '安排下周']] : []),
    ['mine', '我的值班'],
    ['history', '统计与历史']
  ];
  const panel = (id, child) => (
    <div role="region" aria-label={tabs.find(([key]) => key === id)?.[1]} hidden={tab !== id}>
      <ActivityContext.Provider value={active && tab === id}>{child}</ActivityContext.Provider>
    </div>
  );
  return (
    <section className="react-page schedule-page duty-workspace">
      <WorkspaceHeader group="排班考勤" title={manage || plan ? '值班' : '我的值班'}>
        {campuses.length > 1 ? (
          <label className="duty-campus-select">
            校区
            <select
              aria-label="值班校区"
              value={campus}
              disabled={locked}
              onChange={(event) => setCampus(event.target.value)}
            >
              {campuses.map((id) => (
                <option key={id} value={id}>
                  {dutyCampusNames[id]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span>{dutyCampusNames[campus]}</span>
        )}
      </WorkspaceHeader>
      <nav className="duty-tabs" aria-label="值班任务">
        {tabs.map(([id, label]) => (
          <button key={id} aria-pressed={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </nav>
      {manage &&
        panel('today', <AttendanceManagement campusId={campus} onDirtyChange={setDayDirty} />)}
      {plan && panel('plan', <DutyPlanner campusId={campus} onDirtyChange={setPlanDirty} />)}
      {panel('mine', <Schedule user={user} campusId={campus} onDirtyChange={setMineDirty} />)}
      {panel(
        'history',
        <>
          {(canExport || settings) && <AttendanceReports canExport={canExport} embedded />}
          {canExport && (
            <div className="schedule-actions">
              <button onClick={() => setWeekly(true)}>按周核算与导出</button>
            </div>
          )}
          <Attendance embedded />
        </>
      )}
      {weekly && active && (
        <WeeklyAttendanceExport
          campuses={campuses.map((id) => ({ id, name: dutyCampusNames[id] }))}
          onClose={() => setWeekly(false)}
        />
      )}
    </section>
  );
}
