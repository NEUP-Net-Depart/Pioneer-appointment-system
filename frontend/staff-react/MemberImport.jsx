import React, { useState } from 'react';
import { request } from './request.js';
import { Modal } from './field/ui';

const header =
  'studentId,name,homeCampusId,departmentId,workProfiles,roleCodes,authorizedCampuses,trainingConfirmed,accountRole';
const templates = {
  repair: { label: '普通维修', department: 'dept-hardware', role: 'technician' },
  exchange: { label: '交流人员', department: '', role: 'exchange' },
  office: { label: '办公人员', department: 'dept-office', role: 'office' }
};
export function MemberImport({ onClose, onSaved }) {
  const [kind, setKind] = useState('repair'),
    [csv, setCsv] = useState(''),
    [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState(null);
  async function submit(confirm = false) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const data = await request('/api/members/import', {
        method: 'POST',
        body: { csv, confirm, requestId: crypto.randomUUID() }
      });
      if (confirm) {
        setDone(data);
        onSaved();
      } else setPreview(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  function download() {
    const link = document.createElement('a'),
      url = URL.createObjectURL(
        new Blob(['\uFEFF' + header + '\r\n'], { type: 'text/csv;charset=utf-8' })
      );
    link.href = url;
    link.download = `${kind}-members.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Modal title="导入成员与激活资格" dismissible={!busy} onClose={onClose}>
      {error && (
        <p className="react-error" role="alert">
          {error}
        </p>
      )}
      {done ? (
        <>
          <h3>已导入 {done.count} 名成员</h3>
          <p>
            尚未激活且具备资格、角色和授权校区的成员，可从登录页提交激活申请，核验通过后使用同一成员资料。
          </p>
          <button className="react-primary" onClick={onClose}>
            完成
          </button>
        </>
      ) : (
        <>
          {kind === 'exchange' && (
            <p className="field-muted">导入交流人员即确认培训通过，并保留交流资格。</p>
          )}
          <p className="field-muted">
            更新已有成员时，省略 authorizedCampuses
            列保留账号校区授权；提供该列会替换授权，空值会清空授权。
          </p>
          {!preview ? (
            <>
              <label>
                名单类型
                <select value={kind} onChange={(e) => setKind(e.target.value)}>
                  {Object.entries(templates).map(([key, item]) => (
                    <option key={key} value={key}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <details className="workspace-help">
                <summary>名单格式与角色配置</summary>
                <p className="field-muted">
                  工作资格填写 <code>{kind}</code>；角色填写 <code>{templates[kind].role}</code>
                  ；部门
                  {templates[kind].department ? (
                    <>
                      填写 <code>{templates[kind].department}</code>
                    </>
                  ) : (
                    '按实际任职填写'
                  )}
                  。所属及授权校区使用 campus-nanhu 或 campus-hunnan；多校区用 | 分隔。
                  {kind === 'exchange' && '核验培训通过后，trainingConfirmed 填写 true。'}
                </p>
                <p className="field-muted">
                  管理员邀请填写 accountRole=admin，并在 roleCodes、authorizedCampuses
                  明确指定业务管理角色和校区；部门、工作资格按实际任职填写，可留空。
                  每个成员只关联一个登录账号，多重身份通过角色组合配置。
                </p>
              </details>
              <div className="field-actions">
                <button onClick={download}>下载 CSV 模板</button>
                <label>
                  读取 CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    disabled={busy}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setCsv(await file.text());
                        setPreview(null);
                      }
                    }}
                  />
                </label>
              </div>
              <label>
                名单内容
                <textarea
                  rows={8}
                  value={csv}
                  placeholder={header}
                  onChange={(e) => setCsv(e.target.value)}
                />
              </label>
              <button
                className="react-primary"
                disabled={busy || !csv.trim()}
                onClick={() => submit()}
              >
                {busy ? '正在校验…' : '预览并核对'}
              </button>
            </>
          ) : (
            <>
              <h3>待导入 {preview.items.length} 名成员</h3>
              <div className="member-import-preview">
                {preview.items.map((item) => (
                  <article className="react-binding" key={item.studentId}>
                    <strong>
                      {item.name} · {item.studentId}
                    </strong>
                    <p>
                      {item.homeCampusId === 'campus-hunnan' ? '浑南' : '南湖'} ·{' '}
                      {item.workProfiles.join('、') || '未设置工作资格'}
                    </p>
                    <p>
                      账号类型：{item.accountRole === 'admin' ? '管理员' : '按工作资格确定'} ·
                      角色：{item.roleCodes.join('、') || '未授权'} · 授权校区：
                      {item.authorizedCampuses.join('、') || '未设置'}
                    </p>
                    <p>
                      登录账号校区：
                      {!item.updateAccountCampuses
                        ? '保持不变'
                        : item.accountTargets.length
                          ? `${item.accountTargets.join('、')} → ${item.authorizedCampuses.join('、') || '清空全部校区授权'}`
                          : '无已有登录账号；所填校区用于角色授权与激活资格'}
                    </p>
                  </article>
                ))}
              </div>
              {preview.warnings.map((item, index) => (
                <p key={index} role="status">
                  {item.studentId}：{item.message}
                </p>
              ))}
              <div className="field-actions">
                <button disabled={busy} onClick={() => setPreview(null)}>
                  返回修改
                </button>
                <button className="react-primary" disabled={busy} onClick={() => submit(true)}>
                  {busy ? '正在导入…' : '确认名单与培训结果并导入'}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
