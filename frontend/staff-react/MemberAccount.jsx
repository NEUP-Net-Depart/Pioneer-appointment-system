import React, { useEffect, useState } from 'react';
import { request } from './request.js';
import { Notice } from './field/ui';
import { AccountEditor } from './Accounts.jsx';

const activationStatus = {
  unset: '未设置',
  open: '待激活',
  revoked: '已撤销',
  activated: '已激活'
};

function MemberActivation({ memberId, value: initial, onSaved, onDirty, onBusy }) {
  const [value, setValue] = useState(initial),
    [campuses, setCampuses] = useState(initial.authorizedCampuses),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(campuses) !== JSON.stringify(value.authorizedCampuses);
  useEffect(() => {
    onDirty?.(dirty);
    return () => onDirty?.(false);
  }, [dirty, onDirty]);
  useEffect(() => {
    onBusy?.(busy);
    return () => onBusy?.(false);
  }, [busy, onBusy]);
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const updated = await request(`/api/members/${encodeURIComponent(memberId)}/activation`, {
        method: 'POST',
        body: { authorizedCampuses: campuses, stateToken: value.stateToken }
      });
      setValue(updated);
      setSaved(true);
      onDirty?.(false);
      await onSaved();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={save} aria-label="配置激活资格">
      <Notice>{error}</Notice>
      <p>尚未创建登录账号</p>
      <p>激活资格：{saved ? '待激活' : activationStatus[value.status]}</p>
      <p>有效权限：{value.roleNames.join('、') || '尚未授权'}</p>
      {!value.canConfigure && <p role="alert">请先配置有效任职、交流参与或特殊授权。</p>}
      {saved && <p role="status">激活资格已保存</p>}
      <fieldset disabled={busy || !value.canConfigure}>
        <legend>激活授权校区</legend>
        {[...new Set([...value.availableCampuses, ...value.authorizedCampuses])]
          .sort()
          .map((campus) => (
            <label className="workspace-check" key={campus}>
              <input
                type="checkbox"
                checked={campuses.includes(campus)}
                onChange={(event) => {
                  setSaved(false);
                  setCampuses((current) =>
                    event.target.checked
                      ? [...current, campus].sort()
                      : current.filter((item) => item !== campus)
                  );
                }}
              />
              {campus}
            </label>
          ))}
        <button className="react-primary" disabled={!campuses.length}>
          {busy ? '正在保存…' : '保存激活资格'}
        </button>
      </fieldset>
    </form>
  );
}

export function MemberAccount({ user, detail, onSaved, onDirty, onBusy }) {
  const [item, setItem] = useState(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [enrollment, setEnrollment] = useState(null);
  const account = detail.account;
  const protectedAccount = account?.protected || detail.member.memberId === user.memberId;
  useEffect(() => {
    if (protectedAccount) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setError('');
    setLoading(true);
    request(
      account
        ? `/api/users/${encodeURIComponent(account.account)}`
        : `/api/members/${encodeURIComponent(detail.member.memberId)}/activation`,
      { signal: controller.signal }
    )
      .then((data) => {
        if (account) setItem(data);
        else setEnrollment(data);
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    account?.account,
    account?.authVersion,
    protectedAccount,
    detail.member.memberId,
    detail.member.revision
  ]);
  return (
    <div className="member-account" aria-busy={loading}>
      <Notice>{error}</Notice>
      {protectedAccount ? (
        <p>此账号受保护，请从账号安全中管理本人密码。</p>
      ) : loading ? null : account ? (
        item && (
          <AccountEditor
            key={JSON.stringify(item)}
            embedded
            user={user}
            item={item}
            onClose={onSaved}
            onSaved={onSaved}
            onDirty={onDirty}
            onBusy={onBusy}
          />
        )
      ) : (
        enrollment && (
          <MemberActivation
            key={enrollment.stateToken}
            memberId={detail.member.memberId}
            value={enrollment}
            onSaved={onSaved}
            onDirty={onDirty}
            onBusy={onBusy}
          />
        )
      )}
    </div>
  );
}
