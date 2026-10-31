import React, { useState } from 'react';
import { Modal } from './field/ui';
import { request } from './request.js';
import { NEU_COLLEGES } from '../../shared/neu-colleges.js';

export function EducationImport({ onClose, onSaved }) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState(null);
  const [colleges, setColleges] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(0);
  async function run(confirm = false) {
    setBusy(true);
    setError('');
    try {
      const base = { csv, collegeByStudentId: colleges };
      const latest = confirm
        ? await request('/api/members/education-import', { method: 'POST', body: base })
        : null;
      if (
        confirm &&
        latest.items.some(
          (item) =>
            preview?.items.find((previous) => previous.studentId === item.studentId)?.revision !==
            item.revision
        )
      )
        throw new Error('成员资料已变化，请重新预览');
      const result = await request('/api/members/education-import', {
        method: 'POST',
        body: {
          ...base,
          confirm,
          expectedRevisions: Object.fromEntries(
            (preview?.items || []).map((item) => [item.studentId, item.revision])
          ),
          previewToken: latest?.previewToken || preview?.previewToken,
          requestId: crypto.randomUUID()
        }
      });
      if (confirm) {
        setDone(result.count);
        onSaved();
      } else {
        setPreview(result);
        setColleges(
          Object.fromEntries(
            result.items.map((item) => [item.studentId, item.college || item.oldCollege || ''])
          )
        );
      }
    } catch (failure) {
      setError(failure.message);
      if (confirm && failure.status === 409) setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  function template() {
    const blob = new Blob(['\uFEFFstudentId,college\r\n'], {
      type: 'text/csv;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '成员学院补充模板.csv';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const needsCollege = (preview?.items || []).some(
    (item) => !item.college && !colleges[item.studentId]?.trim()
  );
  return (
    <Modal title="批量补充学院" onClose={onClose} dismissible={!busy}>
      {done ? (
        <>
          <p role="status">已更新 {done} 名成员的学院。</p>
          <button className="field-primary" onClick={onClose}>
            完成
          </button>
        </>
      ) : (
        <div className="roster-compose">
          <p className="react-muted">
            按学号匹配已有成员，在预览中补齐学院；不会修改任职、资格或账号授权。
          </p>
          {error && (
            <p className="react-error" role="alert">
              {error}
            </p>
          )}
          {!preview ? (
            <>
              <div className="field-actions">
                <button onClick={template}>下载 CSV 模板</button>
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
                名单内容
                <textarea
                  rows={8}
                  value={csv}
                  placeholder="studentId,college"
                  onChange={(event) => setCsv(event.target.value)}
                />
              </label>
              <button
                className="field-primary"
                disabled={busy || !csv.trim()}
                onClick={() => run()}
              >
                预览并核对
              </button>
            </>
          ) : (
            <>
              <h3>核对 {preview.items.length} 名成员</h3>
              <div className="workspace-table-scroll education-import-preview">
                <table>
                  <thead>
                    <tr>
                      <th>姓名</th>
                      <th>学号</th>
                      <th>学院</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.items.map((item) => (
                      <tr key={item.studentId}>
                        <td>{item.name}</td>
                        <td>{item.studentId}</td>
                        <td>
                          <span className="workspace-native-select">
                            <select
                              aria-label={`${item.name}所属学院`}
                              value={colleges[item.studentId] || ''}
                              onChange={(event) =>
                                setColleges((current) => ({
                                  ...current,
                                  [item.studentId]: event.target.value
                                }))
                              }
                            >
                              <option value="">请选择学院</option>
                              {colleges[item.studentId] &&
                                !NEU_COLLEGES.includes(colleges[item.studentId]) && (
                                  <option value={colleges[item.studentId]}>
                                    {colleges[item.studentId]}
                                  </option>
                                )}
                              {NEU_COLLEGES.map((college) => (
                                <option key={college} value={college}>
                                  {college}
                                </option>
                              ))}
                            </select>
                            <span className="workspace-chevron" aria-hidden="true" />
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="field-actions">
                <button disabled={busy} onClick={() => setPreview(null)}>
                  返回修改名单
                </button>
                <button
                  className="field-primary"
                  disabled={busy || needsCollege}
                  onClick={() => run(true)}
                >
                  确认更新
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
