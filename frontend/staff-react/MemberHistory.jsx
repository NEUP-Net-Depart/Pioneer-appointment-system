import React, { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActivityContext, Notice } from './field/ui';
import { DataExpansion } from './DataExpansion.jsx';

const labels = {
  'identity.member.created': '新增人员',
  'identity.member.imported': '导入更新',
  'identity.member.updated': '修改资料',
  'identity.qualification.granted': '新增工作资格',
  'identity.qualification.ended': '结束工作资格',
  'identity.qualification.archived': '工作资格历史归档',
  'organization.membership.updated': '新增任职',
  'organization.membership.ended': '结束任职',
  'authorization.member_roles.updated': '修改特殊授权',
  'authorization.member_activation.updated': '配置激活资格',
  'authorization.account.updated': '修改登录账号'
};
export function MemberHistory({ memberId }) {
  const result = useQuery({
    queryKey: [`/api/members/${encodeURIComponent(memberId)}/audit`],
    enabled: useContext(ActivityContext),
    refetchInterval: false
  });
  const items = result.data?.items || [];
  const error = result.error?.message;
  const loading = result.isPending;

  return (
    <section aria-label="人员操作记录" aria-busy={loading}>
      <Notice>{error}</Notice>
      <DataExpansion ready={!loading}>
        {items.length
          ? items.map((item, index) => (
              <article className="react-binding" key={index}>
                <strong>{labels[item.action] || item.action}</strong>
                {item.changes?.length > 0 && <p>{item.changes.join('、')}</p>}
                <p>
                  {new Date(item.occurredAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}{' '}
                  · {item.actorAccount}
                </p>
                {item.reason && <p>{item.reason}</p>}
              </article>
            ))
          : !loading && !error && <p>暂无操作记录</p>}
      </DataExpansion>
    </section>
  );
}
