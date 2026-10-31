import React, { useEffect, useState } from 'react';
import { request } from './request.js';
import { Notice } from './field/ui';

const labels = {
  'identity.member.created': '新增人员',
  'identity.member.imported': '导入更新',
  'identity.member.updated': '修改资料',
  'identity.qualification.granted': '新增工作资格',
  'identity.qualification.ended': '结束工作资格',
  'organization.membership.updated': '新增任职',
  'organization.membership.ended': '结束任职',
  'authorization.member_roles.updated': '修改角色授权'
};
export function MemberHistory({ memberId }) {
  const [items, setItems] = useState([]),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    request(`/api/members/${encodeURIComponent(memberId)}/audit`, { signal: controller.signal })
      .then((data) => setItems(data.items || []))
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [memberId]);
  return (
    <section aria-label="人员操作记录">
      <Notice>{error}</Notice>
      {loading ? (
        <p role="status">正在读取操作记录…</p>
      ) : items.length ? (
        items.map((item, index) => (
          <article className="react-binding" key={index}>
            <strong>{labels[item.action] || item.action}</strong>
            <p>
              {new Date(item.occurredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} ·{' '}
              {item.actorAccount}
            </p>
            {item.reason && <p>{item.reason}</p>}
          </article>
        ))
      ) : (
        !error && <p>暂无操作记录</p>
      )}
    </section>
  );
}
