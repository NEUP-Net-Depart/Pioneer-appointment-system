import { WeekPicker } from './WeekPicker.jsx';
import { HelpHint } from './HelpHint';
import { RefreshButton } from './WorkspaceToolbar.jsx';
import { Select } from './SelectionControls.jsx';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Settings, X } from 'lucide-react';
import React, { useContext, useEffect, useRef, useState } from 'react';
import { ActivityContext, Modal } from './field/ui';
import { request } from './request.js';
import { useUnsavedChanges } from './useUnsavedChanges.js';
import { addDays, dutyWeekKey } from '../../shared/time.js';
import { activeMemberships, membershipLabel } from '../../shared/staff-organization.js';
import {
  dutyChanges,
  dutyDraftShift,
  dutyPlacementIssue,
  dutyTargetKey,
  mergeDutyDraft
} from './duty-draft.js';
import {
  DUTY_START,
  DUTY_END,
  DUTY_TYPES,
  DUTY_WEEKDAYS,
  dutyTypeLabels,
  dutyCampusNames,
  dutyAvailabilityLabel,
  dutyAvailabilityLabels,
  canAssignDuty,
  availableForDuty,
  dutyCandidateTypes,
  dutyPlanningReview,
  manualDutyPriority
} from '../../shared/duty.js';

const weekdayFormat = new Intl.DateTimeFormat('zh-CN', {
  weekday: 'short',
  timeZone: 'Asia/Shanghai'
});
const weekdayName = (day) => weekdayFormat.format(new Date(`${day}T12:00:00Z`));
const shiftName = (row) => `${weekdayName(row.businessDate)} · ${dutyTypeLabels[row.dutyType]}`;
const pickerGroups = ['已选', '当天有空', '其他人员', '已有安排', '时段已占用'];
const unassignedLabel = {
  missing_availability: dutyAvailabilityLabels.missing,
  other_campus: '本校区无空闲',
  paused: '空闲日停服'
};
const unassignedOrder = ['not_scheduled', 'missing_availability', 'other_campus', 'paused'];
const shiftSource = (row) => ({ auto: '自动', manual: '手动' })[row.source] || '原排班';
const editableRows = (data, rows = data?.rosters.flatMap((row) => row.assignments) || []) =>
  rows.filter((row) => !data?.paused.includes(row.businessDate));

export function DutyPlanner({ campusId, onDirtyChange, onNavigate, campusControl = null }) {
  const client = useQueryClient();
  const active = useContext(ActivityContext),
    lock = useRef(false),
    saveId = useRef(crypto.randomUUID());
  const [week, setWeek] = useState(() => addDays(dutyWeekKey(), 7)),
    [draft, setDraft] = useState([]),
    [draftSource, setDraftSource] = useState(null),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [picker, setPicker] = useState(null),
    [peopleSearch, setPeopleSearch] = useState(''),
    [excluded, setExcluded] = useState([]),
    [undo, setUndo] = useState(null),
    [mergeConflicts, setMergeConflicts] = useState([]),
    [inspected, setInspected] = useState(null),
    [dragged, setDragged] = useState(null),
    [reviewOpen, setReviewOpen] = useState(false),
    [discardMode, setDiscardMode] = useState(null),
    [adjustmentMode, setAdjustmentMode] = useState('move'),
    [personAction, setPersonAction] = useState(''),
    [pickerAction, setPickerAction] = useState(null);
  const queryKey = ['/api/rosters/campus-week', { weekStart: week, campusId }];
  const result = useQuery({ queryKey, enabled: active && !dirty });
  const data = dirty ? draftSource : result.data;
  const failure = error || result.error?.message;
  const visibleDraft = data ? draft : [];
  const published = editableRows(data);
  const pausedRows =
    data?.rosters.flatMap((row) =>
      row.assignments.filter((item) => data.paused.includes(item.businessDate))
    ) || [];
  const changes = dutyChanges(published, draft);
  const hasChanges = changes.added + changes.removed + changes.moved > 0;
  const peopleById = new Map(data?.people.map((person) => [person.memberId, person]));
  const draggedPerson = dragged && peopleById.get(dragged.memberId);
  const placementIssue = (row, rows = draft) =>
    dutyPlacementIssue({ data, rows, row, person: peopleById.get(row.memberId) });
  const blockingRows = data ? draft.filter((row) => placementIssue(row)) : [];
  const canPublish = hasChanges && !mergeConflicts.length && !blockingRows.length;
  const wasPublished = data?.rosters.some((row) => row.publishedAt);
  const generateLabel = draft.some((row) => row.suggested)
    ? '重新生成'
    : wasPublished && !dirty
      ? '生成补排建议'
      : '生成建议班表';
  useEffect(() => {
    onDirtyChange(dirty || busy);
    return () => onDirtyChange(false);
  }, [dirty, busy, onDirtyChange]);
  useEffect(() => {
    if (!data || dirty) return;
    setDraft(editableRows(data));
  }, [data, dirty]);
  function change(items, exclusions = excluded) {
    const changed = dutyChanges(draft, items);
    if (changed.added || changed.moved || changed.removed || excluded !== exclusions) {
      setUndo({ rows: draft, excluded, week, campusId });
    }
    saveId.current = crypto.randomUUID();
    if (!dirty) setDraftSource(result.data);
    setDraft(items);
    setExcluded(exclusions);
    const delta = dutyChanges(published, items);
    setDirty(
      Boolean(
        delta.added || delta.moved || delta.removed || exclusions.length || mergeConflicts.length
      )
    );
    setError('');
    setNotice('');
  }
  function resetDraft() {
    setDirty(false);
    setDraft(published);
    setExcluded([]);
    setUndo(null);
    setMergeConflicts([]);
    setPicker(null);
    setInspected(null);
    setReviewOpen(false);
    setError('');
    setNotice('');
  }
  async function execute(operation) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      return await operation();
    } catch (failure) {
      setError(failure.message);
      throw failure;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function save(event) {
    event.preventDefault();
    if (!canPublish) return false;
    return execute(async () => {
      const result = await request('/api/rosters/campus-week', {
        method: 'PUT',
        body: {
          weekStart: week,
          campusId,
          sourceVersion: data.sourceVersion,
          requestId: saveId.current,
          rosters: data.rosters.map((row) => ({
            dutyType: row.dutyType,
            revision: row.revision,
            assignments: draft.filter((item) => item.dutyType === row.dutyType)
          }))
        }
      });
      await client.cancelQueries({ queryKey: queryKey });
      client.setQueryData(queryKey, result);
      const affectedQueries = {
        predicate: (query) =>
          [
            '/api/me/roster',
            '/api/rosters/covers',
            '/api/attendance/day',
            '/api/attendance/staffing',
            '/api/slot-capacities/actual',
            '/api/field/home',
            '/api/field/board',
            '/api/attendance/volunteer-report',
            '/api/attendance/matrix'
          ].includes(query.queryKey[0])
      };
      await client.cancelQueries(affectedQueries);
      await client.invalidateQueries(affectedQueries);
      setDraft(editableRows(result));
      setDirty(false);
      setExcluded([]);
      setUndo(null);
      setNotice('班表已发布');
      return true;
    });
  }
  const formRef = useUnsavedChanges({
    dirty: dirty || busy,
    active,
    busy,
    save: canPublish ? save : undefined,
    saveLabel: '发布并继续',
    leaveMessage: '请先在排班页处理草稿，或丢弃调整后继续。',
    discard: resetDraft
  });
  const run = (operation) => void execute(operation).catch(() => {});
  async function reload(discard = false) {
    if (!discard && mergeConflicts.length) return;
    await execute(async () => {
      const latest = await result.refetch();
      if (latest.error) throw latest.error;
      const fresh = latest.data;
      const latestRows = editableRows(fresh);
      if (dirty && !discard) {
        const merged = mergeDutyDraft(
          editableRows(fresh, published),
          editableRows(fresh, draft),
          latestRows
        );
        const remainingExclusions = editableRows(fresh, excluded);
        setDraft(merged.rows);
        setExcluded(remainingExclusions);
        setMergeConflicts(merged.conflicts);
        setDraftSource(fresh);
        const delta = dutyChanges(latestRows, merged.rows);
        setDirty(
          Boolean(
            delta.added ||
              delta.moved ||
              delta.removed ||
              remainingExclusions.length ||
              merged.conflicts.length
          )
        );
        setNotice(merged.conflicts.length ? '班表已更新，请确认冲突' : '已载入最新班表');
      } else {
        resetDraft();
        setDraft(latestRows);
        setDraftSource(null);
        setDirty(false);
        setNotice('已载入最新班表');
      }
      setUndo(null);
      saveId.current = crypto.randomUUID();
      setPicker(null);
      setInspected(null);
    });
  }
  async function suggest() {
    const result = await request('/api/rosters/week/suggestions', {
      method: 'POST',
      body: {
        weekStart: week,
        campusId,
        sourceVersion: data.sourceVersion,
        assignments: draft.filter((row) => !row.suggested),
        excluded
      }
    });
    change(editableRows(data, result.assignments));
    setDraftSource((current) => ({ ...current, sourceVersion: result.sourceVersion }));
    setNotice('建议已生成');
  }
  function resolveConflict(conflict, useLocal) {
    const remaining = mergeConflicts.filter((item) => item !== conflict);
    const rows = useLocal
      ? [
          ...draft.filter((row) => row.memberId !== conflict.memberId),
          ...conflict.local.map(({ suggested, ...row }) => row)
        ]
      : draft;
    setDraft(rows);
    setMergeConflicts(remaining);
    setUndo(null);
    saveId.current = crypto.randomUUID();
    const delta = dutyChanges(published, rows);
    setDirty(
      Boolean(delta.added || delta.moved || delta.removed || excluded.length || remaining.length)
    );
    setNotice(remaining.length ? '请确认剩余冲突' : '冲突已处理');
  }
  function remove(row) {
    change(
      draft.filter((item) => item.id !== row.id),
      [
        ...excluded.filter((item) => dutyTargetKey(item) !== dutyTargetKey(row)),
        { memberId: row.memberId, businessDate: row.businessDate, dutyType: row.dutyType }
      ]
    );
    setNotice(`已移除${peopleById.get(row.memberId)?.name || row.memberName || '人员'}`);
  }
  function adjust(from, target, swap = null) {
    if (
      !from ||
      !target ||
      data.paused.includes(from.businessDate) ||
      !serviceDates.includes(target.businessDate) ||
      (from.businessDate === target.businessDate && from.dutyType === target.dutyType)
    )
      return;
    const people = [peopleById.get(from.memberId), swap && peopleById.get(swap.memberId)];
    if (!people[0] || (swap && (!people[1] || swap.memberId === from.memberId))) return;
    const remaining = draft.filter((row) => row.id !== from.id && row.id !== swap?.id);
    const moved = [dutyDraftShift(people[0], target)];
    if (swap) moved.push(dutyDraftShift(people[1], from));
    const rows = [...remaining, ...moved];
    if (moved.some((row) => placementIssue(row, rows))) return;
    const original = [from, ...(swap ? [swap] : [])];
    const replaced = new Map(excluded.map((row) => [dutyTargetKey(row), row]));
    for (const { memberId, businessDate, dutyType } of original)
      replaced.set(dutyTargetKey({ memberId, businessDate, dutyType }), {
        memberId,
        businessDate,
        dutyType
      });
    for (const row of moved) replaced.delete(dutyTargetKey(row));
    change(rows, [...replaced.values()]);
    setInspected(null);
    setNotice(swap ? '班次已互换' : '班次已移动');
  }
  function toggle(person) {
    const found = draft.find(
      (row) =>
        row.memberId === person.memberId &&
        row.businessDate === picker.day &&
        row.dutyType === picker.type
    );
    if (found) return remove(found);
    const row = dutyDraftShift(person, { businessDate: picker.day, dutyType: picker.type });
    if (!placementIssue(row))
      change(
        [...draft, row],
        excluded.filter((item) => dutyTargetKey(item) !== dutyTargetKey(row))
      );
  }
  const dates = [
    ...new Set([
      ...DUTY_WEEKDAYS.map((weekday) => addDays(week, weekday - 1)),
      ...(data?.paused || []),
      ...visibleDraft.map((row) => row.businessDate)
    ])
  ].sort();
  const review = data
    ? dutyPlanningReview({ ...data, assignments: draft })
    : { gaps: [], unassigned: [] };
  const unassigned = [...review.unassigned].sort((first, second) => {
    return (
      unassignedOrder.indexOf(first.reasonCode) - unassignedOrder.indexOf(second.reasonCode) ||
      first.name.localeCompare(second.name, 'zh-CN')
    );
  });
  const serviceDates = DUTY_WEEKDAYS.map((weekday) => addDays(week, weekday - 1)).filter(
    (day) => !data?.paused.includes(day)
  );
  const activeDraft = draft.filter((row) => serviceDates.includes(row.businessDate));
  const loadRange = (dutyType = '') => {
    const counts = serviceDates.map(
      (day) =>
        draft.filter((row) => row.businessDate === day && (!dutyType || row.dutyType === dutyType))
          .length
    );
    return {
      min: counts.length ? Math.min(...counts) : 0,
      max: counts.length ? Math.max(...counts) : 0
    };
  };
  const availabilityLabel = (row) =>
    dutyAvailabilityLabel(peopleById.get(row.memberId), row, campusId, week);
  const activeRowsFor = (memberId) => draft.filter((row) => row.memberId === memberId);
  const repeatRepair = (row, person) =>
    person &&
    serviceDates.some((day) => dutyCandidateTypes(person.memberships, day).includes('repair')) &&
    activeRowsFor(row.memberId).length > 1;
  const rowFlags = (row) => {
    const person = peopleById.get(row.memberId);
    const issue = placementIssue(row);
    const availability = availabilityLabel(row);
    return [
      issue,
      [dutyAvailabilityLabels.missing, dutyAvailabilityLabels.conflict].includes(availability) &&
        availability,
      repeatRepair(row, person) && '本周多班'
    ].filter(Boolean);
  };
  const reviewRows = data
    ? draft
        .flatMap((row) => {
          const flags = rowFlags(row);
          return flags.length ? [{ row, flags, issue: placementIssue(row) }] : [];
        })
        .sort(
          (first, second) =>
            first.row.businessDate.localeCompare(second.row.businessDate) ||
            DUTY_TYPES.indexOf(first.row.dutyType) - DUTY_TYPES.indexOf(second.row.dutyType) ||
            (peopleById.get(first.row.memberId)?.name || first.row.memberName || '').localeCompare(
              peopleById.get(second.row.memberId)?.name || second.row.memberName || '',
              'zh-CN'
            )
        )
    : [];
  const shiftReviews = [
    ['需调整', reviewRows.filter(({ issue }) => issue)],
    ...[dutyAvailabilityLabels.conflict, dutyAvailabilityLabels.missing, '本周多班'].map(
      (status) => [status, reviewRows.filter(({ flags, issue }) => !issue && flags[0] === status)]
    )
  ];
  const unbalanced = loadRange('repair').max - loadRange('repair').min > 2;
  const reviewCount =
    review.gaps.length + unassigned.length + reviewRows.length + Number(unbalanced);
  const inspect = (row) => {
    setReviewOpen(false);
    setPersonAction('');
    setAdjustmentMode('move');
    setInspected(row);
  };
  const openPicker = (day, type) => {
    setReviewOpen(false);
    setPickerAction(null);
    setPeopleSearch('');
    setPicker({ day, type });
  };
  const selection = picker && {
    businessDate: picker.day,
    dutyType: picker.type,
    startAt: DUTY_START,
    endAt: DUTY_END
  };
  const pickerPeople =
    picker && data
      ? data.people
          .filter((person) => canAssignDuty(person.memberships, picker.day, picker.type))
          .map((person) => {
            const rows = draft.filter((row) => row.memberId === person.memberId);
            const selected = rows.find(
              (row) => row.businessDate === picker.day && row.dutyType === picker.type
            );
            const target = { ...selection, memberId: person.memberId };
            const windows = person.availability[picker.type].filter(
              (window) => window.campusId === campusId
            );
            const availableToday = availableForDuty(
              windows,
              new Date(`${picker.day}T12:00:00Z`).getUTCDay(),
              campusId
            );
            const issue = selected ? '' : placementIssue(target);
            const group = selected
              ? '已选'
              : rows.length
                ? '已有安排'
                : issue
                  ? '时段已占用'
                  : availableToday
                    ? '当天有空'
                    : '其他人员';
            return {
              ...person,
              rows,
              selected,
              windows,
              issue,
              group,
              posts: activeMemberships({
                memberships: person.memberships,
                businessDate: picker.day
              }),
              rank: manualDutyPriority(person.memberships, picker.day, picker.type)
            };
          })
          .filter((person) =>
            `${person.name} ${person.studentId || ''} ${dutyCampusNames[person.homeCampusId] || ''} ${person.posts.map(membershipLabel).join(' ')}`.includes(
              peopleSearch.trim()
            )
          )
          .sort(
            (first, second) =>
              pickerGroups.indexOf(first.group) - pickerGroups.indexOf(second.group) ||
              first.rank - second.rank ||
              first.name.localeCompare(second.name, 'zh-CN') ||
              first.memberId.localeCompare(second.memberId)
          )
      : [];
  const inspectedRow = draft.find((row) => row.id === inspected?.id);
  const inspectedPerson = inspected && peopleById.get(inspected.memberId);
  const shiftTargets = serviceDates.flatMap((businessDate) =>
    DUTY_TYPES.map((dutyType) => ({ businessDate, dutyType }))
  );
  const moveOptions = inspectedRow
    ? shiftTargets
        .filter(
          (target) =>
            target.businessDate !== inspectedRow.businessDate ||
            target.dutyType !== inspectedRow.dutyType
        )
        .map((target) => ({
          key: `${target.businessDate}:${target.dutyType}`,
          target,
          text: shiftName(target),
          issue: placementIssue({
            ...inspectedRow,
            ...target,
            startAt: DUTY_START,
            endAt: DUTY_END
          })
        }))
    : [];
  const swapOptions =
    inspectedRow && !data.paused.includes(inspectedRow.businessDate)
      ? activeDraft
          .filter(
            (row) =>
              row.memberId !== inspectedRow.memberId &&
              (row.businessDate !== inspectedRow.businessDate ||
                row.dutyType !== inspectedRow.dutyType)
          )
          .map((row) => {
            const remaining = draft.filter(
              (item) => item.id !== inspectedRow.id && item.id !== row.id
            );
            const moved = {
              ...inspectedRow,
              businessDate: row.businessDate,
              dutyType: row.dutyType,
              startAt: DUTY_START,
              endAt: DUTY_END
            };
            const swapped = {
              ...row,
              businessDate: inspectedRow.businessDate,
              dutyType: inspectedRow.dutyType,
              startAt: DUTY_START,
              endAt: DUTY_END
            };
            return {
              key: row.id,
              target: row,
              swap: row,
              text: `${peopleById.get(row.memberId)?.name || row.memberName} · ${shiftName(row)}`,
              issue: placementIssue(moved, remaining) || placementIssue(swapped, remaining)
            };
          })
      : [];
  const adjustmentOptions = adjustmentMode === 'move' ? moveOptions : swapOptions;
  const selectedAction = adjustmentOptions.find((option) => option.key === personAction);
  const officeCoverage = (day) => {
    const available = data.people.filter(
      (person) =>
        dutyCandidateTypes(person.memberships, day).includes('office') &&
        availableForDuty(
          person.availability.office,
          new Date(`${day}T12:00:00Z`).getUTCDay(),
          campusId
        )
    );
    if (!available.length) return '当天无空闲办公候选';
    if (
      available.every((person) =>
        placementIssue({
          memberId: person.memberId,
          businessDate: day,
          dutyType: 'office',
          startAt: DUTY_START,
          endAt: DUTY_END
        })
      )
    )
      return '有空的办公候选已排班';
    return '待安排';
  };
  const changeWeek = (next) => {
    if (next !== week) onNavigate(() => setWeek(next));
  };
  const renderShiftReview = ([heading, entries]) =>
    entries.length > 0 && (
      <div key={heading}>
        <h3>{heading}</h3>
        {entries.map(({ row, flags }) => (
          <button
            key={row.id}
            data-track="staff.dutyplanner.locate-status"
            type="button"
            onClick={() => inspect(row)}
          >
            <strong>{peopleById.get(row.memberId)?.name || row.memberName || '原值班人员'}</strong>
            <span>
              {shiftName(row)} · {shiftSource(row)} · {flags.join('、')}
            </span>
          </button>
        ))}
      </div>
    );
  return (
    <div className="duty-planner">
      <div className="duty-toolbar duty-planner-toolbar">
        {campusControl}
        <WeekPicker
          data-track="staff.dutyplanner.input.1"
          label="所在周"
          value={week}
          disabled={busy}
          onChange={changeWeek}
        />
        {week !== addDays(dutyWeekKey(), 7) && (
          <button
            data-track="staff.dutyplanner.button.2"
            disabled={busy}
            onClick={() => changeWeek(addDays(dutyWeekKey(), 7))}
          >
            下周
          </button>
        )}
        <RefreshButton
          data-track="staff.dutyplanner.refreshbutton.13"
          key={`${campusId}:${week}`}
          label="读取最新班表"
          disabled={busy || mergeConflicts.length > 0}
          onRefresh={() => reload()}
        />
      </div>
      {failure && (
        <p role="alert" className="react-error">
          {failure}
          <button
            data-track="staff.dutyplanner.button.3"
            disabled={busy}
            onClick={() => void reload().catch(() => {})}
          >
            重试读取
          </button>
          {dirty && (
            <button
              data-track="staff.dutyplanner.button.4"
              disabled={busy}
              onClick={() => setDiscardMode('reload')}
            >
              放弃草稿并读取
            </button>
          )}
        </p>
      )}
      <form
        data-track="staff.dutyplanner.form.5"
        ref={formRef}
        aria-busy={!data}
        onSubmit={(event) => {
          event.preventDefault();
          if (!canPublish) return;
          if (reviewCount) setReviewOpen('publish');
          else void save(event).catch(() => {});
        }}
      >
        <fieldset disabled={busy || !data}>
          <div className="duty-section-heading">
            <div className="duty-plan-heading">
              <h2 className="workspace-title-with-hint">
                安排一周值班
                <HelpHint data-track="staff.dutyplanner.helphint.14" label="班表生成规则">
                  硬件部员每周一天，维修每日人数差不超过2人，尽量避开空闲冲突。办公按当天空闲安排，每天最多一人，缺人可留空。
                </HelpHint>
              </h2>
              {data && (
                <div className="duty-plan-state" role="group" aria-label="排班概览">
                  <strong>{dirty ? '未发布草稿' : wasPublished ? '已发布' : '未发布'}</strong>
                  {hasChanges && (
                    <span>
                      {[
                        changes.added && `新增 ${changes.added}`,
                        changes.moved && `移班 ${changes.moved}`,
                        changes.removed && `移除 ${changes.removed}`
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  )}
                  {reviewCount > 0 && (
                    <button
                      data-track="staff.dutyplanner.review"
                      className="duty-text-action duty-review-trigger"
                      type="button"
                      onClick={() => setReviewOpen('review')}
                    >
                      异常信息 · {reviewCount}
                    </button>
                  )}
                  <span className="duty-plan-feedback" role="status">
                    {notice}
                  </span>
                </div>
              )}
            </div>
            <div className="duty-plan-actions">
              {undo?.week === week && undo.campusId === campusId && (
                <button
                  data-track="staff.dutyplanner.undo"
                  className="duty-text-action"
                  type="button"
                  onClick={() => {
                    change(undo.rows, undo.excluded);
                    setUndo(null);
                    setNotice('已撤销');
                  }}
                >
                  撤销
                </button>
              )}
              {dirty && (
                <details
                  data-track="staff.dutyplanner.draft-actions"
                  className="duty-draft-actions"
                  onBlur={(event) => {
                    if (!event.currentTarget.contains(event.relatedTarget))
                      event.currentTarget.open = false;
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return;
                    event.currentTarget.open = false;
                    event.currentTarget.querySelector('summary')?.focus();
                  }}
                >
                  <summary data-track="staff.dutyplanner.draft-actions-trigger">草稿操作</summary>
                  <div>
                    {hasChanges && (
                      <button
                        data-track="staff.dutyplanner.regenerate"
                        type="button"
                        disabled={mergeConflicts.length > 0 || blockingRows.length > 0}
                        onClick={(event) => {
                          event.currentTarget.closest('details').open = false;
                          run(suggest);
                        }}
                      >
                        {generateLabel}
                      </button>
                    )}
                    <button
                      data-track="staff.dutyplanner.button.8"
                      className="duty-remove"
                      type="button"
                      onClick={(event) => {
                        event.currentTarget.closest('details').open = false;
                        setDiscardMode('reset');
                      }}
                    >
                      放弃草稿
                    </button>
                  </div>
                </details>
              )}
              {hasChanges ? (
                <button
                  data-track="staff.dutyplanner.button.7"
                  type="submit"
                  className="field-primary"
                  disabled={!canPublish}
                >
                  发布班表
                </button>
              ) : (
                <button
                  data-track="staff.dutyplanner.button.6"
                  type="button"
                  className="field-primary"
                  disabled={mergeConflicts.length > 0 || blockingRows.length > 0}
                  onClick={() => run(suggest)}
                >
                  {generateLabel}
                </button>
              )}
            </div>
          </div>
          {mergeConflicts.length > 0 && (
            <section className="duty-draft-conflicts" aria-label="班表冲突">
              <h3>班表冲突</h3>
              {mergeConflicts.map((conflict) => (
                <div className="duty-draft-conflict" key={conflict.memberId}>
                  <strong>
                    {peopleById.get(conflict.memberId)?.name ||
                      conflict.local[0]?.memberName ||
                      conflict.remote[0]?.memberName}
                  </strong>
                  <button
                    data-track="staff.dutyplanner.keep-local"
                    type="button"
                    onClick={() => resolveConflict(conflict, true)}
                  >
                    保留我的调整 · {conflict.local.map(shiftName).join('、') || '移除'}
                  </button>
                  <button
                    data-track="staff.dutyplanner.keep-published"
                    type="button"
                    onClick={() => resolveConflict(conflict, false)}
                  >
                    使用最新班表 · {conflict.remote.map(shiftName).join('、') || '已移除'}
                  </button>
                </div>
              ))}
            </section>
          )}
          <div className="duty-week-grid">
            {dates.map((day) => {
              const paused = data?.paused.includes(day);
              const originalNames = paused && [
                ...new Map(
                  pausedRows
                    .filter((row) => row.businessDate === day)
                    .map((row) => [
                      row.memberId,
                      peopleById.get(row.memberId)?.name || row.memberName || '原值班人员'
                    ])
                )
              ];
              return (
                <section className="duty-day-column" key={day} data-paused={paused || undefined}>
                  <header>
                    <h3>
                      {weekdayName(day)} <time dateTime={day}>{day.slice(5)}</time>
                    </h3>
                  </header>
                  {paused ? (
                    <div className="duty-paused-day">
                      <h4>暂停维修</h4>
                      {originalNames.length > 0 && (
                        <ul aria-label="原定值班人员">
                          {originalNames.map(([memberId, name]) => (
                            <li key={memberId}>{name}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : (
                    DUTY_TYPES.map((type) => {
                      const rows = visibleDraft.filter(
                        (row) => row.businessDate === day && row.dutyType === type
                      );
                      const target = { businessDate: day, dutyType: type };
                      const canDrop =
                        dragged &&
                        serviceDates.includes(day) &&
                        (dragged.businessDate !== day || dragged.dutyType !== type) &&
                        !placementIssue({
                          ...dragged,
                          ...target,
                          startAt: DUTY_START,
                          endAt: DUTY_END
                        });
                      const fitsAvailability =
                        canDrop &&
                        availableForDuty(
                          draggedPerson?.availability[type] || [],
                          new Date(`${day}T12:00:00Z`).getUTCDay(),
                          campusId
                        );
                      const dropState = canDrop && (fitsAvailability ? 'available' : 'ready');
                      return (
                        <div
                          key={type}
                          className="duty-shift-group"
                          data-drop-state={dropState || undefined}
                          onDragOver={(event) => {
                            if (canDrop) event.preventDefault();
                          }}
                          onDrop={(event) => {
                            if (!canDrop) return;
                            event.preventDefault();
                            adjust(dragged, target);
                            setDragged(null);
                          }}
                        >
                          <h4 className="duty-shift-heading">
                            <span className="duty-shift-title">
                              {dutyTypeLabels[type]}{' '}
                              <span className="duty-shift-count">
                                {data && (rows.length ? `${rows.length} 人` : '缺岗')}
                              </span>
                              {fitsAvailability && <span className="duty-drop-hint">有空</span>}
                            </span>
                            <button
                              data-track="staff.dutyplanner.button.10"
                              type="button"
                              className="duty-icon-action duty-shift-select"
                              aria-label={`${weekdayName(day)}${dutyTypeLabels[type]}${rows.length ? '' : '缺岗'} · 选择人员`}
                              title="添加人员"
                              disabled={mergeConflicts.length > 0}
                              onClick={() => openPicker(day, type)}
                            >
                              <Plus size={18} aria-hidden="true" />
                            </button>
                          </h4>
                          {rows.map((row) => {
                            const person = peopleById.get(row.memberId);
                            const name = person?.name || row.memberName || '原值班人员';
                            const [flag] = rowFlags(row);
                            const label = [shiftSource(row), flag].filter(Boolean).join(' · ');
                            return (
                              <div data-motion-item={row.id} key={row.id} className="duty-assignee">
                                <button
                                  data-track="staff.dutyplanner.inspect"
                                  type="button"
                                  className="duty-assignee-name"
                                  aria-label={name}
                                  aria-describedby={`duty-status-${row.id}`}
                                  draggable={Boolean(person && !mergeConflicts.length)}
                                  onDragStart={(event) => {
                                    event.dataTransfer.setData('text/plain', row.id);
                                    event.dataTransfer.effectAllowed = 'move';
                                    setDragged(row);
                                  }}
                                  onDragEnd={() => setDragged(null)}
                                  onClick={() => inspect(row)}
                                >
                                  <span>{name}</span>
                                  <span
                                    className="duty-assignee-status"
                                    id={`duty-status-${row.id}`}
                                  >
                                    {label}
                                  </span>
                                </button>
                                <button
                                  data-track="staff.dutyplanner.button.9"
                                  type="button"
                                  className="duty-icon-action duty-remove-assignee"
                                  aria-label={`移除${name}`}
                                  title={`移除${name}`}
                                  disabled={mergeConflicts.length > 0}
                                  onClick={() => remove(row)}
                                >
                                  <X size={16} aria-hidden="true" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })
                  )}
                </section>
              );
            })}
          </div>
        </fieldset>
      </form>
      {discardMode && (
        <Modal
          title="放弃草稿"
          compact
          showCloseButton={false}
          initialFocus='[data-track="staff.dutyplanner.cancel-discard"]'
          onClose={() => setDiscardMode(null)}
          footer={
            <div className="workspace-unsaved-actions">
              <button
                data-track="staff.dutyplanner.confirm-discard"
                type="button"
                className="workspace-discard"
                onClick={() => {
                  const reloadLatest = discardMode === 'reload';
                  setDiscardMode(null);
                  if (reloadLatest) void reload(true).catch(() => {});
                  else resetDraft();
                }}
              >
                放弃草稿
              </button>
              <button
                data-track="staff.dutyplanner.cancel-discard"
                type="button"
                onClick={() => setDiscardMode(null)}
              >
                取消
              </button>
            </div>
          }
        >
          <p>{discardMode === 'reload' ? '放弃后将载入最新班表。' : '尚未发布的调整将丢失。'}</p>
        </Modal>
      )}
      {reviewOpen && data && (
        <Modal
          title={reviewOpen === 'publish' ? '发布前确认' : '异常信息'}
          onClose={() => setReviewOpen(false)}
          dismissible={!busy}
          className="duty-review-dialog"
          footer={
            canPublish && (
              <button
                data-track="staff.dutyplanner.confirm-publish"
                type="button"
                className="field-primary"
                disabled={!canPublish || busy}
                onClick={(event) =>
                  void save(event)
                    .then((saved) => {
                      if (saved) setReviewOpen(false);
                    })
                    .catch(() => {})
                }
              >
                {busy ? '正在发布…' : '确认发布'}
              </button>
            )
          }
        >
          <section aria-label="异常信息" className="duty-review-list">
            {error && (
              <p className="react-error" role="alert">
                {error}
              </p>
            )}
            {reviewCount === 0 && <p>暂无异常</p>}
            {renderShiftReview(shiftReviews[0])}
            {review.gaps.length > 0 && (
              <div>
                <h3>缺岗</h3>
                {review.gaps.map((row) => (
                  <button
                    data-track="staff.dutyplanner.gap"
                    type="button"
                    key={`${row.businessDate}:${row.dutyType}`}
                    disabled={mergeConflicts.length > 0}
                    onClick={() => openPicker(row.businessDate, row.dutyType)}
                  >
                    <strong>{shiftName(row)}</strong>
                    <span>
                      {row.dutyType === 'office' ? officeCoverage(row.businessDate) : '选择人员'}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {unassigned.length > 0 && (
              <div>
                <h3>维修未安排</h3>
                <ul aria-label="维修待安排成员">
                  {unassigned.map((person) => (
                    <li key={person.memberId}>
                      <button
                        data-track="staff.dutyplanner.inspect-unassigned"
                        type="button"
                        onClick={() => inspect(person)}
                      >
                        <strong>{person.name}</strong>
                        <span>{unassignedLabel[person.reasonCode] || '未排班'}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {shiftReviews.slice(1).map(renderShiftReview)}
            {unbalanced && (
              <div>
                <h3>人数不均</h3>
                <p>维修每日人数差超过 2 人</p>
              </div>
            )}
          </section>
        </Modal>
      )}
      {picker && data && (
        <Modal
          title="选择值班人员"
          className="duty-picker-dialog"
          onClose={() => setPicker(null)}
          footer={
            <button
              data-track="staff.dutyplanner.button.12"
              type="button"
              className="field-primary"
              onClick={() => setPicker(null)}
            >
              完成选择
            </button>
          }
        >
          <p>
            {shiftName(selection)}
            {picker.type === 'office' &&
            review.gaps.some(
              (row) => row.businessDate === picker.day && row.dutyType === picker.type
            )
              ? ` · ${officeCoverage(picker.day)}`
              : ''}
          </p>
          <div className="duty-people-picker">
            <label className="workspace-picker-search">
              搜索人员
              <input
                data-track="staff.dutyplanner.input.15"
                type="search"
                value={peopleSearch}
                placeholder="姓名、学号、校区或部门"
                onChange={(event) => setPeopleSearch(event.target.value)}
              />
            </label>
            {!pickerPeople.length && <p>没有符合条件的人员</p>}
            {pickerPeople.map((person, index) => {
              const checkable = !person.rows.length || person.selected;
              const Entry = checkable ? 'label' : 'div';
              const moveChoices = checkable
                ? []
                : person.rows.filter(
                    (row) =>
                      !placementIssue({ ...selection, memberId: person.memberId, id: row.id })
                  );
              const canArrange = !checkable && (!person.issue || moveChoices.length > 0);
              const arranging = canArrange && pickerAction?.memberId === person.memberId;
              const filledTimes =
                person.group === '其他人员'
                  ? DUTY_WEEKDAYS.flatMap((day) => {
                      const weekday = weekdayName(addDays(week, day - 1));
                      if (availableForDuty(person.windows, day, campusId)) return [weekday];
                      return person.windows
                        .filter((window) => window.weekday === day)
                        .map((window) => `${weekday} ${window.startAt}–${window.endAt}`);
                    })
                  : [];
              const scheduleDetails =
                person.group === '其他人员'
                  ? `所填空闲时间：${filledTimes.join('、') || '未填'}`
                  : person.rows.map(shiftName).join(' ／ ');
              return (
                <React.Fragment key={person.memberId}>
                  {(index === 0 || pickerPeople[index - 1].group !== person.group) && (
                    <h3 className="duty-picker-group">{person.group}</h3>
                  )}
                  <div className="duty-picker-row">
                    <div className="duty-picker-row-main">
                      <Entry className="duty-picker-entry">
                        <span className="duty-picker-person">
                          <span className="duty-picker-person-heading">
                            <strong>{person.name}</strong>
                            {person.issue && !canArrange && <span>{person.issue}</span>}
                          </span>
                          <span className="duty-picker-person-details">
                            {dutyCampusNames[person.homeCampusId] || dutyCampusNames[campusId]} ·{' '}
                            {person.posts.map(membershipLabel).join(' · ') || '暂无任职'}
                            {person.studentId && ` · ${person.studentId}`}
                          </span>
                          {scheduleDetails && (
                            <span className="duty-picker-person-availability">
                              {scheduleDetails}
                            </span>
                          )}
                        </span>
                        {checkable && (
                          <input
                            data-track="staff.dutyplanner.input.11"
                            type="checkbox"
                            aria-label={person.name}
                            disabled={busy || mergeConflicts.length > 0 || Boolean(person.issue)}
                            checked={Boolean(person.selected)}
                            onChange={() => toggle(person)}
                          />
                        )}
                      </Entry>
                      {canArrange && (
                        <button
                          data-track="staff.dutyplanner.picker-arrange"
                          type="button"
                          className="duty-icon-action duty-picker-arrange"
                          aria-expanded={arranging}
                          aria-label={`安排${person.name}`}
                          title={`安排${person.name}`}
                          disabled={busy || mergeConflicts.length > 0}
                          onClick={() =>
                            setPickerAction(
                              arranging ? null : { memberId: person.memberId, choice: '' }
                            )
                          }
                        >
                          <Settings size={18} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {arranging && (
                      <div className="duty-picker-row-actions">
                        <Select
                          data-track="staff.dutyplanner.move-from-picker"
                          aria-label={`安排${person.name}的方式`}
                          placeholder="选择安排方式"
                          value={pickerAction.choice}
                          onChange={(event) =>
                            setPickerAction({ ...pickerAction, choice: event.target.value })
                          }
                        >
                          {moveChoices.map((row) => (
                            <option key={row.id} value={row.id}>
                              从{shiftName(row)}移来
                            </option>
                          ))}
                          {!person.issue && <option value="another">加排当天（保留原班次）</option>}
                        </Select>
                        <button
                          data-track="staff.dutyplanner.add-another"
                          type="button"
                          className="field-primary"
                          disabled={busy || !pickerAction.choice || mergeConflicts.length > 0}
                          onClick={() => {
                            if (pickerAction.choice === 'another') toggle(person);
                            else
                              adjust(
                                person.rows.find((row) => row.id === pickerAction.choice),
                                selection
                              );
                            setPickerAction(null);
                          }}
                        >
                          确认
                        </button>
                      </div>
                    )}
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        </Modal>
      )}
      {inspected && !picker && data && (
        <Modal
          title={inspectedPerson?.name || inspected.memberName || inspected.name || '值班人员'}
          onClose={() => setInspected(null)}
          className="duty-person-dialog"
          footer={
            inspectedRow &&
            !mergeConflicts.length && (
              <div className="duty-person-actions">
                <button
                  data-track="staff.dutyplanner.button.9"
                  type="button"
                  className="duty-text-action duty-remove"
                  disabled={busy}
                  onClick={() => {
                    remove(inspectedRow);
                    setInspected(null);
                  }}
                >
                  移除班次
                </button>
                {inspectedPerson && (moveOptions.length > 0 || swapOptions.length > 0) && (
                  <button
                    data-track="staff.dutyplanner.apply-adjustment"
                    type="button"
                    className="field-primary"
                    disabled={busy || !selectedAction || Boolean(selectedAction.issue)}
                    onClick={() => adjust(inspectedRow, selectedAction.target, selectedAction.swap)}
                  >
                    确认调整
                  </button>
                )}
              </div>
            )
          }
        >
          {inspectedRow && (
            <div className="duty-person-current">
              <strong>{shiftName(inspectedRow)}</strong>
              <span>
                {[
                  `${inspectedRow.startAt}–${inspectedRow.endAt}`,
                  shiftSource(inspectedRow),
                  ...rowFlags(inspectedRow)
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
          )}
          {inspectedPerson && (
            <div className="duty-person-days">
              {DUTY_WEEKDAYS.map((weekday) => {
                const day = addDays(week, weekday - 1);
                const local = draft.filter(
                  (row) => row.memberId === inspected.memberId && row.businessDate === day
                );
                return (
                  <div key={day}>
                    <strong>{weekdayName(day)}</strong>
                    <span>
                      {data.paused.includes(day)
                        ? '暂停维修'
                        : dutyAvailabilityLabel(
                            inspectedPerson,
                            { businessDate: day, dutyType: 'repair' },
                            campusId,
                            week
                          )}
                    </span>
                    {local.map((row) => (
                      <span key={row.id}>{dutyTypeLabels[row.dutyType]}</span>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
          {inspectedRow &&
            inspectedPerson &&
            !mergeConflicts.length &&
            (moveOptions.length > 0 || swapOptions.length > 0) && (
              <div className="duty-move-panel">
                <div className="duty-adjustment-modes" role="group" aria-label="调整方式">
                  <button
                    data-track="staff.dutyplanner.adjust-move"
                    type="button"
                    aria-pressed={adjustmentMode === 'move'}
                    onClick={() => {
                      setAdjustmentMode('move');
                      setPersonAction('');
                    }}
                  >
                    移动班次
                  </button>
                  <button
                    data-track="staff.dutyplanner.adjust-swap"
                    type="button"
                    aria-pressed={adjustmentMode === 'swap'}
                    onClick={() => {
                      setAdjustmentMode('swap');
                      setPersonAction('');
                    }}
                  >
                    交换班次
                  </button>
                </div>
                {adjustmentOptions.length > 0 ? (
                  <Select
                    data-track="staff.dutyplanner.move"
                    aria-label={adjustmentMode === 'move' ? '移动到' : '与谁交换'}
                    placeholder={adjustmentMode === 'move' ? '选择目标班次' : '选择交换人员'}
                    value={personAction}
                    onChange={(event) => setPersonAction(event.target.value)}
                  >
                    {adjustmentOptions.map((option) => (
                      <option key={option.key} value={option.key} disabled={Boolean(option.issue)}>
                        {option.text}
                        {option.issue ? ` · ${option.issue}` : ''}
                      </option>
                    ))}
                  </Select>
                ) : (
                  <p>当前没有可选班次</p>
                )}
              </div>
            )}
        </Modal>
      )}
    </div>
  );
}
