import {
  DUTY_START,
  DUTY_END,
  canAssignDuty,
  dutyTypeLabels,
  isDutyExempt
} from '../../shared/duty.js';

export function dutyTargetKey(row) {
  return `${row.memberId}:${row.businessDate}:${row.dutyType}`;
}

function shiftKey(row) {
  return `${dutyTargetKey(row)}:${row.startAt}:${row.endAt}`;
}

export function dutyChanges(published, draft) {
  const before = new Set(published.map(shiftKey));
  const after = new Set(draft.map(shiftKey));
  const added = draft.filter((row) => !before.has(shiftKey(row)));
  const removed = published.filter((row) => !after.has(shiftKey(row)));
  const changes = { moved: 0, added: added.length, removed: removed.length };
  for (const row of added) {
    const from = removed.findIndex((old) => old.memberId === row.memberId);
    if (from < 0) continue;
    removed.splice(from, 1);
    changes.moved++;
    changes.added--;
    changes.removed--;
  }
  return changes;
}

function sameShifts(first, second) {
  const keys = new Set(first.map(shiftKey));
  return first.length === second.length && second.every((row) => keys.has(shiftKey(row)));
}

function addedShifts(rows, before) {
  const keys = new Set(before.map(shiftKey));
  return rows.filter((row) => !keys.has(shiftKey(row)));
}

export function mergeDutyDraft(previous, draft, latest) {
  const memberIds = new Set([...previous, ...draft, ...latest].map((row) => row.memberId));
  const rows = [];
  const conflicts = [];
  for (const memberId of memberIds) {
    const old = previous.filter((row) => row.memberId === memberId);
    const local = draft.filter((row) => row.memberId === memberId);
    const remote = latest.filter((row) => row.memberId === memberId);
    if (sameShifts(local, old) || sameShifts(local, remote)) {
      rows.push(...remote);
    } else if (sameShifts(remote, old)) {
      rows.push(
        ...local.map((row) => remote.find((item) => shiftKey(item) === shiftKey(row)) || row)
      );
    } else {
      const localRemoved = addedShifts(old, local);
      const remoteRemoved = addedShifts(old, remote);
      const localAdded = addedShifts(local, old);
      const remoteAdded = addedShifts(remote, old);
      const bothChangedOrigin = localRemoved.some((row) =>
        remoteRemoved.some((item) => shiftKey(item) === shiftKey(row))
      );
      const differentDestinations = !sameShifts(localAdded, remoteAdded);
      const overlappingAdditions = localAdded.some((row) =>
        remoteAdded.some((item) => shiftKey(item) !== shiftKey(row) && dutyOverlap(item, row))
      );
      if ((bothChangedOrigin && differentDestinations) || overlappingAdditions) {
        rows.push(...remote);
        conflicts.push({ memberId, local, remote });
      } else {
        const removed = new Set(localRemoved.map(shiftKey));
        rows.push(
          ...remote.filter((row) => !removed.has(shiftKey(row))),
          ...addedShifts(localAdded, remote)
        );
      }
    }
  }
  return { rows, conflicts };
}

export function dutyOverlap(row, other) {
  return (
    row.businessDate === other.businessDate &&
    row.startAt < other.endAt &&
    other.startAt < row.endAt
  );
}

export function dutyPlacementIssue({ data, rows, person, row }) {
  if (
    (person?.homeCampusId || row.homeCampusId) &&
    (person?.homeCampusId || row.homeCampusId) !== data.campusId
  )
    return '非本校区成员';
  if (!person) return '人员已失效';
  if (isDutyExempt(person.memberships, row.businessDate)) return '不参与值班';
  if (!canAssignDuty(person.memberships, row.businessDate, row.dutyType))
    return `无${dutyTypeLabels[row.dutyType]}值班资格`;
  if (data.paused.includes(row.businessDate)) return '当天停服';
  if (
    person.otherShifts?.some((other) => dutyOverlap(row, other)) ||
    rows.some(
      (other) => other.id !== row.id && other.memberId === row.memberId && dutyOverlap(row, other)
    )
  ) {
    return '班次重叠';
  }
  return '';
}

export function dutyDraftShift(person, target) {
  return {
    id: crypto.randomUUID(),
    memberId: person.memberId,
    memberName: person.name,
    businessDate: target.businessDate,
    dutyType: target.dutyType,
    source: 'manual',
    startAt: DUTY_START,
    endAt: DUTY_END
  };
}
