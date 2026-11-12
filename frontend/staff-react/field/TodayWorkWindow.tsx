import { Check, QrCode, ArrowUpRight, ScanLine } from 'lucide-react';
import { StaffIdentity } from '../StaffIdentity';
import { RefreshButton } from '../WorkspaceToolbar.jsx';
import { DataValue } from '../DataValue';
import { useWorkStaffing } from '../WorkStaffing.jsx';
import { campusAttendance } from './attendance-state';
import type { Home } from './types';
import './today-work-window.css';

export function TodayWorkWindow({
  data,
  busy,
  onCampus,
  onScan,
  onCheckIn,
  onShowCode,
  onRefresh,
  onPeople
}: {
  data: Home;
  busy: boolean;
  onCampus: (id: string) => void;
  onScan: () => void;
  onCheckIn: () => void;
  onShowCode: () => void;
  onRefresh: () => Promise<unknown>;
  onPeople: (kind: string) => void;
}) {
  const manage = data.capability['attendance.token.issue'];
  const canRead = manage || data.permissions['attendance.correct'];
  const staffing = useWorkStaffing(data.campusId, !!canRead);
  const signed = campusAttendance(data);
  const scheduled = data.todayDuties.some(
    (duty) => duty.leaveStatus !== 'recorded' && !duty.servicePaused
  );
  const date = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    weekday: 'long'
  }).format(new Date(`${data.businessDate}T12:00:00+08:00`));
  return (
    <section className="today-work-window" aria-label="工作视窗">
      <div className="work-window-heading">
        <div>
          <h2 className="work-window-eyebrow">今日工作</h2>
          <h1>欢迎您！</h1>
        </div>
        <div className="work-window-campus" role="group" aria-label="接待校区">
          {data.campuses.length === 1 ? (
            <button
              className="work-window-campus-toggle work-window-campus-single"
              type="button"
              aria-label={data.campuses[0].name}
              aria-pressed="true"
              onClick={() => onCampus(data.campuses[0].id)}
            >
              {data.campuses[0].name}
            </button>
          ) : (
            <button
              className="work-window-campus-toggle"
              type="button"
              disabled={busy || data.campuses.length < 2}
              aria-label={`切换校区，当前${data.campuses.find((campus) => campus.id === data.campusId)?.name || ''}`}
              onClick={() => {
                const current = data.campuses.findIndex((campus) => campus.id === data.campusId);
                onCampus(data.campuses[(current + 1) % data.campuses.length].id);
              }}
            >
              {data.campuses.map((campus, index) => (
                <span
                  key={campus.id}
                  className="work-window-campus-layer"
                  data-selected={campus.id === data.campusId}
                  style={{
                    transform:
                      campus.id === data.campusId
                        ? 'translate(0, 8px)'
                        : `translate(${32 + index * 4}px, -12px) scale(.94)`
                  }}
                >
                  {campus.name}
                </span>
              ))}
            </button>
          )}
        </div>
      </div>
      <div className="work-window-meta">
        <div className="work-window-identities">
          <StaffIdentity
            identities={data.identities.filter((identity) => identity.code !== 'staff')}
          />
        </div>
        <div className="work-window-context">
          <time dateTime={data.businessDate}>{date}</time>
          <span className="work-window-statuses">
            {data.rosterParticipant && <b>{scheduled ? '今日值班' : '今日无排班'}</b>}
            <b className="work-window-check-status" data-signed={!!signed} aria-live="polite">
              {signed ? '已签到' : '还未签到'}
            </b>
          </span>
        </div>
      </div>
      <div className="work-window-actions">
        <div className="work-window-attendance">
          <button className="work-window-scan" disabled={busy} onClick={onScan}>
            <ScanLine size={18} />
            扫码
          </button>
          {manage && (
            <button disabled={busy} onClick={signed ? onShowCode : onCheckIn}>
              {signed ? <QrCode size={18} /> : <Check size={18} />}
              {signed ? '展示签到码' : '到岗签到'}
            </button>
          )}
          <RefreshButton label="刷新工作台" compactOnMobile disabled={busy} onRefresh={onRefresh} />
        </div>
        {canRead && (
          <div className="work-window-counts">
            {canRead && (
              <button
                onClick={() => onPeople('idle')}
                disabled={!staffing.data || !!staffing.error}
              >
                <span>空闲维修人员</span>
                <DataValue label="空闲维修人数">{staffing.data?.idle.length}</DataValue>
                <ArrowUpRight size={16} />
              </button>
            )}
            {manage && !!staffing.data?.missing?.length && (
              <button onClick={() => onPeople('missing')}>
                <span>应到未签到</span>
                <DataValue label="未签到人数">{staffing.data.missing.length}</DataValue>
                <ArrowUpRight size={16} />
              </button>
            )}
          </div>
        )}
      </div>
      {staffing.error && (
        <p role="status">
          人员状态暂未更新<button onClick={() => staffing.refetch()}>重试</button>
        </p>
      )}
    </section>
  );
}
