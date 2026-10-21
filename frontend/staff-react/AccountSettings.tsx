import React, { useContext, useEffect, useRef, useState } from 'react';
import { clearSession } from '../../shared/api.js';
import { ActivityContext, api, Modal, Notice } from './field/ui';
import { WorkspaceHeader } from './WorkspaceHeader';
import { CapacityEditor } from './CapacityEditor';
import { staffPermission } from '../../shared/staff-access.js';

export function AccountSettings({
  user,
  section,
  onNavigate
}: {
  user: {
    name: string;
    account: string;
    homeCampus: string;
    authorizedCampuses: string[];
    role: string;
    permissions?: Record<string, boolean>;
  };
  section: string;
  onNavigate?: (view: string) => void;
}) {
  const active = useContext(ActivityContext);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const security = section !== 'capacity';
  const allowed = staffPermission(user, 'settings.manage');
  function signedOut(message: string) {
    clearSession();
    window.dispatchEvent(new CustomEvent('auth-expired', { detail: { message } }));
  }
  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = new FormData(event.currentTarget);
    if (values.get('newPassword') !== values.get('confirmPassword')) {
      setError('两次新密码不一致，请重新确认。');
      form.current?.querySelector<HTMLInputElement>('[name=confirmPassword]')?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/password', {
        method: 'PATCH',
        body: {
          currentPassword: values.get('currentPassword'),
          newPassword: values.get('newPassword')
        }
      });
      form.current?.reset();
      signedOut('密码已修改，所有设备已退出，请使用新密码登录。');
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api('/api/auth/revoke', { method: 'POST' });
      signedOut('所有登录会话已撤销，请重新登录。');
    } catch (failure) {
      setConfirm(false);
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  }
  // Passwords are never retained in an invisible workspace or a saved draft.
  useEffect(() => {
    if (!active || !security) {
      form.current?.reset();
      setConfirm(false);
    }
  }, [active, security]);
  return (
    <section className="settings-workspace">
      <WorkspaceHeader
        group={security ? '我的' : '业务管理'}
        title={security ? '账号安全' : '预约配置'}
      />
      <div hidden={!security} className="security-layout">
        <section className="field-card security-profile">
          <h2>当前账号</h2>
          <dl>
            <div>
              <dt>姓名</dt>
              <dd>{user.name}</dd>
            </div>
            <div>
              <dt>账号</dt>
              <dd>{user.account}</dd>
            </div>
            <div>
              <dt>所属校区</dt>
              <dd>{user.homeCampus}</dd>
            </div>
            <div>
              <dt>授权校区</dt>
              <dd>{user.authorizedCampuses?.join('、')}</dd>
            </div>
          </dl>
        </section>
        <section className="field-card">
          <h2>修改密码</h2>
          <p className="field-muted">修改成功后，所有设备均需重新登录。</p>
          <form ref={form} className="workspace-form" onSubmit={changePassword}>
            <label>
              当前密码
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                disabled={busy}
              />
            </label>
            <label>
              新密码
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                disabled={busy}
                aria-describedby="security-password-hint"
              />
            </label>
            <p id="security-password-hint" className="field-muted">
              使用 8–128 个字符。
            </p>
            <label>
              确认新密码
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                disabled={busy}
              />
            </label>
            <Notice>{error}</Notice>
            <div className="field-actions">
              <button className="field-primary" disabled={busy}>
                {busy ? '正在处理…' : '修改密码并退出'}
              </button>
            </div>
          </form>
        </section>
        <section className="field-card security-sessions">
          <div>
            <h2>设备会话</h2>
            <p className="field-muted">
              无法确认其他设备是否安全时，可让所有设备退出登录，包含当前设备。
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError('');
              setConfirm(true);
            }}
          >
            撤销所有登录会话
          </button>
        </section>
      </div>
      {allowed && (
        <div hidden={security}>
          <CapacityEditor active={active && !security} onNavigate={onNavigate} />
        </div>
      )}
      {confirm && (
        <Modal
          title="撤销所有登录会话？"
          compact
          onClose={() => {
            if (!busy) setConfirm(false);
          }}
        >
          <p>所有设备都会退出登录，你需要重新登录后继续工作。</p>
          <div className="field-actions">
            <button disabled={busy} onClick={() => setConfirm(false)}>
              取消
            </button>
            <button className="field-primary" disabled={busy} onClick={revoke}>
              {busy ? '正在撤销…' : '确认撤销并退出'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}
