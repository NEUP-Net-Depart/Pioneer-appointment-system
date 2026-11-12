import { recentlyActive } from '../../../shared/telemetry-client.js';
import { useEffect, useRef, useState } from 'react';
import { api } from './ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttendanceRecord, Home } from './types';
import { canSelfCheckIn, applyAttendance } from './attendance-state';
import { readFieldCampus, writeFieldCampus } from '../field-campus.js';

export function useFieldWorkspace({
  initial,
  onNavigate,
  workspaceLinks = [],
  requestedScene,
  onSceneChange,
  onContextChange,
  active = true,
  onLogout
}: {
  initial: Home;
  workspaceLinks?: { id: string; label: string; group?: string }[];
  requestedScene?: string | null;
  onSceneChange?: (scene: string) => void;
  onContextChange?: (resource: string, campusId: string) => void;
  active?: boolean;
  onLogout: () => void;
  onNavigate: (view: string) => void;
}) {
  const client = useQueryClient();
  const key = `field-scene:${initial.actor.memberId}`;
  const scene =
    requestedScene ||
    initial.contexts.find((c) => c.id === sessionStorage.getItem(key))?.id ||
    initial.contexts[0]?.id ||
    'mine';
  const sessionKey = `${initial.actor.memberId}:${initial.authVersion}`;
  const [chosenCampuses, setChosenCampuses] = useState(
      () =>
        ({
          today: readFieldCampus(sessionKey, initial.campuses) || initial.campusId,
          mine: initial.campusId
        }) as Record<string, string>
    ),
    [selected, setSelected] = useState(''),
    [scanOpen, setScanOpen] = useState(false),
    [registration, setRegistration] = useState(false);
  const [message, setMessage] = useState(''),
    [token, setToken] = useState<{ token: string; expiresAt: string } | null>(null),
    [checkToken, setCheckToken] = useState('');
  const [checkResult, setCheckResult] = useState<AttendanceRecord | null>(null);
  const [checkPreview, setCheckPreview] = useState<{
    campusId: string;
    campusName: string;
    businessDate: string;
    startsAt: string;
    endsAt: string;
    type: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const chosenCampus = chosenCampuses[scene];
  const campus = initial.campuses.some((item) => item.id === chosenCampus)
    ? chosenCampus
    : initial.campusId;
  const resource = scene === 'today' ? '/api/field/board' : '/api/field/home';
  const result = useQuery<Home>({
    queryKey: [resource, { campusId: campus }],
    enabled: active,
    initialData:
      resource === '/api/field/home' && initial.campusId === campus ? initial : undefined,
    initialDataUpdatedAt: Date.parse(initial.updatedAt),
    queryFn: async ({ signal, queryKey }) => {
      try {
        return await api<Home>(`${resource}?campusId=${encodeURIComponent(campus)}`, {
          signal,
          timeoutMs: 15000,
          telemetryPoll: !!client.getQueryState(queryKey)?.dataUpdatedAt && !recentlyActive()
        });
      } catch (error) {
        if ((error as Error & { status?: number }).status !== 403) throw error;
        const home = await api<Home>('/api/field/home', { signal, timeoutMs: 15000 });
        if (home.campusId !== campus && home.campuses.some((item) => item.id === campus))
          return api<Home>('/api/field/home?campusId=' + encodeURIComponent(campus), {
            signal,
            timeoutMs: 15000
          });
        return home;
      }
    }
  });
  const data = result.data?.campusId === campus ? result.data : null;
  const refresh = () =>
    Promise.all(
      (scene === 'mine'
        ? [resource, '/api/me/profile', '/api/me/volunteer-summary', '/api/me/roster']
        : [resource]
      ).map((path) => client.invalidateQueries({ queryKey: [path] }, { throwOnError: true }))
    );
  function setCampus(value: string) {
    if (busy || !initial.campuses.some((item) => item.id === value)) return;
    if (scene === 'today') writeFieldCampus(sessionKey, value);
    setChosenCampuses((current) => ({ ...current, [scene]: value }));
    setSelected('');
    setMessage('');
    setScanOpen(false);
    setRegistration(false);
    setToken(null);
    setCheckToken('');
    setCheckPreview(null);
    setCheckResult(null);
  }
  useEffect(() => {
    if (chosenCampus !== campus) {
      if (scene === 'today') writeFieldCampus(sessionKey, campus);
      setChosenCampuses((current) => ({ ...current, [scene]: campus }));
    }
  }, [chosenCampus, campus, sessionKey, scene]);
  useEffect(() => {
    setScanOpen(false);
    setToken(null);
    setCheckToken('');
    setCheckPreview(null);
    setCheckResult(null);
  }, [campus]);
  useEffect(() => {
    if (active) return;
    // Leaving the route must release device-backed UI immediately. The
    // selected repair remains mounted so an unfinished form can be resumed.
    setScanOpen(false);
    setToken(null);
    setCheckToken('');
    setCheckPreview(null);
    setCheckResult(null);
  }, [active]);
  useEffect(() => {
    onContextChange?.(resource, campus);
  }, [resource, campus, onContextChange]);
  useEffect(() => {
    if (!result.data) return;
    if (!data) return;
    if (scene !== 'mine' && !data.contexts.some((context) => context.id === scene)) {
      const next = data.contexts[0]?.id || 'mine';
      onSceneChange?.(next);
      setSelected('');
      setScanOpen(false);
    }
  }, [result.data, data, scene, onSceneChange]);
  useEffect(() => {
    sessionStorage.setItem(key, scene);
  }, [key, scene]);
  async function execute(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function resolve(value: string) {
    if (value.startsWith('pioneer:attendance:v1:')) {
      await execute(async () => {
        const preview = await api<{
          campusName: string;
          businessDate: string;
          startsAt: string;
          endsAt: string;
          type: string;
        }>('/api/attendance/preview', {
          method: 'POST',
          body: { token: value }
        });
        setScanOpen(false);
        setCheckPreview({
          ...preview,
          campusId: data?.campuses.find((item) => item.name === preview.campusName)?.id || ''
        });
        setCheckToken(value);
      });
      return;
    }
    await execute(async () => {
      const item = await api<{ id: string }>('/api/scan/resolve', {
        method: 'POST',
        body: value.includes('.') ? { code: value } : { id: value }
      });
      setScanOpen(false);
      setSelected(item.id);
    });
  }
  async function showAttendance() {
    await execute(async () => {
      const event = await api<{ id: string; revision: number }>('/api/attendance/events', {
        method: 'POST',
        body: {
          campusId: campus,
          businessDate: data!.businessDate,
          type: 'duty',
          requestId: crypto.randomUUID()
        }
      });
      const credential = await api<{ token: string; expiresAt: string }>(
        `/api/attendance/events/${event.id}/token`,
        { method: 'POST', body: { revision: event.revision } }
      );
      setToken(credential);
    });
  }
  function openAttendance() {
    if (!data || data.campusId !== campus || !canSelfCheckIn(data)) return;
    if (data?.directAttendance?.allowed) void checkIn('');
    else {
      setMessage('');
      setScanOpen(true);
    }
  }
  async function checkIn(value: string) {
    await execute(async () => {
      const target = value ? checkPreview : { campusId: campus, businessDate: data!.businessDate };
      if (!target) throw new Error('请重新扫描工作人员签到码');
      let record;
      try {
        record = await api<NonNullable<typeof checkResult>>(
          value ? '/api/attendance/check-ins' : '/api/attendance/self-check-in',
          {
            method: 'POST',
            body: value
              ? { token: value, method: 'qr', requestId: crypto.randomUUID() }
              : { campusId: campus, requestId: crypto.randomUUID() }
          }
        );
      } catch (error) {
        const status = (error as Error & { status?: number }).status;
        if ((status && status < 500) || (value && checkPreview?.type !== 'duty')) throw error;
        const recovered = await api<{ items: AttendanceRecord[] }>(
          '/api/me/attendance?' +
            new URLSearchParams({ businessDate: target.businessDate, campusId: target.campusId })
        );
        const existing = recovered.items.find(
          (item) =>
            item.type === 'duty' &&
            item.campusId === target.campusId &&
            item.businessDate === target.businessDate
        );
        if (!existing) throw error;
        record = { ...existing, isExisting: true };
      }
      setCheckResult(record);
      await applyAttendance(client, record);
      setCheckToken('');
      setScanOpen(false);
      setCheckPreview(null);
      setMessage(record.isExisting ? '已读取首次签到记录' : '签到成功');
    });
  }
  const campusName = initial.campuses.find((c) => c.id === campus)?.name || '';
  return {
    scene,
    campus,
    setCampus,
    selected,
    setSelected,
    scanOpen,
    setScanOpen,
    registration,
    setRegistration,
    message,
    setMessage,
    token,
    setToken,
    checkToken,
    setCheckToken,
    checkResult,
    setCheckResult,
    checkPreview,
    busy,
    result,
    data,
    refresh,
    resolve,
    showAttendance,
    openAttendance,
    checkIn,
    campusName
  };
}
