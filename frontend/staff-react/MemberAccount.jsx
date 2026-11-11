import { useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { request } from './request.js';
import { ActivityContext, Notice } from './field/ui';
import { AccountEditor } from './Accounts.jsx';

const activationStatus = {
  unset: '未设置',
  open: '待激活',
  revoked: '已撤销',
  activated: '已激活'
};

function MemberActivation({ memberId, value, onSaved, onBusy }) {
  const [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  const callbacks = useRef({ onSaved, onBusy });
  callbacks.current = { onSaved, onBusy };
  const preparing = value.status === 'unset' && value.canConfigure;
  useEffect(() => {
    if (!preparing) return;
    let active = true;
    setError('');
    callbacks.current.onBusy?.(true);
    request(`/api/members/${encodeURIComponent(memberId)}/activation`, {
      method: 'POST',
      body: { authorizedCampuses: value.authorizedCampuses, stateToken: value.stateToken }
    })
      .then(async () => {
        if (active) await callbacks.current.onSaved();
      })
      .catch((failure) => {
        if (active) setError(failure.message);
      })
      .finally(() => {
        if (active) callbacks.current.onBusy?.(false);
      });
    return () => {
      active = false;
      callbacks.current.onBusy?.(false);
    };
  }, [memberId, value.stateToken, preparing, retry]);
  return (
    <section aria-label="账号激活状态" aria-busy={preparing && !error}>
      <Notice>{error}</Notice>
      <p>尚未创建登录账号</p>
      <p data-motion-value="text">
        激活状态：{preparing ? '准备中' : activationStatus[value.status]}
      </p>
      <p>授权校区：{value.authorizedCampuses.join('、') || '未设置'}</p>
      <p>额外系统授权：{value.roleNames.join('、') || '无'}</p>
      {!value.canConfigure && <p role="alert">请先确认成员状态正常且已设置授权校区。</p>}
      <p>成员可从登录页提交激活申请，由部长及以上负责人审核。</p>
      {error && <button onClick={() => setRetry((value) => value + 1)}>重试读取</button>}
    </section>
  );
}

export function MemberAccount({ user, detail, onSaved, onDirty, onBusy }) {
  const account = detail.account;
  const protectedAccount = account?.protected || detail.member.memberId === user.memberId;
  const client = useQueryClient();
  const queryKey = [
    account
      ? `/api/users/${encodeURIComponent(account.account)}`
      : `/api/members/${encodeURIComponent(detail.member.memberId)}/activation`
  ];
  const result = useQuery({
    queryKey,
    enabled: useContext(ActivityContext) && !protectedAccount,
    refetchInterval: false
  });
  const loading = !protectedAccount && result.isPending;
  const error = result.error?.message;
  const item = account ? result.data : null;
  const enrollment = !account ? result.data : null;
  const saved = async () => {
    await client.invalidateQueries({ queryKey });
    const affectedQueries = {
      predicate: (query) =>
        ['/api/users', '/api/staff-whitelist', '/api/activation-requests'].includes(
          query.queryKey[0]
        )
    };
    await client.cancelQueries(affectedQueries);
    await client.invalidateQueries(affectedQueries);
    await onSaved();
  };

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
            onSaved={saved}
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
            onSaved={saved}
            onBusy={onBusy}
          />
        )
      )}
    </div>
  );
}
