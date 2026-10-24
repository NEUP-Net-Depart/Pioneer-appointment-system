import { useContext, useEffect, useRef, useState } from 'react';
import { request } from './request.js';
import { ActivityContext } from './field/ui';
import { staffPermission } from '../../shared/staff-access.js';
import { preferredRosterPeriod } from '../../shared/roster-collections.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { key } from './roster-workflow-shared.js';

export function useRosterWorkflow({ user, office = false }) {
  const active = useContext(ActivityContext),
    canCreate = staffPermission(user, office ? 'roster.office.manage' : 'roster.repair.manage');
  const [tasks, setTasks] = useState([]),
    [taskId, setTaskId] = useState(''),
    [data, setData] = useState(null),
    [rows, setRows] = useState([]);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [loading, setLoading] = useState(false),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false),
    [panel, setPanel] = useState(''),
    [choosing, setChoosing] = useState(null),
    [query, setQuery] = useState(''),
    [confirmOverride, setConfirmOverride] = useState(null);
  const [mobileDay, setMobileDay] = useState(0),
    [reopenDeadline, setReopenDeadline] = useState(''),
    [requirementsDirty, setRequirementsDirty] = useState(false);
  const [overrideIssues, setOverrideIssues] = useState([]),
    [overrideReason, setOverrideReason] = useState('');
  const [extraPeople, setExtraPeople] = useState([]),
    [addedPeople, setAddedPeople] = useState([]);
  const [poolQuery, setPoolQuery] = useState(''),
    [view, setView] = useState('auto'),
    [candidatePool, setCandidatePool] = useState('all'),
    [showConflicts, setShowConflicts] = useState(false);
  const lock = useRef(false),
    serial = useRef(0),
    readController = useRef(null),
    command = useRef(null);
  const listedTask = tasks.find((item) => item.id === taskId);
  const manage = !!listedTask?.actions?.manage;
  const task = data?.task ? { ...listedTask, ...data.task } : listedTask,
    draft = data?.draft,
    editable = manage && draft?.status === 'draft',
    collecting = data?.collectionState === 'open';
  async function loadTasks(preferred) {
    const result = await request('/api/roster-tasks');
    const items = result.items.filter(
      (item) =>
        (office ? item.dutyType === 'office' : item.dutyType !== 'office') &&
        (item.actions?.manage || item.actions?.configure)
    );
    setTasks(items);
    setTaskId(
      (current) =>
        preferred ||
        (items.some((item) => item.id === current) ? current : preferredRosterPeriod(items)?.id) ||
        ''
    );
  }
  async function load(id, { background = false } = {}) {
    const seq = ++serial.current;
    readController.current?.abort();
    const controller = new AbortController();
    readController.current = controller;
    if (!background) setLoading(true);
    try {
      const result = await request(
        `/api/roster-tasks/${encodeURIComponent(id)}/${manage ? 'roster' : 'requirements'}`,
        { signal: controller.signal }
      );
      if (seq !== serial.current) return;
      setData(result);
      setRows(result.draft?.assignments || []);
      setError('');
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message);
    } finally {
      if (seq === serial.current) setLoading(false);
    }
  }
  useEffect(() => {
    setTasksLoading(true);
    loadTasks()
      .catch((failure) => setError(failure.message))
      .finally(() => setTasksLoading(false));
  }, [office]);
  useEffect(() => {
    setData(null);
    setRows([]);
    setDirty(false);
    setPanel('');
    setView('auto');
    setMobileDay(0);
    if (taskId) load(taskId);
    return () => {
      serial.current++;
      readController.current?.abort();
    };
  }, [taskId, manage]);
  useEffect(() => {
    if (!active || !taskId || dirty || requirementsDirty || busy || panel || choosing) return;
    const refresh = () => {
      if (!document.hidden) load(taskId, { background: true });
    };
    const timer = setInterval(refresh, 30000);
    const visibility = () => {
      if (document.hidden) readController.current?.abort();
      else refresh();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(timer);
      readController.current?.abort();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [active, taskId, dirty, requirementsDirty, busy, panel, choosing]);
  useUnsavedChanges({
    dirty,
    active,
    busy,
    save: () =>
      run(
        'save',
        `/api/rosters/${draft.id}`,
        { version: draft.version, assignments: rows },
        'PATCH'
      ),
    discard: () => {
      setRows(draft.assignments);
      setDirty(false);
      setChoosing(null);
      setConfirmOverride(null);
      setPanel('');
    }
  });
  async function run(kind, path, body, method = 'POST') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    const signature = JSON.stringify([kind, path, body]);
    if (command.current?.signature !== signature)
      command.current = { signature, id: crypto.randomUUID() };
    try {
      await request(path, { method, body: { ...body, requestId: command.current.id } });
      command.current = null;
      setDirty(false);
      setPanel('');
      if (['generate', 'save', 'publish', 'revise'].includes(kind)) setView('roster');
      else if (['close', 'reopen'].includes(kind)) setView('auto');
      await load(taskId);
      await loadTasks();
      setNotice(
        {
          save: '调整已保存，已重新校验。',
          publish: '班表已发布，成员端将显示最新安排。',
          close: '收集已结束，可以生成自动排班。',
          reopen: '收集已重新开放，现有班表保持不变。',
          generate: '已生成排班草稿，请处理缺口并核对安排。',
          revise: '已复制当前班表。修订发布前，原班表继续生效。',
          series: '收集设置已更新。',
          participants: '参与人员已增补。'
        }[kind]
      );
    } catch (failure) {
      setError(failure.message);
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
    return true;
  }
  async function openParticipants() {
    setError('');
    try {
      const result = await request('/api/roster-tasks/candidates', { method: 'POST', body: task });
      setExtraPeople(result.items.filter((item) => !task.memberIds.includes(item.memberId)));
      setAddedPeople([]);
      setPanel('participants');
    } catch (failure) {
      setError(failure.message);
    }
  }
  const change = (next) => {
    serial.current++;
    readController.current?.abort();
    setRows(next);
    setDirty(true);
    setNotice('');
  };
  const members = data?.members || [],
    slots = data?.slots || [],
    names = new Map(members.map((item) => [item.memberId, item.name]));
  const protectedRows = data?.protectedAssignments || [];
  const protectedPerson = (row) =>
    protectedRows.some(
      (item) => item.memberId === row.memberId && item.businessDate === row.businessDate
    );
  const selectedAssignment =
    choosing?.memberId &&
    rows.find(
      (row) =>
        row.memberId === choosing.memberId &&
        key(row) === (choosing.sourceKey || key(choosing.slot))
    );
  function assign(member, slot, override = false) {
    if (selectedAssignment && protectedPerson(selectedAssignment)) return;
    if (
      rows.some(
        (row) =>
          row.memberId === member.memberId &&
          (!office || row.businessDate === slot.businessDate) &&
          protectedPerson(row)
      )
    )
      return;
    const reported = member.available.some((item) => key(item) === key(slot));
    const moving =
      selectedAssignment && key(selectedAssignment) !== key(slot) ? [selectedAssignment] : [];
    const replacing = choosing?.replaceId && names.get(choosing.replaceId);
    if (
      !override &&
      (!reported ||
        moving.length ||
        replacing ||
        (!selectedAssignment && rows.some((row) => row.memberId === member.memberId)))
    ) {
      setConfirmOverride({ member, slot, reported, moving, replacing });
      return;
    }
    const retained = rows.filter(
      (row) =>
        !moving.includes(row) && !(choosing?.replaceId === row.memberId && key(row) === key(slot))
    );
    change([
      ...retained,
      {
        ...slot,
        memberId: member.memberId,
        roleKind: office
          ? selectedAssignment?.roleKind || ''
          : member.pool === 'lead'
            ? 'repair_lead'
            : '',
        manualOverride: !reported,
        locked: selectedAssignment?.locked || false
      }
    ]);
    if (choosing?.memberId) setChoosing((current) => ({ ...current, sourceKey: key(slot) }));
    setConfirmOverride(null);
  }
  const previous = data?.publishedAssignments || [];
  const signature = (row) => `${row.memberId}:${key(row)}:${row.roleKind || ''}`;
  const differences = [
    ...previous
      .filter((row) => !rows.some((item) => signature(item) === signature(row)))
      .map((row) => ({ row, kind: '移除' })),
    ...rows
      .filter((row) => !previous.some((item) => signature(item) === signature(row)))
      .map((row) => ({ row, kind: '安排' }))
  ];
  const unassigned = members.filter(
    (member) => !rows.some((row) => row.memberId === member.memberId)
  );
  const candidateSlots = (member) => member.manualSlots || member.available;
  const collectionView = view === 'collection' || (view === 'auto' && collecting);
  const stage =
    collecting && !collectionView && draft
      ? draft.status === 'draft'
        ? data?.publishedVersion
          ? 'revising'
          : 'adjusting'
        : 'published'
      : data?.stage || 'ready';
  const showBoard = manage && !!draft && !collectionView;
  const assignmentCount = (member) => rows.filter((row) => row.memberId === member.memberId).length;
  const visibleCandidates = choosing
    ? [...members]
        .sort(
          (a, b) => assignmentCount(a) - assignmentCount(b) || a.name.localeCompare(b.name, 'zh-CN')
        )
        .filter(
          (member) =>
            (!choosing.memberId || member.memberId === choosing.memberId) &&
            member.name.includes(query) &&
            (candidatePool === 'all' ||
              office ||
              choosing.memberId ||
              member.pool === candidatePool) &&
            (showConflicts ||
              choosing.memberId ||
              candidateSlots(member).some((slot) => key(slot) === key(choosing.slot)))
        )
    : [];
  return {
    active,
    canCreate,
    tasks,
    taskId,
    setTaskId,
    data,
    setData,
    rows,
    setRows,
    tasksLoading,
    loading,
    busy,
    dirty,
    setDirty,
    error,
    setError,
    notice,
    setNotice,
    creating,
    setCreating,
    panel,
    setPanel,
    choosing,
    setChoosing,
    query,
    setQuery,
    confirmOverride,
    setConfirmOverride,
    mobileDay,
    setMobileDay,
    reopenDeadline,
    setReopenDeadline,
    requirementsDirty,
    setRequirementsDirty,
    overrideIssues,
    setOverrideIssues,
    overrideReason,
    setOverrideReason,
    extraPeople,
    addedPeople,
    setAddedPeople,
    poolQuery,
    setPoolQuery,
    setView,
    candidatePool,
    setCandidatePool,
    showConflicts,
    setShowConflicts,
    manage,
    task,
    draft,
    editable,
    collecting,
    loadTasks,
    load,
    run,
    openParticipants,
    change,
    members,
    slots,
    names,
    protectedPerson,
    selectedAssignment,
    assign,
    differences,
    unassigned,
    candidateSlots,
    collectionView,
    stage,
    showBoard,
    assignmentCount,
    visibleCandidates
  };
}
