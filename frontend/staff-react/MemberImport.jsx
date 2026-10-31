import React, { useEffect, useRef, useState } from 'react';
import { request } from './request.js';
import { Modal, Notice } from './field/ui';
import { staffPermission } from '../../shared/staff-access.js';
import { MemberSetup, newMemberSetup, memberDefaults } from './MemberSetup.jsx';

const basicHeader = 'studentId,name,college';
const advancedHeader =
  'studentId,name,homeCampusId,college,departmentId,assignmentType,workProfiles,roleCodes,authorizedCampuses,trainingConfirmed,accountRole,effectiveFrom';
const statusLabels = { created: '新增', updated: '更新', skipped: '跳过', conflict: '冲突' };
const display = (value) =>
  ({ 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' })[value] || value || '未设置';

export function MemberImport({ user, initialCsv = '', onClose, onSaved }) {
  const [setup, setSetup] = useState(() => newMemberSetup(user));
  const [csv, setCsv] = useState(initialCsv),
    [advanced, setAdvanced] = useState(false),
    [accountCampusAction, setAccountCampusAction] = useState('preserve');
  const [departments, setDepartments] = useState([]),
    [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState(null);
  const lock = useRef(false),
    requestId = useRef(crypto.randomUUID());
  useEffect(() => {
    const controller = new AbortController();
    request('/api/organization/departments', { signal: controller.signal })
      .then((data) => setDepartments(data.items || []))
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      });
    return () => controller.abort();
  }, []);
  async function submit(confirm = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const data = await request('/api/members/import', {
        method: 'POST',
        body: {
          csv,
          defaults: memberDefaults(setup),
          accountCampusAction,
          confirm,
          ...(confirm ? { previewToken: preview.previewToken } : {}),
          requestId: requestId.current
        }
      });
      if (confirm) {
        setDone(data);
        onSaved();
      } else setPreview(data);
    } catch (failure) {
      setError(failure.message);
      if (failure.status === 409) setPreview(null);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function download() {
    const link = document.createElement('a'),
      url = URL.createObjectURL(
        new Blob(['\uFEFF' + (advanced ? advancedHeader : basicHeader) + '\r\n'], {
          type: 'text/csv;charset=utf-8'
        })
      );
    link.href = url;
    link.download = advanced ? 'members-advanced.csv' : 'members.csv';
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <Modal title="批量导入人员" dismissible={!busy} onClose={onClose}>
      <Notice>{error}</Notice>
      {done ? (
        <>
          <h3>导入完成</h3>
          <p role="status">
            新增 {done.summary?.created || 0} 人 · 更新 {done.summary?.updated || 0} 人 · 跳过{' '}
            {done.summary?.skipped || 0} 人
          </p>
          <div className="member-import-preview">
            {done.items?.map((item) => (
              <p key={item.studentId}>
                {item.name} · {item.studentId} · {statusLabels[item.status]}
              </p>
            ))}
          </div>
          <button className="react-primary" onClick={onClose}>
            完成
          </button>
        </>
      ) : !preview ? (
        <>
          <MemberSetup
            value={setup}
            onChange={setSetup}
            departments={departments}
            disabled={busy}
            canAuthorize={
              staffPermission(user, 'roles.manage') && staffPermission(user, 'accounts.manage')
            }
          />
          <details
            className="workspace-help"
            onToggle={(event) => setAdvanced(event.currentTarget.open)}
          >
            <summary>高级 CSV 配置</summary>
            <p>
              可用非空列覆盖默认设置；空白资料和授权均保留。部门任职、工作资格和角色只做补充。清空资料、调岗或撤销授权请进入人员详情。
            </p>
            <p>
              校区使用 campus-nanhu、campus-hunnan；多项用 | 分隔。工作资格使用
              repair、exchange、office；角色使用角色代码。每个成员只关联一个登录账号。
            </p>
            {staffPermission(user, 'accounts.manage') && (
              <label>
                已有账号校区
                <select
                  value={accountCampusAction}
                  disabled={busy}
                  onChange={(event) => setAccountCampusAction(event.target.value)}
                >
                  <option value="preserve">保留现有授权</option>
                  <option value="replace">按非空授权校区列替换</option>
                </select>
              </label>
            )}
          </details>
          <div className="field-actions">
            <button disabled={busy} onClick={download}>
              下载 CSV 模板
            </button>
            <label>
              读取 CSV
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  if (file.size > 1024 * 1024) {
                    setError('CSV 文件不能超过 1 MB');
                    return;
                  }
                  try {
                    setCsv(await file.text());
                    setError('');
                  } catch {
                    setError('文件读取失败，请重新选择');
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
              disabled={busy}
              placeholder={basicHeader}
              onChange={(event) => setCsv(event.target.value)}
            />
          </label>
          <button
            className="react-primary"
            disabled={
              busy || !csv.trim() || (setup.kind === 'exchange' && !setup.trainingConfirmed)
            }
            onClick={() => submit()}
          >
            {busy ? '正在校验…' : '预览并核对'}
          </button>
        </>
      ) : (
        <>
          <p role="status">
            新增 {preview.summary.created} 人 · 更新 {preview.summary.updated} 人 · 跳过{' '}
            {preview.summary.skipped} 人 · 冲突 {preview.summary.conflict} 人
          </p>
          <div className="member-import-preview">
            {preview.items.map((item) => (
              <article className="react-binding" key={item.studentId}>
                <strong>
                  {item.name} · {item.studentId} · {statusLabels[item.status]}
                </strong>
                {item.changes.map((change, index) => (
                  <p key={index}>
                    {change.label}：{display(change.before)} → {display(change.after)}
                  </p>
                ))}
                {item.conflicts.map((conflict) => (
                  <p className="react-error" key={conflict}>
                    {conflict}
                  </p>
                ))}
                {item.status === 'skipped' && <p>资料、任职和授权均无变化</p>}
              </article>
            ))}
          </div>
          <div className="field-actions">
            <button disabled={busy} onClick={() => setPreview(null)}>
              返回修改
            </button>
            <button
              className="react-primary"
              disabled={busy || preview.summary.conflict > 0}
              onClick={() => submit(true)}
            >
              {busy ? '正在导入…' : '确认差异并导入'}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
