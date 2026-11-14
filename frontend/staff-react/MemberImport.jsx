import { track } from '../../shared/telemetry-client.js';
import { Select } from './SelectionControls.jsx';
import { useQuery } from '@tanstack/react-query';
import React, { useContext, useRef, useState } from 'react';
import { request } from './request.js';
import { ActivityContext, Modal, Notice } from './field/ui';
import { staffPermission } from '../../shared/staff-access.js';
import { MemberSetup, newMemberSetup, memberDefaults } from './MemberSetup.jsx';

const basicHeader = 'studentId,name,college';
const advancedHeader =
  'studentId,name,homeCampusId,college,major,departmentId,positionCode,exchangeParticipation,maintenanceParticipation,authorizedCampuses,effectiveFrom';
const statusLabels = { created: '新增', updated: '更新', skipped: '跳过', conflict: '冲突' };
const display = (value) =>
  ({ 'campus-nanhu': '南湖', 'campus-hunnan': '浑南' })[value] || value || '未设置';

export function MemberImport({ user, initialCsv = '', onClose, onSaved }) {
  const [setup, setSetup] = useState(() => newMemberSetup(user));
  const [csv, setCsv] = useState(initialCsv),
    [advanced, setAdvanced] = useState(false),
    [replaceHomeCampus, setReplaceHomeCampus] = useState(false),
    [accountCampusAction, setAccountCampusAction] = useState('preserve');
  const departmentsQuery = useQuery({
    queryKey: ['/api/organization/departments'],
    enabled: useContext(ActivityContext),
    staleTime: 5 * 60000,
    refetchInterval: false
  });
  const departments = departmentsQuery.data?.items || [];
  const [preview, setPreview] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [done, setDone] = useState(null);
  const lock = useRef(false),
    requestId = useRef(crypto.randomUUID());

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
          homeCampusAction: replaceHomeCampus ? 'replace' : 'preserve',
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
    link.setAttribute('data-track', 'staff.memberimport.dynamic.download');
    link.href = url;
    link.download = advanced ? 'members-advanced.csv' : 'members.csv';
    link.click();
    track('flow.result', { control: 'staff.memberimport.dynamic.download', result: 'ok' });
    URL.revokeObjectURL(url);
  }
  return (
    <Modal title="批量导入人员" dismissible={!busy} onClose={onClose}>
      <Notice>{error || departmentsQuery.error?.message}</Notice>
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
          <button
            data-track="staff.memberimport.button.1"
            className="react-primary"
            onClick={onClose}
          >
            完成
          </button>
        </>
      ) : !preview ? (
        <div className="member-import-form">
          <MemberSetup
            value={setup}
            onChange={setSetup}
            departments={departments}
            disabled={busy}
            canAuthorize={staffPermission(user, 'accounts.manage')}
          />
          <label className="workspace-check">
            <input
              data-track="staff.memberimport.input.2"
              type="checkbox"
              checked={replaceHomeCampus}
              disabled={busy}
              onChange={(event) => setReplaceHomeCampus(event.target.checked)}
            />
            <span>将所选校区同时用于已有人员</span>
          </label>
          {staffPermission(user, 'accounts.manage') && (
            <label>
              已有账号校区
              <Select
                data-track="staff.memberimport.select.3"
                value={accountCampusAction}
                disabled={busy}
                onChange={(event) => setAccountCampusAction(event.target.value)}
              >
                <option value="preserve">保留现有授权</option>
                <option value="replace">按非空授权校区列替换</option>
              </Select>
            </label>
          )}
          <div className="member-import-file-tools">
            <label>
              CSV 模板
              <Select
                data-track="staff.memberimport.select.4"
                value={advanced ? 'advanced' : 'basic'}
                disabled={busy}
                onChange={(event) => setAdvanced(event.target.value === 'advanced')}
              >
                <option value="basic">基础模板</option>
                <option value="advanced">高级模板</option>
              </Select>
            </label>
            <button data-track="staff.memberimport.button.5" disabled={busy} onClick={download}>
              下载 CSV 模板
            </button>
            <label className="member-import-file">
              读取 CSV
              <input
                data-track="staff.memberimport.input.6"
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
              data-track="staff.memberimport.textarea.7"
              rows={8}
              value={csv}
              disabled={busy}
              placeholder={basicHeader}
              onChange={(event) => setCsv(event.target.value)}
            />
          </label>
          <button
            data-track="staff.memberimport.button.8"
            className="react-primary"
            disabled={busy || !csv.trim()}
            onClick={() => submit()}
          >
            {busy ? '正在校验…' : '预览并核对'}
          </button>
        </div>
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
            <button
              data-track="staff.memberimport.button.9"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              返回修改
            </button>
            <button
              data-track="staff.memberimport.button.10"
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
