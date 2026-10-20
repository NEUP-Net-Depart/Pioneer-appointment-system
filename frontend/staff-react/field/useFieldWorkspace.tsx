import { useEffect, useState } from 'react';
import { api } from './ui';
import { useField } from './useField';
import type { Home } from './types';
import { compareFieldPeople } from '../../../shared/staff-identities.js';

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
  onContextChange?: (home: Home) => void;
  active?: boolean;
  onLogout: () => void;
  onNavigate: (view: string) => void;
}) {
  const key = `field-scene:${initial.actor.memberId}`;
  const [scene, setScene] = useState(
    () =>
      requestedScene ||
      (initial.currentRepair
        ? 'repair'
        : initial.contexts.find((c) => c.id === sessionStorage.getItem(key))?.id ||
          initial.contexts.find((c) => c.id === 'desk')?.id ||
          initial.contexts[0]?.id ||
          'mine')
  );
  useEffect(() => {
    if (
      requestedScene &&
      (requestedScene === 'mine' ||
        initial.contexts.some((context) => context.id === requestedScene))
    )
      setScene(requestedScene);
  }, [requestedScene, initial.contexts]);
  const [campus, setCampus] = useState(initial.campusId),
    [selected, setSelected] = useState(''),
    [scanOpen, setScanOpen] = useState(false),
    [registration, setRegistration] = useState(false);
  const [message, setMessage] = useState(''),
    [token, setToken] = useState<{ token: string; expiresAt: string } | null>(null),
    [checkToken, setCheckToken] = useState('');
  const [checkResult, setCheckResult] = useState<{
    occurredAt: string;
    type?: string;
    campusId?: string;
    isExisting?: boolean;
    nonScheduled?: boolean;
    identitySnapshot?: { identities?: { code: string; label: string }[] };
  } | null>(null);
  const [checkPreview, setCheckPreview] = useState<{
    campusName: string;
    businessDate: string;
    startsAt: string;
    endsAt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [filter, setFilter] = useState('all'),
    [search, setSearch] = useState(''),
    [tab, setTab] = useState('appointments'),
    [showAvailable, setShowAvailable] = useState(false),
    [peopleQuery, setPeopleQuery] = useState('');
  const result = useField(
      campus,
      scene,
      `${initial.actor.memberId}:${initial.authVersion}`,
      initial,
      active
    ),
    data = result.data;
  const refresh = result.refresh;
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
    if (!data) return;
    onContextChange?.(data);
    if (scene !== 'mine' && !data.contexts.some((context) => context.id === scene)) {
      const next = data.contexts[0]?.id || 'mine';
      setScene(next);
      onSceneChange?.(next);
      setSelected('');
      setScanOpen(false);
    }
  }, [data, scene, onContextChange, onSceneChange]);
  useEffect(() => {
    sessionStorage.setItem(key, scene);
  }, [key, scene]);
  async function execute(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
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
        }>('/api/attendance/preview', {
          method: 'POST',
          body: { token: value }
        });
        setScanOpen(false);
        setCheckPreview(preview);
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
    if (data?.directAttendance?.allowed) void checkIn('');
    else {
      setMessage('');
      setScanOpen(true);
    }
  }
  async function checkIn(value: string) {
    await execute(async () => {
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
        const recovered = await api<{ items: NonNullable<typeof checkResult>[] }>(
          '/api/me/attendance?businessDate=' + (data?.businessDate || initial.businessDate)
        );
        const existing = recovered.items.find(
          (item) => item.type === 'duty' && item.campusId === campus
        );
        if (!existing) throw error;
        record = { ...existing, isExisting: true };
      }
      setCheckResult(record);
      setCheckToken('');
      setScanOpen(false);
      setMessage('签到成功，已更新到岗状态');
      await refresh();
    });
  }
  async function presence(state: string) {
    await execute(async () => {
      await api('/api/presence/me', {
        method: 'PATCH',
        body: {
          state,
          campusId: data!.presence!.campusId,
          revision: data!.presence!.revision
        }
      });
      await refresh();
    });
  }
  const items = (data?.appointments || []).filter(
    (item) =>
      (filter === 'all' || item.status === filter) &&
      `${item.id} ${item.deviceModel} ${item.faultType}`
        .toLowerCase()
        .includes(search.toLowerCase())
  );
  const people = [...(data?.staffPresence || [])].sort(compareFieldPeople);
  const visiblePeople = people.filter(
    (person) =>
      (!showAvailable || person.canReceive) &&
      `${person.name} ${person.department || ''} ${person.identities?.map((identity) => identity.label).join(' ') || ''}`.includes(
        peopleQuery.trim()
      )
  );
  const campusName = data?.campuses.find((c) => c.id === campus)?.name || '';
  return {
    key,
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
    filter,
    setFilter,
    search,
    setSearch,
    tab,
    setTab,
    showAvailable,
    setShowAvailable,
    peopleQuery,
    setPeopleQuery,
    result,
    data,
    refresh,
    resolve,
    showAttendance,
    openAttendance,
    checkIn,
    presence,
    items,
    people,
    visiblePeople,
    campusName
  };
}
