import { WorkspaceSkeleton } from './WorkspaceSkeleton';
import React, { useContext, useEffect, useState } from 'react';
import { ActivityContext, api, Notice, time } from './field/ui';
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

export function Attendance({ onNavigate }: { onNavigate: (route: string) => void }) {
  const routeActive = useContext(ActivityContext);
  const [items, setItems] = useState<Record[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pageCursor, setPageCursor] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  useEffect(() => {
    if (!routeActive) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    api<{ items: Record[]; nextCursor: string | null }>(
      '/api/me/attendance' + (pageCursor ? `?cursor=${encodeURIComponent(pageCursor)}` : ''),
      { signal: controller.signal }
    )
      .then((data) => {
        if (!controller.signal.aborted) {
          setItems((previous) =>
            pageCursor
              ? [...new Map([...previous, ...data.items].map((item) => [item.id, item])).values()]
              : data.items
          );
          setNextCursor(data.nextCursor);
        }
      })
      .catch((failure) => {
        if (!controller.signal.aborted) setError(failure.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey, routeActive, pageCursor]);
  return (
    <section className="attendance-history">
      <WorkspaceHeader
        group="我的"
        title="本人签到记录"
        description="当前是否在岗，以今日工作台为准。"
      >
        <button type="button" onClick={() => onNavigate('scene:mine')}>
          返回个人中心
        </button>
      </WorkspaceHeader>
      <Notice>{error}</Notice>
      <section className="field-card" aria-busy={loading}>
        <div className="field-section-heading">
          <h2>签到历史</h2>
          <button
            type="button"
            disabled={loading}
            onClick={() => {
              setPageCursor('');
              setRefreshKey((value) => value + 1);
            }}
          >
            {loading ? '正在更新…' : '刷新记录'}
          </button>
        </div>
        {!items.length && loading && !error && (
          <WorkspaceSkeleton variant="rows" label="正在读取签到记录" />
        )}
        {!items.length && !loading && !error && (
          <p className="field-muted">还没有签到记录。到岗后，请使用扫一扫识别工作人员签到码。</p>
        )}
        <ul className="attendance-history-list">
          {items.map((item) => (
            <li data-motion-item={item.id} key={item.id}>
              <div>
                <strong>{item.businessDate}</strong>
                <span>
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
                <small>{item.nonScheduled ? '非排班到岗' : '已记录'}</small>
              </div>
            </li>
          ))}
        </ul>
        {nextCursor && (
          <div className="field-actions">
            <button
              type="button"
              disabled={loading}
              onClick={() => {
                if (pageCursor === nextCursor) setRefreshKey((value) => value + 1);
                else setPageCursor(nextCursor);
              }}
            >
              {loading ? '正在读取…' : '加载更早的签到'}
            </button>
          </div>
        )}
      </section>
    </section>
  );
}
