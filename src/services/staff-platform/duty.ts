import type { StaffRepository } from '../../db/staff-platform.ts';
import type { AttendanceStatus } from '../../../shared/attendance-types.ts';

type DutyDay = Awaited<ReturnType<StaffRepository['dutyDay']>>;
type AttendanceDay = Awaited<ReturnType<StaffRepository['dutyAttendanceDay']>>;
type DutyPerson = {
  memberId: string;
  name: string;
  assignments?: DutyDay['assignments'];
  record?: AttendanceDay['records'][number];
};
type AttendancePerson = DutyPerson & {
  assignment?: DutyDay['assignments'][number];
  canCorrect: boolean;
  status: AttendanceStatus;
  unavailable?: boolean;
};
interface DutyQuery {
  campusId?: string;
  businessDate?: string;
}
import type { StaffContext } from './context.ts';
import type { StaffAccountDto } from '../../../shared/staff-types.ts';
import type { StaffDomainDependencies } from './context.ts';
import { fail } from '../../lib/http.ts';
import { dateKey, validDate, nowIso } from '../../platform/time.ts';
import { campusId as normalizeCampus } from '../../modules/authorization/scopes.ts';
import { isDutyCampusId } from '../../../shared/duty.ts';
import { attendanceStatus } from '../../../shared/attendance-status.ts';

export function dutyDomain({ repository, contextFor, evaluate }: StaffDomainDependencies) {
  async function workStaffing(actor: StaffAccountDto, query: DutyQuery) {
    const context = await contextFor(actor),
      campus = normalizeCampus(query.campusId),
      day = dateKey();
    const canRead = ['attendance.correct', 'attendance.token.issue'].some(
      (code) => evaluate(context, code, { campusId: campus }).allowed
    );
    if (!isDutyCampusId(campus) || !canRead) fail(403, '没有该校区的人员状态查看权限');
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
    const expected = new Set(duties.assignments.map((item) => item.memberId));
    const unique = [...new Map(people.map((person) => [person.memberId, person])).values()];
    const project = (person: Pick<DutyPerson, 'memberId' | 'name'>) => ({
      memberId: person.memberId,
      name: person.name
    });
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
  async function authorized(
    actor: StaffAccountDto,
    campusId: string | undefined,
    readOnly = false
  ) {
    const context = await contextFor(actor),
      campus = normalizeCampus(campusId);
    if (
      !isDutyCampusId(campus) ||
      !(
        evaluate(context, 'attendance.correct', { campusId: campus }).allowed ||
        (readOnly && evaluate(context, 'attendance.token.issue', { campusId: campus }).allowed)
      )
    )
      fail(403, '没有该校区的考勤管理权限');
    return { context, campus };
  }
  function visibleDayRows(
    context: StaffContext,
    campus: string,
    data: DutyDay,
    attendance: AttendanceDay
  ) {
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
  async function attendanceWorkload(actor: StaffAccountDto, query: DutyQuery) {
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
  async function attendanceDay(actor: StaffAccountDto, query: DutyQuery) {
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
    const canCorrect = (memberId: string) =>
      canManage &&
      !service?.paused &&
      day <= dateKey() &&
      people.some((person) => person.memberId === memberId);
    const byMember = new Map<
      string,
      { memberId: string; name: string; assignments: DutyDay['assignments'] }
    >();
    for (const item of assignments) {
      const person = byMember.get(item.memberId);
      if (person) person.assignments.push(item);
      else
        byMember.set(item.memberId, {
          memberId: item.memberId,
          name: item.memberName,
          assignments: [item]
        });
    }
    const now = nowIso();
    const items = [...byMember.values()].map((person) => {
      const item = person.assignments[0];
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
          paused: Boolean(service?.paused),
          now
        })
      };
    });
    const temporary: AttendancePerson[] = records
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
    const decorate = (person: AttendancePerson) => ({
      ...person,
      maintenanceAffairs: posts.some(
        (post) => post.memberId === person.memberId && post.assignmentType === 'maintenance_affairs'
      ),
      dutyStatuses: Object.fromEntries(
        [...new Set((person.assignments || []).map((item) => item.dutyType))].map((type) => [
          type,
          attendanceStatus({
            assignments: (person.assignments || []).filter((item) => item.dutyType === type),
            record: person.record,
            paused: Boolean(service?.paused),
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
        expected: items.filter((row) => row.status !== 'paused').length,
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
