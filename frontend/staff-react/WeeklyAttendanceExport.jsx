import React, { useState } from 'react';
import { Modal, Notice } from './field/ui';
import { WeekPicker } from './WeekPicker';
import { dateKey, weekRange } from '../../shared/time.js';
import { request } from './request.js';
import { apiFetch } from '../../shared/api.js';

export function WeeklyAttendanceExport({ campuses, onClose }) {
  const [scope, setScope] = useState({
    weekStart: weekRange(dateKey()).start,
    weekEnd: weekRange(dateKey()).start,
    campusId: '',
    firstOnly: false,
    leadersOnce: false
  });
  const [rows, setRows] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const change = (patch) => {
    setScope((current) => ({ ...current, ...patch }));
    setRows(null);
    setError('');
  };
  const params = () =>
    new URLSearchParams({
      ...scope,
      firstOnly: scope.firstOnly ? '1' : '0',
      leadersOnce: scope.leadersOnce ? '1' : '0'
    });
  async function run(download = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (download) {
        const response = await apiFetch('/api/attendance/export.csv?' + params());
        if (!response.ok) throw new Error((await response.json()).error);
        const url = URL.createObjectURL(await response.blob()),
          link = document.createElement('a');
        link.href = url;
        link.download = `周考勤-${scope.weekStart}-${scope.weekEnd}.csv`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else setRows((await request('/api/attendance/weekly-summary?' + params())).rows);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="按周核算并导出考勤"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="roster-compose">
        <p className="react-muted">
          每人每周一行，跨校区合并。暂停日考勤保留，统计时排除；两个特殊核算选项默认关闭。
        </p>
        <WeekPicker
          label="开始工作周"
          value={scope.weekStart}
          onChange={(weekStart) =>
            change({ weekStart, weekEnd: scope.weekEnd < weekStart ? weekStart : scope.weekEnd })
          }
          disabled={busy}
        />
        <WeekPicker
          label="结束工作周"
          value={scope.weekEnd}
          onChange={(weekEnd) => change({ weekEnd })}
          disabled={busy}
        />
        <label>
          导出校区
          <select
            value={scope.campusId}
            disabled={busy}
            onChange={(event) => change({ campusId: event.target.value })}
          >
            <option value="">全部授权校区</option>
            {campuses.map((campus) => (
              <option key={campus.id} value={campus.id}>
                {campus.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset disabled={busy}>
          <legend>特殊情况核算</legend>
          <label className="roster-choice-row">
            <input
              type="checkbox"
              checked={scope.firstOnly}
              onChange={(event) => change({ firstOnly: event.target.checked })}
            />
            <span>同一人本周多次签到，只计首次有效签到</span>
          </label>
          <label className="roster-choice-row">
            <input
              type="checkbox"
              checked={scope.leadersOnce}
              onChange={(event) => change({ leadersOnce: event.target.checked })}
            />
            <span>所有有效负责人每值班周计一次，不依据排班或签到次数</span>
          </label>
          <p className="react-muted">兼任维修和办公负责人仍计一次；其授权校区整周暂停时计零。</p>
        </fieldset>
        <Notice>{error}</Notice>
        {rows && (
          <section className="roster-export-preview">
            <h3>核算预览 · {rows.length} 条人员周记录</h3>
            <div className="workspace-table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>值班周</th>
                    <th>人员</th>
                    <th>实际有效签到</th>
                    <th>核算次数</th>
                    <th>依据</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={`${row.weekStart}:${row.memberId}`}>
                      <td>{row.weekStart}</td>
                      <td>{row.name}</td>
                      <td>{row.actualCount}</td>
                      <td>{row.creditedCount}</td>
                      <td>{row.basis}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && <p>当前授权和筛选范围内暂无记录。</p>}
          </section>
        )}
        <div className="roster-modal-actions">
          <button disabled={busy} onClick={() => run(false)}>
            预览核算结果
          </button>
          <button className="field-primary" disabled={busy || !rows} onClick={() => run(true)}>
            导出本次周汇总
          </button>
        </div>
      </div>
    </Modal>
  );
}
