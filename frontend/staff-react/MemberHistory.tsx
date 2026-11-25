import type { ItemsResponse } from '../../shared/api-types.ts';

interface MemberAuditItem {
  action: string;
  changes?: string[];
  occurredAt: string;
  actorAccount?: string | null;
  reason?: string;
}
import { useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActivityContext, Notice } from './field/ui';
import { DataExpansion } from './DataExpansion.tsx';

const labels = {
  'identity.member.created': '新增人员',
  'identity.member.imported': '导入更新',
  'identity.member.updated': '修改资料',
  'identity.retired_elder.granted': '授予退休老登身份',
  'identity.retired_elder.revoked': '撤销退休老登身份',
  'identity.qualification.granted': '新增工作资格',
  'identity.qualification.ended': '结束工作资格',
  'identity.qualification.archived': '工作资格历史归档',
  'organization.membership.updated': '新增任职',
  'organization.membership.ended': '结束任职',
  'authorization.member_roles.updated': '修改特殊授权',
  'authorization.member_activation.updated': '更新账号激活信息',
  'authorization.account.updated': '修改登录账号'
};
export function MemberHistory({ memberId }: { memberId: string }) {
  const result = useQuery<ItemsResponse<MemberAuditItem>>({
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
          ? items.map((item, index: number) => (
              <article className="react-binding" key={index}>
                <strong>{labels[item.action as keyof typeof labels] || item.action}</strong>
                {!!item.changes?.length && <p>{item.changes.join('、')}</p>}
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
