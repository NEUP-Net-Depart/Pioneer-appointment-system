import { fail } from '../../lib/http.js';
import { dateKey, validDate, nowIso } from '../../platform/time.js';
import { campusId as normalizeCampus } from '../../modules/authorization/scopes.js';
import { dutyCampusNames } from '../../../shared/duty.js';
import { attendanceStatus } from '../../../shared/attendance-status.js';

export function dutyDomain({ repository, contextFor, evaluate }) {
  async function workStaffing(actor, query) {
    const context = await contextFor(actor),
      campus = normalizeCampus(query.campusId),
      day = dateKey();
    const canRead = ['attendance.correct', 'attendance.token.issue'].some(
      (code) => evaluate(context, code, { campusId: campus }).allowed
    );
    if (!dutyCampusNames[campus] || !canRead) fail(403, '没有该校区的人员状态查看权限');
    const canSeeMissing = evaluate(context, 'attendance.token.issue', { campusId: campus }).allowed;
    const [attendance, people, busy, duties, service] = await Promise.all([
      repository.dutyAttendanceDay(day, campus),
      repository.schedulePeople(campus),
      repository.busyRepairMembers(),
      canSeeMissing ? repository.dutyDay(day, campus) : Promise.resolve({ assignments: [] }),
      repository.serviceDay(day, campus)
    ]);
    const posts = await repository.membershipsForMembers(
      people.map((person) => person.memberId),
      day
    );
    const signed = new Set(
      attendance.records
        .filter((record) => record.campusId === campus)
        .map((record) => record.memberId)
    );
    const occupied = new Set(busy.map((person) => person.memberId));
    const eligible = new Set(
      posts
        .filter(
          (post) =>
            post.enabled !== false &&
            post.departmentCode === 'hardware' &&
            (post.isPrimary || post.assignmentType === 'exchange')
        )
        .map((post) => post.memberId)
    );
    const expected = new Set(
      duties.assignments
        .filter((item) => item.leaveStatus !== 'recorded')
        .map((item) => item.memberId)
    );
    const unique = [...new Map(people.map((person) => [person.memberId, person])).values()];
    const project = (person) => ({ memberId: person.memberId, name: person.name });
    return {
      campusId: campus,
      businessDate: day,
      idle: service?.paused
        ? []
        : unique
            .filter(
              (person) =>
                signed.has(person.memberId) &&
                eligible.has(person.memberId) &&
                !occupied.has(person.memberId)
            )
            .map(project),
      missing: canSeeMissing
        ? service?.paused
          ? []
          : unique
              .filter((person) => expected.has(person.memberId) && !signed.has(person.memberId))
              .map(project)
        : null
    };
  }
  async function authorized(actor, campusId, readOnly = false) {
    const context = await contextFor(actor),
      campus = normalizeCampus(campusId);
    if (
      !dutyCampusNames[campus] ||
      !(
        evaluate(context, 'attendance.correct', { campusId: campus }).allowed ||
        (readOnly && evaluate(context, 'attendance.token.issue', { campusId: campus }).allowed)
      )
    )
      fail(403, '没有该校区的考勤管理权限');
    return { context, campus };
  }
  function visibleDayRows(context, campus, data, attendance) {
    const canManage = evaluate(context, 'attendance.correct', { campusId: campus }).allowed;
    const records = attendance.records.filter(
      (row) =>
        row.campusId === campus &&
        (!canManage ||
          evaluate(context, 'attendance.correct', {
            campusId: campus,
            memberId: row.memberId,
            departmentId: row.primaryDepartmentIdSnapshot
          }).allowed)
    );
    const assignments = data.assignments.filter(
      (item) =>
        !canManage ||
        evaluate(context, 'attendance.correct', {
          campusId: campus,
          memberId: item.memberId
        }).allowed
    );
    return { canManage, records, assignments };
  }
  async function attendanceWorkload(actor, query) {
    const { context, campus } = await authorized(actor, query.campusId, true);
    const day = query.businessDate || dateKey();
    if (!validDate(day)) fail(400, '日期不正确');
    const [data, attendance] = await Promise.all([
      repository.dutyDay(day, campus),
      repository.dutyAttendanceDay(day, campus)
    ]);
    const { records, assignments } = visibleDayRows(context, campus, data, attendance);
    const memberIds = [...new Set([...assignments, ...records].map((row) => row.memberId))];
    const asOf = nowIso();
    const month = dateKey(new Date(asOf)).slice(0, 7);
    const monthStart = new Date(`${month}-01T00:00:00+08:00`).toISOString();
    return {
      month,
      asOf,
      items: await repository.memberRepairWorkload(memberIds, monthStart, asOf)
    };
  }
  async function attendanceDay(actor, query) {
    const { context, campus } = await authorized(actor, query.campusId, true),
      day = query.businessDate || dateKey();
    if (!validDate(day)) fail(400, '日期不正确');
    const [data, attendance, service, people] = await Promise.all([
      repository.dutyDay(day, campus),
      repository.dutyAttendanceDay(day, campus),
      repository.serviceDay(day, campus),
      repository.schedulePeople(campus)
    ]);
    const { canManage, records, assignments } = visibleDayRows(context, campus, data, attendance);
    const canCorrect = (memberId) =>
      canManage &&
      !service?.paused &&
      day <= dateKey() &&
      people.some((person) => person.memberId === memberId);
    const byMember = new Map();
    for (const item of assignments) {
      if (!byMember.has(item.memberId))
        byMember.set(item.memberId, {
          memberId: item.memberId,
          name: item.memberName,
          assignments: []
        });
      byMember.get(item.memberId).assignments.push(item);
    }
    const now = nowIso();
    const items = [...byMember.values()].map((person) => {
      const expected = person.assignments.filter((row) => row.leaveStatus !== 'recorded');
      const item = expected[0] || person.assignments[0];
      const record = records.find((row) => row.memberId === person.memberId);
      return {
        ...person,
        record,
        assignment: item,
        canCorrect: canCorrect(person.memberId),
        unavailable: !people.some((row) => row.memberId === person.memberId),
        status: attendanceStatus({
          assignments: person.assignments,
          record,
          paused: service?.paused,
          now
        })
      };
    });
    const temporary = records
      .filter((record) => !byMember.has(record.memberId))
      .map((record) => ({
        memberId: record.memberId,
        name: record.identitySnapshot?.name || record.memberName,
        canCorrect: canCorrect(record.memberId),
        record,
        status: 'arrived'
      }));
    const [busy, posts] = await Promise.all([
      day === dateKey() && !service?.paused ? repository.busyRepairMembers() : [],
      repository.membershipsForMembers(
        [...new Set([...people, ...items, ...temporary].map((person) => person.memberId))],
        day
      )
    ]);
    const departments = new Map(
      posts.filter((post) => post.isPrimary).map((post) => [post.memberId, post])
    );
    const occupied = new Set(busy.map((person) => person.memberId));
    const eligible = new Set(
      posts
        .filter(
          (post) =>
            post.enabled !== false &&
            post.departmentCode === 'hardware' &&
            (post.isPrimary || post.assignmentType === 'exchange')
        )
        .map((post) => post.memberId)
    );
    const decorate = (person) => ({
      ...person,
      maintenanceAffairs: posts.some(
        (post) => post.memberId === person.memberId && post.assignmentType === 'maintenance_affairs'
      ),
      dutyStatuses: Object.fromEntries(
        [...new Set((person.assignments || []).map((item) => item.dutyType))].map((type) => [
          type,
          attendanceStatus({
            assignments: person.assignments.filter((item) => item.dutyType === type),
            record: person.record,
            paused: service?.paused,
            now
          })
        ])
      ),
      department:
        departments.get(person.memberId)?.departmentName ||
        person.record?.primaryDepartmentNameSnapshot ||
        '',
      departmentCode: departments.get(person.memberId)?.departmentCode || '',
      repairEligible: eligible.has(person.memberId),
      workStatus:
        person.record && day === dateKey() && !service?.paused
          ? occupied.has(person.memberId)
            ? 'repairing'
            : 'idle'
          : null,
      ...(!canManage
        ? {
            record: person.record ? { occurredAt: person.record.occurredAt } : null,
            assignments: person.assignments?.map(({ dutyType, startAt, endAt }) => ({
              dutyType,
              startAt,
              endAt
            })),
            assignment: undefined
          }
        : {})
    });
    return {
      canManage,
      businessDate: day,
      campusId: campus,
      paused: !!service?.paused,
      serverNow: now,
      items: items.map(decorate),
      temporary: temporary.map(decorate),
      summary: {
        expected: items.filter((row) => !['leave', 'paused'].includes(row.status)).length,
        arrived: items.filter((row) => row.status === 'arrived').length,
        absent: items.filter((row) => row.status === 'absent').length
      },
      people: (canManage ? people : [])
        .filter(
          (person) =>
            evaluate(context, 'attendance.correct', { campusId: campus, memberId: person.memberId })
              .allowed
        )
        .map(({ memberId, name, studentId }) => ({ memberId, name, studentId }))
    };
  }
  return { attendanceDay, attendanceWorkload, workStaffing };
}
