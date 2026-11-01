import React, { useContext, useEffect, useRef, useState } from 'react';
import { roleLabels, CAMPUSES } from '../../shared/constants.js';
import { request } from './request.js';
import { ActivityContext, Modal, Notice } from './field/ui';
import { WorkspaceHeader } from './WorkspaceHeader';
import { WorkspaceSections } from './WorkspaceSections';
import { useUnsavedChanges } from './useUnsavedChanges.js';

const enrollmentLabels = {
  open: '待激活',
  revoked: '已撤销',
  activated: '已激活',
  pending: '待审核',
  approved: '已通过',
  rejected: '已拒绝'
};
const sections = [
  { id: 'accounts', label: '账号列表' },
  { id: 'review', label: '激活审核' },
  { id: 'invites', label: '加入资格' }
];

function useAccountList(endpoint, active) {
  const [items, setItems] = useState([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    request(endpoint, { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) setItems(data.items || []);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) {
          if ([401, 403].includes(failure.status)) setItems([]);
          setError(failure.message);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [endpoint, active, revision]);
  return { items, loading, error, refresh: () => setRevision((value) => value + 1) };
}

export function Accounts({ user, embedded = false }) {
  const active = useContext(ActivityContext);
  const [section, setSection] = useState('accounts'),
    [visited, setVisited] = useState(['accounts']);
  const [copyMessage, setCopyMessage] = useState('');
  const activationUrl = new URL('/staff/?activate=1', location.origin).href;
  async function copy() {
    try {
      await navigator.clipboard.writeText(activationUrl);
      setCopyMessage('激活网址已复制，可发给已获得加入资格的成员。');
    } catch {
      setCopyMessage(`请复制激活网址：${activationUrl}`);
    }
  }
  return (
    <section className="accounts-workspace">
      {embedded ? (
        <div className="workspace-list-tools">
          <button onClick={copy}>复制激活网址</button>
        </div>
      ) : (
        <WorkspaceHeader group="平台管理" title="人员管理">
          <button onClick={copy}>复制激活网址</button>
        </WorkspaceHeader>
      )}
      <Notice>{copyMessage}</Notice>
      <WorkspaceSections
        label="账号管理功能"
        items={sections}
        value={section}
        onChange={(id) => {
          setSection(id);
          setVisited((current) => (current.includes(id) ? current : [...current, id]));
        }}
      />
      {sections.map(
        (item) =>
          visited.includes(item.id) && (
            <ActivityContext.Provider key={item.id} value={active && section === item.id}>
              <div hidden={section !== item.id}>
                {item.id === 'accounts' ? (
                  <AccountList user={user} />
                ) : item.id === 'review' ? (
                  <ActivationReview />
                ) : (
                  <Invitations user={user} />
                )}
              </div>
            </ActivityContext.Provider>
          )
      )}
    </section>
  );
}

function AccountList({ user }) {
  const active = useContext(ActivityContext),
    list = useAccountList('/api/users', active);
  const [query, setQuery] = useState(''),
    [selected, setSelected] = useState(null),
    [message, setMessage] = useState('');
  const items = list.items.filter((item) =>
    [item.account, item.name, item.homeCampus, ...(item.authorizedCampuses || [])]
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase().trim())
  );
  return (
    <>
      <div className="workspace-list-tools">
        <label>
          查找账号
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="姓名、学号或校区"
          />
        </label>
        <button disabled={list.loading} onClick={list.refresh}>
          刷新账号
        </button>
        <span data-motion-value="number" role="status">
          {list.loading ? '正在更新，保留已有账号…' : `${items.length} 个账号`}
        </span>
      </div>
      <Notice>{list.error || message}</Notice>
      <section
        data-motion-list="reveal"
        className="account-list"
        aria-label="工作人员账号列表"
        aria-busy={list.loading}
      >
        {items.map((item) => (
          <article data-motion-item="" className="field-card account-row" key={item.account}>
            <div className="account-identity">
              <strong data-motion-value="text">{item.name}</strong>
              <span data-motion-value="text">{item.account}</span>
            </div>
            <div>
              <span className="account-label">角色</span>
              <span data-motion-value="text">
                {item.roleNames
                  ? item.roleNames.join('、') || '尚未授权角色'
                  : roleLabels[item.role] || '其他角色'}
              </span>
            </div>
            <div>
              <span className="account-label">校区</span>
              <span data-motion-value="text">{item.homeCampus}</span>
              <small data-motion-value="text">
                授权 {(item.authorizedCampuses || []).join('、')}
              </small>
            </div>
            <div>
              <span data-motion-value="text" className="account-state" data-state={item.status}>
                {item.status === 'enabled' ? '已启用' : '已停用'}
              </span>
              <small data-motion-value="number">{item.workload || 0} 条维修记录</small>
            </div>
            <div className="account-actions">
              {item.actions?.edit ? (
                <button onClick={() => setSelected(item)}>管理账号</button>
              ) : (
                <small data-motion-value="text">
                  {item.protected
                    ? '系统保护账号'
                    : item.account === user.account
                      ? '本人账号'
                      : '仅可查看'}
                </small>
              )}
            </div>
          </article>
        ))}
        {!items.length && !list.loading && !list.error && (
          <div className="field-empty">
            <strong data-motion-value="text">{query ? '没有匹配的账号' : '暂无可见账号'}</strong>
            <p data-motion-value="text">
              {query ? '试试姓名、学号或校区，或清除搜索。' : '成员通过激活审核后会出现在这里。'}
            </p>
            {query && <button onClick={() => setQuery('')}>清除搜索</button>}
          </div>
        )}
      </section>
      {selected && (
        <AccountEditor
          user={user}
          item={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            setSelected(null);
            setMessage('账号已更新，旧登录会话已撤销。');
            list.refresh();
          }}
        />
      )}
    </>
  );
}

export function AccountEditor({ user, item, onClose, onSaved, embedded = false, onDirty, onBusy }) {
  const active = useContext(ActivityContext);
  const [draft, setDraft] = useState({
    name: item.name,
    role: item.role,
    homeCampus: item.homeCampus,
    authorizedCampuses: [...item.authorizedCampuses],
    status: item.status
  });
  const [password, setPassword] = useState(''),
    [reset, setReset] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  const dirty =
    embedded &&
    (reset ||
      ['name', 'role', 'homeCampus', 'status'].some((key) => draft[key] !== item[key]) ||
      JSON.stringify(draft.authorizedCampuses) !== JSON.stringify(item.authorizedCampuses));
  function discard() {
    setDraft({
      name: item.name,
      role: item.role,
      homeCampus: item.homeCampus,
      authorizedCampuses: [...item.authorizedCampuses],
      status: item.status
    });
    setPassword('');
    setReset(false);
  }
  const form = useUnsavedChanges({ dirty, active, busy, save, discard });
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  useEffect(() => {
    if (!active) {
      setPassword('');
      setReset(false);
    }
  }, [active]);
  async function save(event) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    onBusy?.(true);
    setError('');
    try {
      await request(`/api/users/${encodeURIComponent(item.account)}`, {
        method: 'PATCH',
        body: { ...draft, ...(reset ? { password } : {}) }
      });
      await onSaved();
      return true;
    } catch (failure) {
      setError(failure.message);
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy?.(false);
    }
  }
  const Container = embedded ? React.Fragment : Modal;
  return (
    <Container
      {...(embedded
        ? {}
        : { title: `管理账号 · ${item.name}`, dismissible: !busy, onClose, sidePanel: true })}
    >
      <p data-motion-value="text" className="field-muted">
        {item.account} · 保存后撤销此账号已有会话。
      </p>
      <form ref={form} className="workspace-form" onSubmit={save}>
        <fieldset disabled={busy} className="workspace-form-fields">
          <label>
            姓名
            <input
              required
              maxLength={80}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          <p data-motion-value="text" className="field-muted">
            工作角色：{item.roleNames?.join('、') || '尚未授权'}
            。角色权限与工作资格在人员详情中分别维护。
          </p>
          <label>
            基础账号类型
            <select
              value={draft.role}
              onChange={(event) => setDraft({ ...draft, role: event.target.value })}
            >
              {Object.entries(roleLabels)
                .filter(([role]) => role === 'technician' || role === 'admin')
                .map(([role, label]) => (
                  <option key={role} value={role}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            所属校区
            <select
              value={draft.homeCampus}
              onChange={(event) => setDraft({ ...draft, homeCampus: event.target.value })}
            >
              {CAMPUSES.map((campus) => (
                <option key={campus}>{campus}</option>
              ))}
            </select>
          </label>
          <fieldset className="workspace-checks">
            <legend>授权校区</legend>
            {CAMPUSES.map((campus) => (
              <label key={campus}>
                <input
                  type="checkbox"
                  disabled={!user.authorizedCampuses.includes(campus)}
                  checked={draft.authorizedCampuses.includes(campus)}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      authorizedCampuses: event.target.checked
                        ? [...draft.authorizedCampuses, campus]
                        : draft.authorizedCampuses.filter((value) => value !== campus)
                    })
                  }
                />
                {campus}
              </label>
            ))}
          </fieldset>
          {item.actions?.changeStatus && (
            <label>
              账号状态
              <select
                value={draft.status}
                onChange={(event) => setDraft({ ...draft, status: event.target.value })}
              >
                <option value="enabled">启用</option>
                <option value="disabled">停用</option>
              </select>
            </label>
          )}
          {item.actions?.resetPassword && (
            <>
              <label className="workspace-check">
                <input
                  type="checkbox"
                  checked={reset}
                  onChange={(event) => {
                    setReset(event.target.checked);
                    setPassword('');
                  }}
                />
                同时重置密码
              </label>
              {reset && (
                <label>
                  新登录密码
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
              )}
            </>
          )}
        </fieldset>
        <Notice>{error}</Notice>
        <div className="field-actions">
          <button type="button" disabled={busy} onClick={embedded ? discard : onClose}>
            取消
          </button>
          <button className="field-primary" disabled={busy || !draft.authorizedCampuses.length}>
            {busy ? '正在保存…' : '保存账号'}
          </button>
        </div>
      </form>
    </Container>
  );
}

function ActivationReview() {
  const active = useContext(ActivityContext),
    list = useAccountList('/api/activation-requests', active);
  const [selected, setSelected] = useState([]),
    [verified, setVerified] = useState(false),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [history, setHistory] = useState(false);
  const lock = useRef(false),
    pending = list.items.filter((item) => item.status === 'pending');
  const items = history ? list.items.filter((item) => item.status !== 'pending') : pending;
  const ids = selected.filter((id) => pending.some((item) => item.id === id));
  async function review(status) {
    if (lock.current || !ids.length) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await request('/api/activation-requests/review', {
        method: 'POST',
        body: { ids, status, identityVerified: verified, reviewNote: note.trim() }
      });
      setSelected([]);
      setVerified(false);
      setNote('');
      list.refresh();
      setMessage(
        `已处理 ${result.applied.length} 条申请。${result.conflicts.length ? '部分申请已被更新，请核对最新结果。' : ''}`
      );
    } catch (failure) {
      setMessage(failure.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <div className="workspace-list-tools">
        <div>
          <h2>激活审核</h2>
          <p className="field-muted">核实本人身份后批准申请。</p>
        </div>
        <button disabled={busy || list.loading} onClick={list.refresh}>
          刷新申请
        </button>
        <button
          aria-pressed={history}
          disabled={busy}
          onClick={() => setHistory((value) => !value)}
        >
          {history ? '返回待审核' : '查看已处理'}
        </button>
      </div>
      <Notice>{list.error || message}</Notice>
      <div data-motion-list="reveal" className="account-list" aria-busy={list.loading}>
        {items.map((item) => (
          <article data-motion-item="" className="field-card account-row review-row" key={item.id}>
            <div className="account-identity">
              {item.status === 'pending' ? (
                <label className="workspace-check">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${item.studentId}`}
                    disabled={busy}
                    checked={ids.includes(item.id)}
                    onChange={(event) => {
                      setVerified(false);
                      setSelected(
                        event.target.checked
                          ? [...ids, item.id]
                          : ids.filter((id) => id !== item.id)
                      );
                    }}
                  />
                  <strong data-motion-value="text">{item.name}</strong>
                </label>
              ) : (
                <strong data-motion-value="text">{item.name}</strong>
              )}
              <span data-motion-value="text">{item.studentId}</span>
            </div>
            <div>
              <span data-motion-value="text">{roleLabels[item.expectedRole] || '其他角色'}</span>
              <small data-motion-value="text">
                所属 {item.homeCampus} · 授权 {item.authorizedCampuses.join('、')}
              </small>
            </div>
            <div>
              <span data-motion-value="text" className="account-state" data-state={item.status}>
                {enrollmentLabels[item.status] || '状态已更新'}
              </span>
              {item.reviewNote && <small data-motion-value="text">{item.reviewNote}</small>}
            </div>
          </article>
        ))}
      </div>
      {!items.length && !list.loading && !list.error && (
        <div className="field-empty">
          <strong data-motion-value="text">{history ? '暂无已处理申请' : '暂无待审核申请'}</strong>
          <p>成员提交激活申请后，会在这里显示。</p>
        </div>
      )}
      {!history && pending.length > 0 && (
        <section className="field-card review-decision">
          <strong data-motion-value="number">已选 {ids.length} 人</strong>
          <label className="workspace-check">
            <input
              type="checkbox"
              checked={verified}
              disabled={busy || !ids.length}
              onChange={(event) => setVerified(event.target.checked)}
            />
            我已逐一核实选中申请的本人身份
          </label>
          <label>
            审核说明（选填）
            <textarea
              rows={2}
              maxLength={300}
              value={note}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
          </label>
          <div className="field-actions">
            <button disabled={busy || !ids.length} onClick={() => review('rejected')}>
              拒绝申请
            </button>
            <button
              className="field-primary"
              disabled={busy || !ids.length || !verified}
              onClick={() => review('approved')}
            >
              {busy ? '正在处理…' : '批准申请'}
            </button>
          </div>
        </section>
      )}
    </>
  );
}

function Invitations({ user }) {
  const active = useContext(ActivityContext),
    list = useAccountList('/api/staff-whitelist', active);
  const [csv, setCsv] = useState(''),
    [file, setFile] = useState(null),
    [role, setRole] = useState('technician'),
    [campuses, setCampuses] = useState(user.authorizedCampuses.slice(0, 1));
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [importing, setImporting] = useState(false),
    [query, setQuery] = useState('');
  const lock = useRef(false);
  async function run(operation) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await operation();
      list.refresh();
    } catch (failure) {
      setMessage(failure.message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function submit(event) {
    event.preventDefault();
    run(async () => {
      if (file && file.size > 200000) throw new Error('CSV 文件不能超过 200 KB');
      const result = await request('/api/staff-whitelist/import', {
        method: 'POST',
        body: {
          csv: file ? await file.text() : csv,
          expectedRole: role,
          authorizedCampuses: campuses
        }
      });
      setMessage(`已导入 ${result.imported.length} 人，已有资格跳过 ${result.skipped.length} 人。`);
      setImporting(false);
      setFile(null);
      setCsv('');
    });
  }
  const items = list.items.filter((item) =>
    `${item.studentId} ${item.expectedName || ''}`.includes(query.trim())
  );
  return (
    <>
      <div className="workspace-list-tools">
        <label>
          查找加入资格
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="学号或姓名"
          />
        </label>
        <button disabled={busy || list.loading} onClick={list.refresh}>
          刷新资格
        </button>
        <button className="field-primary" onClick={() => setImporting(true)}>
          导入名单
        </button>
      </div>
      <Notice>{list.error || message}</Notice>
      <div data-motion-list="reveal" className="account-list" aria-busy={list.loading}>
        {items.map((item) => (
          <article
            data-motion-item=""
            className="field-card account-row invite-row"
            key={item.studentId}
          >
            <div className="account-identity">
              <strong data-motion-value="text">{item.expectedName || '待核实姓名'}</strong>
              <span data-motion-value="text">{item.studentId}</span>
            </div>
            <div>
              <span data-motion-value="text">{roleLabels[item.expectedRole] || '其他角色'}</span>
              <small data-motion-value="text">授权 {item.authorizedCampuses.join('、')}</small>
            </div>
            <span data-motion-value="text" className="account-state" data-state={item.status}>
              {enrollmentLabels[item.status] || '状态已更新'}
            </span>
            <div>
              {item.status !== 'activated' && (
                <button
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await request(`/api/staff-whitelist/${encodeURIComponent(item.studentId)}`, {
                        method: 'PATCH',
                        body: { status: item.status === 'open' ? 'revoked' : 'open' }
                      });
                      setMessage('加入资格已更新。');
                    })
                  }
                >
                  {item.status === 'open' ? '撤销资格' : '恢复资格'}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {!items.length && !list.loading && !list.error && (
        <div className="field-empty">
          <strong data-motion-value="text">
            {query ? '没有匹配的加入资格' : '还没有加入名单'}
          </strong>
          <p>导入名单后，将激活网址发给成员，由本人设置密码并提交申请。</p>
        </div>
      )}
      {importing && (
        <Modal
          title="导入加入名单"
          onClose={() => {
            if (!busy) setImporting(false);
          }}
        >
          <form className="workspace-form" onSubmit={submit}>
            <fieldset className="workspace-form-fields" disabled={busy}>
              <p className="field-muted">
                同时提供文件和文本时使用文件；已有记录会跳过。管理员邀请请在“人员管理”导入。
              </p>
              <label>
                CSV 文件（不超过 200 KB）
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => setFile(event.target.files[0] || null)}
                />
              </label>
              <label>
                或粘贴 CSV
                <textarea
                  value={csv}
                  rows={5}
                  onChange={(event) => setCsv(event.target.value)}
                  placeholder={'studentId,expectedName\n20260001,张三'}
                />
              </label>
              <label>
                默认角色
                <select value={role} onChange={(event) => setRole(event.target.value)}>
                  <option value="technician">{roleLabels.technician}</option>
                </select>
              </label>
              <fieldset className="workspace-checks">
                <legend>默认授权校区</legend>
                {user.authorizedCampuses.map((campus) => (
                  <label key={campus}>
                    <input
                      type="checkbox"
                      checked={campuses.includes(campus)}
                      onChange={(event) =>
                        setCampuses(
                          event.target.checked
                            ? [...campuses, campus]
                            : campuses.filter((value) => value !== campus)
                        )
                      }
                    />
                    {campus}
                  </label>
                ))}
              </fieldset>
              <details className="workspace-help">
                <summary>CSV 格式</summary>
                <p className="field-muted">
                  必需列 studentId；可选列 expectedName、expectedRole（仅
                  technician）、authorizedCampuses；多校区用 | 分隔。
                </p>
              </details>
            </fieldset>
            <Notice>{message}</Notice>
            <div className="field-actions">
              <button type="button" disabled={busy} onClick={() => setImporting(false)}>
                取消
              </button>
              <button
                className="field-primary"
                disabled={busy || !campuses.length || (!file && !csv.trim())}
              >
                {busy ? '正在导入…' : '导入名单'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
