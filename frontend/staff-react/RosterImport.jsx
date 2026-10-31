import React, { useState } from 'react';
import { Modal } from './field/ui';
import { request } from './request.js';
import { csvLine } from '../../src/lib/csv.js';
import { issueLabels } from './roster-workflow-shared.js';

const header = '姓名,学号,日期,校区,岗位\r\n';
const campusName = { 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' };

export function RosterImport({ taskId, draft, members, office, onClose, onSaved }) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  function template() {
    const names = new Map(members.map((member) => [member.memberId, member]));
    const lines = draft.assignments.map((row) =>
      csvLine([
        names.get(row.memberId)?.name || row.memberName || '',
        names.get(row.memberId)?.studentId || '',
        row.businessDate,
        campusName[row.campusId] || row.campusId,
        office
          ? row.roleKind === 'coordinator'
            ? '协调人'
            : '办公人员'
          : row.roleKind === 'repair_lead'
            ? '维修负责人'
            : '维修工作人员'
      ])
    );
    const url = URL.createObjectURL(
      new Blob(['\uFEFF', header, ...lines], { type: 'text/csv;charset=utf-8' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${office ? '办公' : '维修'}值班表-${draft.taskId || taskId}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function run(confirm = false) {
    setBusy(true);
    setError('');
    try {
      const result = await request(
        `/api/roster-tasks/${encodeURIComponent(taskId)}/roster-import`,
        {
          method: 'POST',
          body: {
            csv,
            version: draft.version,
            confirm,
            requestId,
            previewToken: preview?.previewToken
          }
        }
      );
      if (confirm) onSaved();
      else setPreview(result);
    } catch (failure) {
      setError(failure.message);
      if (failure.status === 409) setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="导入值班表" onClose={onClose} dismissible={!busy}>
      <div className="roster-compose">
        <p className="react-muted">
          导入会替换当前未发布草稿。时间取本任务的班次；资格、人员范围、签到保护和发布规则仍按系统校验。
        </p>
        {error && (
          <p className="react-error" role="alert">
            {error}
          </p>
        )}
        {!preview ? (
          <>
            <div className="field-actions">
              <button onClick={template}>下载当前班表模板</button>
              <label>
                读取 CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  disabled={busy}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (file) setCsv(await file.text());
                  }}
                />
              </label>
            </div>
            <label>
              值班表内容
              <textarea
                rows={8}
                value={csv}
                placeholder={header.trim()}
                onChange={(event) => setCsv(event.target.value)}
              />
            </label>
            <p className="react-muted">
              岗位填写：{office ? '办公人员、协调人' : '维修工作人员、维修负责人'}
              。姓名用于核对，学号用于匹配。
            </p>
            <button className="field-primary" disabled={busy || !csv.trim()} onClick={() => run()}>
              预览导入结果
            </button>
          </>
        ) : (
          <>
            <h3>将导入 {preview.count} 班</h3>
            <p className="react-muted">
              超出成员原填报时间的安排会标记为人工覆盖；不会改写原填报。
            </p>
            <div className="workspace-table-scroll roster-import-preview">
              <table>
                <thead>
                  <tr>
                    <th>人员</th>
                    <th>日期</th>
                    <th>校区</th>
                    <th>岗位</th>
                    <th>填报情况</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.assignments.map((row, index) => (
                    <tr key={`${row.studentId}:${index}`}>
                      <td>
                        {row.name} · {row.studentId}
                      </td>
                      <td>{row.businessDate}</td>
                      <td>{campusName[row.campusId]}</td>
                      <td>{row.role}</td>
                      <td>{row.manualOverride ? '人工覆盖' : '符合填报'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!!preview.validation.errors.length && (
              <section>
                <h4>需要核对的问题</h4>
                <ul>
                  {preview.validation.errors.map((issue) => (
                    <li key={issue.id}>
                      {issueLabels[issue.code] || issue.code} ·{' '}
                      {issue.severity === 'blocking' ? '必须修正' : '发布前处理或说明'}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="field-actions">
              <button disabled={busy} onClick={() => setPreview(null)}>
                返回修改文件
              </button>
              <button
                className="field-primary"
                disabled={busy || preview.validation.blocking}
                onClick={() => run(true)}
              >
                导入草稿并检查
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
