import { LogIn, QrCode } from 'lucide-react';
import { canSelfCheckIn } from './attendance-state';
import type { Home } from './types';

export function AttendanceCheckInButton({
  data,
  busy,
  onCheckIn
}: {
  data: Home;
  busy: boolean;
  onCheckIn: () => void;
}) {
  if (!canSelfCheckIn(data)) return null;
  return (
    <button
      data-track="staff.field.attendanceactions.button.1"
      className="field-primary"
      disabled={busy}
      onClick={onCheckIn}
    >
      {data.directAttendance?.allowed ? '到岗签到' : '扫码签到'}
    </button>
  );
}

export function AttendanceActions({
  data,
  busy,
  onCheckIn,
  onShowCode
}: {
  data: Home;
  busy: boolean;
  onCheckIn: () => void;
  onShowCode?: () => void;
}) {
  const manage = !!onShowCode && data.capability['attendance.token.issue'];
  const pending = canSelfCheckIn(data);
  if (!manage && !pending) return null;
  const campus = data.campuses.find((item) => item.id === data.campusId)?.name;
  return (
    <section className="attendance-shortcuts" aria-label="签到快捷操作">
      {manage && (
        <div className="field-card attendance-quick-action">
          <QrCode aria-hidden="true" />
          <div>
            <h2>现场签到码</h2>
            <p className="field-muted">
              {campus}校区
              <span className="attendance-action-description"> · 供现场工作人员扫码签到</span>
            </p>
          </div>
          <button
            data-track="staff.field.attendanceactions.button.2"
            disabled={busy}
            onClick={onShowCode}
          >
            展示签到码
          </button>
        </div>
      )}
      {pending && (
        <div className="field-card attendance-quick-action attendance-pending">
          <LogIn aria-hidden="true" />
          <div>
            <h2>到岗签到</h2>
            <p className="field-muted">
              {campus}校区
              <span className="attendance-action-description"> · 到岗后签到一次即可</span>
            </p>
          </div>
          <AttendanceCheckInButton data={data} busy={busy} onCheckIn={onCheckIn} />
        </div>
      )}
    </section>
  );
}
