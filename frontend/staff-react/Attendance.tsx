import { useInfiniteQuery } from '@tanstack/react-query';
import React, { useContext } from 'react';
import { ActivityContext, Notice, time } from './field/ui';
import { WorkspaceHeader } from './WorkspaceHeader';

type Record = {
  id: string;
  businessDate: string;
  occurredAt: string;
  campusId?: string;
  type: string;
  nonScheduled: boolean;
};
const campusNames: { [key: string]: string } = {
  'campus-nanhu': '南湖校区',
  'campus-hunnan': '浑南校区'
};

export function Attendance({
  onNavigate,
  embedded = false
}: {
  onNavigate?: (route: string) => void;
  embedded?: boolean;
}) {
  const routeActive = useContext(ActivityContext);
  const result = useInfiniteQuery<{ items: Record[]; nextCursor: string | null }>({
    queryKey: ['/api/me/attendance'],
    enabled: routeActive,
    initialPageParam: '',
    getNextPageParam: (page) => page.nextCursor || undefined,
    staleTime: (query) => (query.state.data?.pages.length > 1 ? 120000 : 30000),
    refetchInterval: (query) => (query.state.data?.pages.length > 1 ? 120000 : 30000)
  });
  const items = [
    ...new Map(
      (result.data?.pages.flatMap((page) => page.items) || []).map((item) => [item.id, item])
    ).values()
  ];
  const error = result.error?.message;
  const loading = result.isPending;

  return (
    <section className="attendance-history">
      {!embedded && (
        <WorkspaceHeader group="我的" title="本人签到记录">
          <button type="button" onClick={() => onNavigate?.('scene:mine')}>
            返回个人中心
          </button>
        </WorkspaceHeader>
      )}
      <Notice>{error}</Notice>
      <section className="field-card" aria-busy={loading}>
        <div className="field-section-heading">
          <h2>签到历史</h2>
          <button type="button" disabled={result.isFetching} onClick={() => result.refetch()}>
            刷新记录
          </button>
        </div>
        {!items.length && !loading && !error && <p className="field-muted">暂无签到记录。</p>}
        <ul className="attendance-history-list">
          {items.map((item) => (
            <li data-motion-item={item.id} key={item.id}>
              <div>
                <strong data-motion-value="text">{item.businessDate}</strong>
                <span data-motion-value="text">
                  {item.type === 'duty'
                    ? '值班签到'
                    : item.type === 'meeting'
                      ? '活动签到'
                      : '签到记录'}{' '}
                  · {item.campusId ? campusNames[item.campusId] || '指定校区' : '场次指定地点'}
                </span>
              </div>
              <div>
                <time dateTime={item.occurredAt}>{time(item.occurredAt)}</time>
                {item.nonScheduled && <small data-motion-value="text">非排班到岗</small>}
              </div>
            </li>
          ))}
        </ul>
        {result.hasNextPage && (
          <div className="field-actions">
            <button
              type="button"
              disabled={result.isFetching}
              onClick={() => result.fetchNextPage({ cancelRefetch: false })}
            >
              加载更早的签到
            </button>
          </div>
        )}
      </section>
    </section>
  );
}
