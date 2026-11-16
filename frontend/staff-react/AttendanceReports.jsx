import { track } from '../../shared/telemetry-client.js';
import React, { useContext, useState } from 'react';
import { ActivityContext } from './field/ui';
import { WorkspaceHeader } from './WorkspaceHeader';
import { AttendanceReportSettings } from './AttendanceReportSettings.jsx';
import { CampusScope } from './CampusScope.jsx';
import { DatePicker } from './SelectionControls.jsx';
import { RefreshButton } from './WorkspaceToolbar.jsx';
import { WeeklyAttendanceExport } from './WeeklyAttendanceExport.jsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dateKey } from '../../shared/time.js';
import { AttendanceHistory } from './AttendanceHistory.jsx';
import { MemberEditor } from './MemberEditor.jsx';
import { staffPermission } from '../../shared/staff-access.js';

const monthNow = () => dateKey().slice(0, 7);

function MonthPicker({ value, onChange }) {
  return (
    <label className="report-month-picker">
      月份
      <DatePicker
        data-track="staff.attendancereports.button.2"
        mode="month"
        value={value}
        min="2000-01"
        max="2100-12"
        required
        label="选择报表月份"
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function download(bytes, filename, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.setAttribute('data-track', 'staff.attendancereports.dynamic.download');
  link.href = url;
  link.download = filename;
  link.click();
  track('flow.result', { control: 'staff.attendancereports.dynamic.download', result: 'ok' });
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AttendanceReports({
  user,
  canExport = true,
  embedded = false,
  campuses = [],
  onOpenDay
}) {
  const active = useContext(ActivityContext);
  const [month, setMonth] = useState(monthNow);
  const [chosenCampus, setCampusId] = useState('');
  const campusId =
    campuses.length === 1
      ? campuses[0].id
      : campuses.some((campus) => campus.id === chosenCampus)
        ? chosenCampus
        : '';
  const [weekly, setWeekly] = useState(false);
  const [tab, setTab] = useState('volunteer');
  const client = useQueryClient();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [editingMember, setEditingMember] = useState(null);
  const result = useQuery({
    queryKey: [
      tab === 'volunteer' ? '/api/attendance/volunteer-report' : '/api/attendance/matrix',
      { month, ...(campusId ? { campusId } : {}) }
    ],
    enabled: canExport && active
  });
  const report = result.data;
  const busy = result.isPending;
  const missing =
    tab === 'volunteer'
      ? report?.weeks.flatMap((week) =>
          week.campuses.flatMap((campus) =>
            campus.rows.filter((row) => !row.college || !row.studentId)
          )
        ) || []
      : [];
  const missingPeople = [...new Map(missing.map((row) => [row.memberId, row])).values()];
  async function refreshMemberReports() {
    await client.invalidateQueries({
      predicate: (query) =>
        String(query.queryKey[0]).startsWith('/api/members') ||
        [
          '/api/attendance/volunteer-report',
          '/api/attendance/weekly-summary',
          '/api/me/volunteer-summary'
        ].includes(query.queryKey[0])
    });
  }
  const totalRows =
    tab === 'volunteer'
      ? report?.weeks.reduce(
          (count, week) =>
            count + week.campuses.reduce((sum, campus) => sum + campus.rows.length, 0),
          0
        ) || 0
      : report?.rows.length || 0;
  async function exportFile(selectedReport = report) {
    if (!report || busy || downloading || missing.length) return;
    setDownloading(true);
    setError('');
    try {
      const builders = await import('./report-xlsx.js');
      if (tab === 'volunteer') {
        const templateResponse = await fetch('/assets/volunteer-register-template.xlsx');
        if (!templateResponse.ok) throw new Error('志愿登记表模板加载失败，请重试');
        const template = new Uint8Array(await templateResponse.arrayBuffer());
        download(
          builders.volunteerZip(report, template),
          `先锋志愿登记表-${month}.zip`,
          'application/zip'
        );
      } else {
        download(
          builders.attendanceMatrixWorkbook(selectedReport),
          `考勤记录-${month}.xlsx`,
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setDownloading(false);
    }
  }
  return (
    <section className="react-page attendance-reports" data-view={tab}>
      {!embedded && (
        <WorkspaceHeader group="排班考勤" title={canExport ? '报表导出' : '导出规则'} />
      )}
      {canExport && (
        <>
          <div className="report-type-switch" role="group" aria-label="报表类型">
            <button
              data-track="staff.attendancereports.button.8"
              type="button"
              aria-pressed={tab === 'volunteer'}
              onClick={() => {
                if (tab !== 'volunteer') {
                  setTab('volunteer');
                }
              }}
            >
              志愿时长
            </button>
            <button
              data-track="staff.attendancereports.button.9"
              type="button"
              aria-pressed={tab === 'matrix'}
              onClick={() => {
                if (tab !== 'matrix') {
                  setTab('matrix');
                }
              }}
            >
              考勤记录
            </button>
          </div>
          <div hidden={tab !== 'volunteer'}>
            <AttendanceReportSettings
              active={active && tab === 'volunteer'}
              onSaved={() => {
                Promise.all(
                  [
                    '/api/attendance/volunteer-report',
                    '/api/attendance/matrix',
                    '/api/me/volunteer-summary'
                  ].map((path) => client.invalidateQueries({ queryKey: [path] }))
                );
              }}
            />
          </div>
          <div className="report-controls">
            <MonthPicker
              value={month}
              onChange={(value) => {
                setMonth(value);
              }}
            />
            <CampusScope
              data-track="staff.attendancereports.campusscope.12"
              label="报表校区"
              value={campusId}
              campuses={
                campuses.length > 1 ? [{ id: '', name: '全部授权校区' }, ...campuses] : campuses
              }
              onChange={(value) => {
                setCampusId(value);
              }}
            />
            <RefreshButton
              data-track="staff.attendancereports.button.10"
              compactOnMobile={tab === 'matrix'}
              key={`${tab}:${month}:${campusId}`}
              label={tab === 'volunteer' ? '刷新报表' : '刷新考勤'}
              onRefresh={() =>
                Promise.all([
                  result.refetch({ throwOnError: true }),
                  client.invalidateQueries(
                    { queryKey: ['/api/attendance/report-settings'] },
                    { throwOnError: true }
                  )
                ])
              }
            />
            {tab === 'volunteer' && (
              <button
                data-track="staff.attendancereports.button.13"
                type="button"
                onClick={() => setWeekly(true)}
              >
                按周核算与导出
              </button>
            )}
          </div>
          {(error || result.error) && (
            <p className="react-error" role="alert">
              {error || result.error?.message}
            </p>
          )}
          <div className="report-results" aria-busy={busy}>
            {tab === 'volunteer' && (
              <div className="report-results-heading">
                <div>
                  <h2>{tab === 'volunteer' ? '逐周文件' : '考勤明细'}</h2>
                  <p aria-live="polite">
                    {!report
                      ? ''
                      : tab === 'volunteer'
                        ? `${report?.weeks.length || 0} 周 · ${totalRows} 条登记`
                        : `${report?.dates.length || 0} 个有记录日期 · ${totalRows} 条人员记录`}
                  </p>
                </div>
                {tab === 'volunteer' && (
                  <button
                    data-track="staff.attendancereports.button.11"
                    type="button"
                    className="field-primary report-download"
                    disabled={busy || downloading || !report || !!missing.length}
                    onClick={() => exportFile()}
                  >
                    {downloading
                      ? '正在生成…'
                      : missing.length
                        ? '补全资料后下载'
                        : tab === 'volunteer'
                          ? '下载逐周文件'
                          : '下载考勤记录'}
                  </button>
                )}
              </div>
            )}
            {missing.length > 0 && (
              <div className="report-missing-people" role="status">
                <p className="report-missing-label">
                  待补全 <span>{missingPeople.length} 人</span>
                </p>
                <div className="report-missing-list">
                  {missingPeople.map((person) =>
                    person.canManageProfile && staffPermission(user, 'members.manage') ? (
                      <button
                        key={person.memberId}
                        type="button"
                        data-track="staff.attendancereports.complete-profile"
                        onClick={() => setEditingMember(person)}
                        aria-label={`补全${person.name}的人员资料`}
                      >
                        <strong>{person.name}</strong>
                        <span>
                          缺
                          {[!person.college && '学院', !person.studentId && '学号']
                            .filter(Boolean)
                            .join('、')}
                        </span>
                        <span className="report-missing-arrow" aria-hidden="true">
                          ↗
                        </span>
                      </button>
                    ) : (
                      <span key={person.memberId}>{person.name} · 请联系人员管理员补全资料</span>
                    )
                  )}
                </div>
              </div>
            )}
            {tab === 'volunteer' && report && (
              <div className="report-week-list">
                {report.weeks.map((week) => (
                  <div key={week.weekStart} className="report-week-row">
                    <strong>
                      {Number(month.slice(5))}月第{week.weekNumber}周
                    </strong>
                    <span>
                      {week.weekStart.slice(5)} 至 {week.weekEnd.slice(5)}
                    </span>
                    <span>
                      {week.campuses
                        .map((campus) => `${campus.campus} ${campus.rows.length} 人`)
                        .join(' · ')}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {tab === 'matrix' && (
              <AttendanceHistory
                key={`${month}:${campusId}`}
                report={report}
                onOpenDay={onOpenDay}
                downloading={downloading}
                onExport={(rows) => exportFile({ ...report, rows })}
              />
            )}
          </div>
        </>
      )}
      {!canExport && <AttendanceReportSettings active={active} />}
      {editingMember && active && (
        <MemberEditor
          user={user}
          member={editingMember}
          canManageRoles={
            staffPermission(user, 'roles.manage') && editingMember.memberId !== user.memberId
          }
          onClose={() => setEditingMember(null)}
          onSaved={refreshMemberReports}
        />
      )}
      {weekly && active && (
        <WeeklyAttendanceExport
          campuses={campuses}
          campusId={campusId}
          onClose={() => setWeekly(false)}
        />
      )}
    </section>
  );
}
