import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { StaffIdentity } from '../StaffIdentity';
import { Modal, Scanner, api, time } from './ui';
import { applyAttendance } from './attendance-state';
import type { AttendanceRecord, Home } from './types';
import './check-in.css';

type Preview = {
  campusId: string;
  campusName: string;
  businessDate: string;
  startsAt: string;
  endsAt: string;
  type: string;
  memberName: string;
  identities: { code: string; label: string }[];
  availabilityReminder: { weekStart: string; needsAvailability: boolean };
};

export function CheckInDialog({
  home,
  token: initialToken = '',
  scan = false,
  onClose,
  onComplete
}: {
  home: Home;
  token?: string;
  scan?: boolean;
  onClose: () => void;
  onComplete: (record: AttendanceRecord) => void;
}) {
  const client = useQueryClient();
  const [token, setToken] = useState(initialToken);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const scanning = scan && !token;
  const preview = useQuery<Preview>({
    queryKey: ['attendance-confirmation', { token, campusId: home.campusId }],
    queryFn: ({ signal }) =>
      api('/api/attendance/preview', {
        method: 'POST',
        body: token ? { token } : { campusId: home.campusId },
        signal
      }),
    enabled: !scanning,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    retry: false
  });
  const accessDenied =
    (preview.error as (Error & { code?: string }) | null)?.code === 'ATTENDANCE_CHECK_IN_DENIED';
  async function submit() {
    if (lock.current || !preview.data) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      let record: AttendanceRecord;
      try {
        record = await api<AttendanceRecord>(
          token ? '/api/attendance/check-ins' : '/api/attendance/self-check-in',
          {
            method: 'POST',
            body: token
              ? { token, method: 'qr', requestId: crypto.randomUUID() }
              : { campusId: home.campusId, requestId: crypto.randomUUID() }
          }
        );
      } catch (failure) {
        const status = (failure as Error & { status?: number }).status;
        if ((status && status < 500) || preview.data.type !== 'duty') throw failure;
        const recovered = await api<{ items: AttendanceRecord[] }>(
          '/api/me/attendance?' +
            new URLSearchParams({
              businessDate: preview.data.businessDate,
              campusId: preview.data.campusId
            })
        );
        const existing = recovered.items.find(
          (item) =>
            item.type === 'duty' &&
            item.campusId === preview.data.campusId &&
            item.businessDate === preview.data.businessDate
        );
        if (!existing) throw failure;
        record = { ...existing, isExisting: true };
      }
      await applyAttendance(client, record).catch(() => {});
      onComplete(record);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={scanning ? '工作人员签到' : '确认到岗信息'}
      compact={!scanning}
      dismissible={!busy}
      onClose={onClose}
    >
      {scanning ? (
        <Scanner
          onCode={(value) => {
            if (!value.startsWith('pioneer:attendance:v1:')) {
              setError('请扫描工作人员签到码');
              return;
            }
            setError('');
            setToken(value);
          }}
        />
      ) : (
        <div className="check-in-confirmation" aria-busy={preview.isPending}>
          {preview.data ? (
            <>
              <div className="check-in-identity">
                <h2>{preview.data.memberName}</h2>
                <StaffIdentity identities={preview.data.identities} />
                <p>
                  {preview.data.campusName}校区 · {preview.data.businessDate}
                </p>
                <p className="field-muted">
                  {time(preview.data.startsAt)}–{time(preview.data.endsAt)}
                </p>
              </div>
              {preview.data.availabilityReminder.needsAvailability && (
                <p className="check-in-reminder" role="note">
                  下周空闲未填写，请到「我的值班」补填。
                </p>
              )}
            </>
          ) : (
            !preview.error && <p role="status">正在读取签到信息…</p>
          )}
          {preview.error && (
            <>
              <p className="react-error" role="alert">
                {preview.error.message}
              </p>
              {!accessDenied && (
                <button
                  data-track="staff.field.checkin.retry"
                  disabled={busy || preview.isFetching}
                  onClick={() => void preview.refetch()}
                >
                  重新读取
                </button>
              )}
              {scan && (
                <button
                  data-track="staff.field.checkin.rescan"
                  className={accessDenied ? 'field-primary' : undefined}
                  onClick={() => setToken('')}
                >
                  重新扫码
                </button>
              )}
            </>
          )}
          {!preview.error && (
            <button
              data-track="staff.field.checkin.confirm"
              className="field-primary"
              disabled={busy || !preview.data}
              onClick={() => void submit()}
            >
              {busy ? '正在签到…' : '确认签到'}
            </button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="react-error">
          {error}
        </p>
      )}
    </Modal>
  );
}
