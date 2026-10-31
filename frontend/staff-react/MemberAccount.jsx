import React, { useEffect, useState } from 'react';
import { request } from './request.js';
import { Notice } from './field/ui';
import { AccountEditor } from './Accounts.jsx';
import { MemberImport } from './MemberImport.jsx';

export function MemberAccount({ user, detail, onSaved, onDirty, onBusy }) {
  const [item, setItem] = useState(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [importing, setImporting] = useState(false),
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
      account ? `/api/users/${encodeURIComponent(account.account)}` : '/api/staff-whitelist',
      { signal: controller.signal }
    )
      .then((data) => {
        if (account) setItem(data);
        else setEnrollment(data.items?.find((item) => item.studentId === detail.member.studentId));
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [account?.account, account?.authVersion, protectedAccount, importing]);
  const member = detail.member;
  return (
    <div className="member-account">
      <Notice>{error}</Notice>
      {protectedAccount ? (
        <p>此账号受保护，请从账号安全中管理本人密码。</p>
      ) : loading ? (
        <p role="status">正在读取账号…</p>
      ) : account ? (
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
        <>
          <p>尚未创建登录账号</p>
          {enrollment && (
            <p>
              激活资格：
              {{ open: '待激活', revoked: '已撤销', activated: '已激活' }[enrollment.status] ||
                enrollment.status}
            </p>
          )}
          <button onClick={() => setImporting(true)}>配置激活资格</button>
        </>
      )}
      {importing && (
        <MemberImport
          user={user}
          initialCsv={`studentId,name,homeCampusId\n${[member.studentId, member.name, member.homeCampusId].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')}`}
          onClose={() => setImporting(false)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
