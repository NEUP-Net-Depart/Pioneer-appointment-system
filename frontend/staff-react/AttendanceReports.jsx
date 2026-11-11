import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext } from './field/ui';
import { WorkspaceHeader } from './WorkspaceHeader';
import { AttendanceReportSettings } from './AttendanceReportSettings.jsx';
import { ChoiceMenu } from './ChoiceMenu.jsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dateKey } from '../../shared/time.js';

const monthNow = () => dateKey().slice(0, 7);
const monthLabel = (month) => `${Number(month.slice(0, 4))}年${Number(month.slice(5))}月`;

function adjacentMonth(month, offset) {
  const date = new Date(`${month}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function MonthPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  const root = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event) => {
      if (!root.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);
  const change = (month) => {
    if (month.slice(0, 4) < '2000' || month.slice(0, 4) > '2100') return;
    onChange(month);
    setYear(Number(month.slice(0, 4)));
    setOpen(false);
    trigger.current?.focus();
  };
  return (
    <div className="report-month-picker" ref={root}>
      <span className="report-control-label">月份</span>
      <div className="report-month-stepper">
        <button
          type="button"
          aria-label="上个月"
          onClick={() => change(adjacentMonth(value, -1))}
          disabled={value === '2000-01'}
        >
          ‹
        </button>
        <button
          type="button"
          ref={trigger}
          className="report-month-current"
          aria-label={`选择月份，当前${monthLabel(value)}`}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={() => {
            setYear(Number(value.slice(0, 4)));
            setOpen(!open);
          }}
        >
          {monthLabel(value)} <span className="workspace-chevron" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="下个月"
          onClick={() => change(adjacentMonth(value, 1))}
          disabled={value === '2100-12'}
        >
          ›
        </button>
      </div>
      {open && (
        <div className="report-month-panel" role="dialog" aria-label="选择报表月份">
          <div className="report-month-panel-year">
            <button
              type="button"
              aria-label="上一年"
              disabled={year <= 2000}
              onClick={() => setYear(year - 1)}
            >
              ‹
            </button>
            <strong>{year}年</strong>
            <button
              type="button"
              aria-label="下一年"
              disabled={year >= 2100}
              onClick={() => setYear(year + 1)}
            >
              ›
            </button>
          </div>
          <div className="report-month-grid">
            {Array.from({ length: 12 }, (_, index) => {
              const month = `${year}-${String(index + 1).padStart(2, '0')}`;
              return (
                <button
                  type="button"
                  key={month}
                  aria-pressed={month === value}
                  onClick={() => change(month)}
                >
                  {index + 1}月
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function download(bytes, filename, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AttendanceReports({ canExport = true, embedded = false }) {
  const active = useContext(ActivityContext);
  const [month, setMonth] = useState(monthNow);
  const [campusId, setCampusId] = useState('');
  const [tab, setTab] = useState('volunteer');
  const client = useQueryClient();
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
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
  const totalRows =
    tab === 'volunteer'
      ? report?.weeks.reduce(
          (count, week) =>
            count + week.campuses.reduce((sum, campus) => sum + campus.rows.length, 0),
          0
        ) || 0
      : report?.rows.length || 0;
  async function exportFile() {
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
          builders.attendanceMatrixWorkbook(report),
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
    <section className="react-page attendance-reports">
      {!embedded && (
        <WorkspaceHeader group="排班考勤" title={canExport ? '报表导出' : '导出规则'} />
      )}
      {canExport && (
        <>
          <div className="report-type-switch" role="group" aria-label="报表类型">
            <button
              type="button"
              aria-pressed={tab === 'volunteer'}
              onClick={() => {
                if (tab !== 'volunteer') {
                  setTab('volunteer');
                }
              }}
            >
              志愿登记表
            </button>
            <button
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
              active={active}
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
            <ChoiceMenu
              label="校区"
              value={campusId}
              options={[
                { value: '', label: '全部授权校区' },
                { value: 'campus-nanhu', label: '南湖' },
                { value: 'campus-hunnan', label: '浑南' }
              ]}
              onChange={(value) => {
                setCampusId(value);
              }}
            />
            <button
              type="button"
              className="report-refresh"
              disabled={busy}
              onClick={() =>
                Promise.all(
                  [
                    '/api/attendance/volunteer-report',
                    '/api/attendance/matrix',
                    '/api/me/volunteer-summary'
                  ].map((path) => client.invalidateQueries({ queryKey: [path] }))
                )
              }
            >
              刷新数据
            </button>
          </div>
          {(error || result.error) && (
            <p className="react-error" role="alert">
              {error || result.error?.message}
            </p>
          )}
          <div className="report-results" aria-busy={busy}>
            <div className="report-results-heading">
              <div>
                <h2>{tab === 'volunteer' ? '逐周文件' : '考勤明细'}</h2>
                <p aria-live="polite">
                  {!report
                    ? ''
                    : tab === 'volunteer'
                      ? `${report?.weeks.length || 0} 周 · ${totalRows} 条登记`
                      : `${report?.dates.length || 0} 个维修日 · ${totalRows} 人`}
                </p>
              </div>
              <button
                type="button"
                className="field-primary report-download"
                disabled={busy || downloading || !report || !!missing.length}
                onClick={exportFile}
              >
                {downloading ? '正在生成…' : tab === 'volunteer' ? '下载逐周文件' : '下载考勤记录'}
              </button>
            </div>
            {missing.length > 0 && (
              <p className="react-error" role="alert">
                {missing.length} 条记录缺少学院或学号，请在人员管理补全后刷新。
              </p>
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
            {tab === 'matrix' && report && (
              <div className="report-matrix-preview">
                <strong>{monthLabel(month)}</strong>
                <span>
                  {report.dates.length
                    ? `${report.dates[0].slice(5)} 至 ${report.dates.at(-1).slice(5)}`
                    : '暂无签到日期'}
                </span>
                <span>{report.rows.length} 人</span>
              </div>
            )}
          </div>
        </>
      )}
      {!canExport && <AttendanceReportSettings active={active} />}
    </section>
  );
}
