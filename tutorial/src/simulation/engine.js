import { makeState, campuses, departments, membership, rosterParticipantFor } from './fixtures.js';
import { addDays, serviceDay, calendarWeekRange } from '../../../shared/time.js';
import { TIME_SLOTS } from '../../../shared/constants.js';
import { availableForDuty, dutyCandidateTypes } from '../../../shared/duty.js';

export class SimulationError extends Error {
  constructor(message, status = 400, code = 'DEMO_VALIDATION') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createSimulation(profileId, lessonId) {
  const state = makeState(profileId, lessonId);
  const requirePermission = (code) => {
    if (!state.actor.permissions[code])
      throw new SimulationError('当前身份没有此操作权限。', 403, 'FORBIDDEN');
  };
  const management = () => state.actor.permissions['members.manage'];
  const stamp = () => new Date().toISOString();
  const list = (items) => ({ items, nextCursor: null, hasMore: false, total: items.length });
  const scope = (params) => {
    const campus = params.get('campusId') || params.get('campus');
    if (!campus || campus === 'all') return;
    const name = campuses.find((item) => item.id === campus)?.name || campus;
    if (!state.profile.campuses.includes(name))
      throw new SimulationError('当前身份无法操作此校区。', 403, 'CAMPUS_SCOPE');
  };
  function revise(item, body) {
    if (body.revision !== undefined && Number(body.revision) !== item.revision)
      throw new SimulationError('资料已更新，请读取最新内容后重试。', 409, 'REVISION_CONFLICT');
    item.revision++;
  }
  function dateCapacity(date, campus, timeSlot) {
    const weekday = new Date(`${date}T12:00:00+08:00`).getUTCDay();
    const paused = !!state.serviceDays[`${campus}:${date}`]?.paused;
    const capacity = paused
      ? 0
      : state.capacities.find(
          (item) => item.campus === campus && item.weekday === weekday && item.timeSlot === timeSlot
        )?.capacity || 0;
    const orders = state.orders.filter(
      (item) =>
        item.date === date &&
        item.campus === campus &&
        item.timeSlot === timeSlot &&
        !['cancelled', 'expired'].includes(item.status)
    );
    return {
      date,
      campus,
      timeSlot,
      capacity,
      occupied: orders.length,
      remaining: Math.max(0, capacity - orders.length),
      booked: orders.filter((item) => item.status === 'booked').length,
      inProgress: orders.filter((item) => item.status === 'in_progress').length,
      paused,
      ended: false
    };
  }
  function project(order) {
    const own = order.assignedMemberId === state.actor.memberId;
    const active = order.status === 'in_progress';
    const booked = order.status === 'booked';
    const canRepair = state.actor.permissions['repair.start'];
    const projected = {
      ...structuredClone(order),
      businessDate: state.today,
      canReceive: booked && !order.receivedAt && state.actor.permissions['repair.receive'],
      canStart: booked && canRepair,
      canFinish: active && own && canRepair,
      canTransfer: active && !own && canRepair,
      canCorrect: order.status === 'completed' && (management() || (own && canRepair)),
      canEdit: state.actor.permissions['repair.information.edit'],
      canRecoverCredential: state.actor.permissions['repair.information.edit'],
      canSupplement: !!order.photoDeferredBy && order.receivedBy === state.actor.account,
      servicePaused: !!state.serviceDays[order.date]?.paused,
      assigneeIdentities: [{ code: 'primary', label: '硬件部部员' }]
    };
    if (!management()) {
      projected.original = null;
      projected.repairHistory = { items: order.repairHistory.items };
    }
    return projected;
  }
  function filteredOrders(params = new URLSearchParams()) {
    return state.orders.filter((item) => {
      const query = params.get('q')?.toLowerCase();
      return (
        state.profile.campuses.includes(item.campus) &&
        (!params.get('date') || item.date === params.get('date')) &&
        (!params.get('dateFrom') || item.date >= params.get('dateFrom')) &&
        (!params.get('dateTo') || item.date <= params.get('dateTo')) &&
        (!params.get('status') ||
          params.get('status') === 'all' ||
          item.status === params.get('status')) &&
        (!params.get('campus') ||
          params.get('campus') === 'all' ||
          item.campus === params.get('campus')) &&
        (!params.get('timeSlot') || item.timeSlot === params.get('timeSlot')) &&
        (!query ||
          [
            item.id,
            item.name,
            item.studentId,
            item.phone,
            item.email,
            item.contactValue,
            item.brand,
            item.deviceModel,
            item.issue
          ]
            .join(' ')
            .toLowerCase()
            .includes(query))
      );
    });
  }
  function home(params) {
    const campusId = params.get('campusId') || 'campus-nanhu';
    const campusName = campuses.find((item) => item.id === campusId)?.name;
    const orders = state.orders.filter((item) => item.campus === campusName).map(project);
    const attendance =
      state.attendances.find(
        (item) =>
          item.memberId === state.actor.memberId &&
          item.businessDate === state.today &&
          item.campusId === campusId
      ) || null;
    return {
      ...state.actor,
      actor: { memberId: state.actor.memberId, name: state.actor.name },
      businessDate: state.today,
      updatedAt: stamp(),
      campusId,
      campuses: campuses.filter((item) => state.profile.campuses.includes(item.name)),
      contexts: [{ id: 'today', label: '今日工作' }],
      capability: state.actor.permissions,
      identities: [
        { code: 'staff', label: '工作人员' },
        { code: state.profile.id, label: state.profile.name }
      ],
      rosterParticipant: rosterParticipantFor(state.profile),
      searchCapabilities: {
        identity: true,
        identityScope: management() ? 'authorized' : 'today',
        contact: true,
        contactScope: management() ? 'authorized' : 'today'
      },
      directAttendance: { allowed: state.profile.id === 'affairs' || management(), reason: '' },
      attendance,
      todayDuties: state.assignments.filter(
        (item) =>
          item.memberId === state.actor.memberId &&
          item.businessDate === state.today &&
          item.campusId === campusId
      ),
      repairs: orders.filter(
        (item) => item.status === 'in_progress' && item.assignedMemberId === state.actor.memberId
      ),
      pendingPhotos: orders.filter((item) => item.canSupplement),
      appointments: orders,
      pendingCoverInvitations: state.covers.filter((item) => item.status === 'pending').length,
      event: {
        id: 'event-demo',
        revision: 1,
        startsAt: `${state.today}T18:30:00+08:00`,
        endsAt: `${state.today}T21:30:00+08:00`
      }
    };
  }
  function roster(params, body) {
    const weekStart = params.get('weekStart') || body?.weekStart || state.week;
    const campusId = params.get('campusId') || body?.campusId || 'campus-nanhu';
    const key = `${campusId}:${weekStart}`;
    if (body?.rosters) {
      state.rosters[key] = body.rosters.map((row) => ({
        ...row,
        revision: (row.revision || 0) + 1
      }));
      const incoming = body.rosters.flatMap((row) =>
        row.assignments.map((item) => ({
          ...item,
          campusId,
          campusName: campuses.find((campus) => campus.id === campusId)?.name,
          revision: 1
        }))
      );
      state.assignments = [
        ...state.assignments.filter(
          (item) =>
            !(
              item.campusId === campusId &&
              item.businessDate >= weekStart &&
              item.businessDate <= addDays(weekStart, 6)
            )
        ),
        ...incoming
      ];
    }
    return {
      weekStart,
      campusId,
      sourceVersion: `demo-${state.logs.length}`,
      paused: [],
      people: state.members.map((person) => ({
        ...person,
        availability: {
          repair: memberAvailability(person, 'repair', weekStart),
          office: memberAvailability(person, 'office', weekStart)
        },
        alreadyScheduled: 0
      })),
      rosters:
        state.rosters[key] ||
        ['repair', 'office'].map((dutyType) => ({
          dutyType,
          revision: 1,
          assignments: state.assignments.filter(
            (item) =>
              item.campusId === campusId &&
              item.dutyType === dutyType &&
              item.businessDate >= weekStart &&
              item.businessDate <= addDays(weekStart, 6)
          )
        }))
    };
  }
  function memberAvailability(person, type, weekStart) {
    if (!dutyCandidateTypes(person.memberships, weekStart).includes(type)) return [];
    if (person.memberId !== state.actor.memberId) return state.windows;
    return (
      (state.availability[`${type}:${weekStart}`] || state.availability[`${type}:`])?.windows || []
    );
  }
  function attendanceDay(params) {
    const campusId = params.get('campusId') || 'campus-nanhu';
    const businessDate = params.get('businessDate') || state.today;
    const people = state.members.map((member) => {
      const assignments = state.assignments.filter(
        (item) =>
          item.memberId === member.memberId &&
          item.campusId === campusId &&
          item.businessDate === businessDate
      );
      const record = state.attendances.find(
        (item) =>
          item.memberId === member.memberId &&
          item.businessDate === businessDate &&
          item.campusId === campusId
      );
      const working = state.orders.filter(
        (item) =>
          item.status === 'in_progress' &&
          item.assignedMemberId === member.memberId &&
          item.campus === campuses.find((campus) => campus.id === campusId)?.name
      );
      const status = assignments.some((item) => item.leaveStatus === 'recorded')
        ? 'leave'
        : record
          ? 'arrived'
          : 'upcoming';
      return {
        ...member,
        assignments,
        record,
        status,
        canCorrect: management(),
        identities: member.identities,
        department: member.memberships[0]?.departmentName || '',
        departmentName: member.memberships[0]?.departmentName || '',
        repairEligible: member.memberships.some(
          (post) =>
            post.departmentCode === 'hardware' &&
            (post.isPrimary || post.assignmentType === 'exchange')
        ),
        workStatus:
          record && businessDate === state.today ? (working.length ? 'repairing' : 'idle') : null,
        activeRepairs: working.length,
        dutyStatuses: { repair: status, office: status }
      };
    });
    const items = people.filter((person) => person.assignments.length);
    const temporary = people.filter((person) => !person.assignments.length && person.record);
    return {
      campusId,
      businessDate,
      items,
      temporary,
      people,
      paused: false,
      serverNow: stamp(),
      canManage: management(),
      canCorrect: management(),
      canIssueToken: state.actor.permissions['attendance.token.issue'],
      summary: {
        expected: items.filter((item) => item.status !== 'leave').length,
        arrived: items.filter((item) => item.record).length,
        absent: 0,
        upcoming: items.filter((item) => !item.record && item.status !== 'leave').length,
        leave: items.filter((item) => item.status === 'leave').length,
        temporary: temporary.length
      }
    };
  }
  function checkIn(body, correction = false) {
    requirePermission(correction ? 'attendance.correct' : 'attendance.self');
    const memberId = body.memberId || state.actor.memberId;
    const businessDate = body.businessDate || state.today;
    const campusId = body.campusId || 'campus-nanhu';
    const found = state.attendances.find(
      (item) =>
        item.memberId === memberId &&
        item.businessDate === businessDate &&
        item.campusId === campusId
    );
    if (found && !correction) return { ...found, isExisting: true };
    const record = found || {
      id: crypto.randomUUID(),
      memberId,
      campusId,
      businessDate,
      eventId: 'event-demo',
      type: 'duty',
      revision: 0
    };
    Object.assign(record, {
      occurredAt: body.occurredAt || `${businessDate}T19:00:00+08:00`,
      revision: record.revision + 1,
      name: state.members.find((item) => item.memberId === memberId)?.name,
      checkinSource: {
        kind: correction ? 'correction' : body.token ? 'qr' : 'direct',
        issuerName: '周宁',
        operatorName: '林知行',
        timeBasis: body.timeMode
      },
      identitySnapshot: {
        identities: state.members.find((item) => item.memberId === memberId)?.identities || []
      }
    });
    if (!found) state.attendances.push(record);
    return record;
  }
  function memberDetail(member) {
    return {
      member,
      bindings: member.bindings || [],
      account: state.accounts.find((item) => item.memberId === member.memberId) || null,
      actions: {
        editProfile: true,
        editMemberships: true,
        manageAccount: true,
        editSpecialIdentities: state.profile.id === 'superadmin'
      },
      activation: {
        status: 'open',
        authorizedCampuses: ['南湖'],
        roleNames: [],
        canConfigure: true,
        stateToken: 'demo'
      }
    };
  }
  function memberRows(params = new URLSearchParams()) {
    const month = params.get('month') || state.today.slice(0, 7);
    const inRange = (item) =>
      item.businessDate.startsWith(month) &&
      (!params.get('campusId') || item.campusId === params.get('campusId')) &&
      (!params.get('weekStart') || item.businessDate >= params.get('weekStart')) &&
      (!params.get('weekEnd') || item.businessDate <= addDays(params.get('weekEnd'), 6));
    return state.members.map((member) => {
      const assignments = state.assignments.filter(
        (item) => item.memberId === member.memberId && inRange(item)
      );
      const records = state.attendances.filter(
        (item) => item.memberId === member.memberId && inRange(item)
      );
      const counted =
        params.get('firstOnly') === '1'
          ? new Set(records.map((item) => calendarWeekRange(item.businessDate).start)).size
          : records.length;
      const hours = counted * state.reportSettings.hoursPerCount;
      const dates = [
        ...new Set([
          ...assignments.map((item) => item.businessDate),
          ...records.map((item) => item.businessDate)
        ])
      ].sort();
      const entries = dates.map((businessDate) => {
        const scheduled = assignments.filter((item) => item.businessDate === businessDate);
        const record = records.find((item) => item.businessDate === businessDate) || null;
        return {
          businessDate,
          assignments: scheduled,
          record,
          status: record
            ? 'arrived'
            : scheduled.some((item) => item.leaveStatus === 'recorded')
              ? 'leave'
              : 'upcoming'
        };
      });
      return {
        ...member,
        campus: '南湖',
        department: member.memberships[0]?.departmentName || '',
        counts: counted,
        count: counted,
        actualCount: records.length,
        counted,
        hours,
        calculatedHours: hours,
        volunteerHours: hours,
        reason: '实际签到',
        basis: 'attendance',
        canManageProfile: true,
        weekStart: state.week,
        summary: {
          expected: entries.filter((item) => item.assignments.length && item.status !== 'leave')
            .length,
          arrived: records.length,
          absent: 0,
          leave: entries.filter((item) => item.status === 'leave').length,
          support: entries.filter((item) => !item.assignments.length && item.record).length,
          upcoming: entries.filter((item) => item.status === 'upcoming').length
        },
        entries
      };
    });
  }
  async function dispatch(input, method = 'GET', body = {}) {
    const url = new URL(input, 'https://tutorial.invalid');
    const path = url.pathname;
    const params = url.searchParams;
    scope(params);
    if (body.campusId || body.campus)
      scope(
        new URLSearchParams({
          ...(body.campusId ? { campusId: body.campusId } : { campus: body.campus })
        })
      );
    const write = method !== 'GET';
    if (state.failNext && write) {
      state.failNext = false;
      throw new SimulationError('演示：保存失败，草稿已保留。请重试。', 503, 'DEMO_RETRY');
    }
    if (path === '/api/auth/me') return state.actor;
    if (path === '/api/auth/login') return { token: 'tutorial-session' };
    if (['/api/auth/logout', '/api/auth/password', '/api/auth/revoke'].includes(path))
      return { ok: true };
    if (['/api/field/home', '/api/field/board'].includes(path)) return home(params);
    const detailMatch = path.match(/^\/api\/field\/appointments\/([^/]+)$/);
    if (detailMatch) {
      const item = state.orders.find((order) => order.id === detailMatch[1]);
      if (!item) throw new SimulationError('未找到此演示工单。', 404);
      return project(item);
    }
    if (path === '/api/scan/search')
      return list(filteredOrders(new URLSearchParams({ q: body.q || '' })).map(project));
    if (path === '/api/scan/resolve')
      return { id: state.orders.find((item) => item.id === body.id)?.id || state.orders[0].id };
    if (path === '/api/scan/onsite') {
      requirePermission('onsite.create');
      const order = {
        ...structuredClone(makeState(state.profile.id).orders[0]),
        ...body,
        id: `0${state.today.replaceAll('-', '')}-${String(state.orders.length + 1).padStart(2, '0')}`,
        receivedAt: null,
        receivedBy: null,
        receivedByName: null,
        frontPhotoId: null,
        backPhotoId: null,
        original: { ...body, signature: body.signature || null },
        status: 'booked',
        revision: 1,
        assignedMemberId: null,
        assignedToName: null
      };
      state.orders.push(order);
      return { ...project(order), accessToken: 'demo-query-token' };
    }
    if (path === '/api/appointments')
      return {
        ...list(filteredOrders(params).map(project)),
        counts: counts(filteredOrders(params)),
        filteredCounts: counts(filteredOrders(params))
      };
    function counts(orders) {
      return Object.fromEntries(
        ['all', 'booked', 'in_progress', 'completed', 'cancelled', 'expired'].map((status) => [
          status,
          status === 'all'
            ? orders.length
            : orders.filter((order) => order.status === status).length
        ])
      );
    }
    if (path === '/api/appointments/counts')
      return { counts: counts(state.orders), filteredCounts: counts(filteredOrders(params)) };
    if (path === '/api/appointments/overview') {
      const week = calendarWeekRange(state.today);
      const dates = Array.from({ length: 7 }, (_, index) => addDays(week.start, index)).filter(
        serviceDay
      );
      const items = dates.flatMap((date) =>
        state.profile.campuses.flatMap((campus) =>
          TIME_SLOTS.map((timeSlot) => dateCapacity(date, campus, timeSlot))
        )
      );
      return {
        start: dates[0],
        end: dates.at(-1),
        dates,
        campuses: state.profile.campuses,
        nextServiceDate: state.today,
        items,
        week: { start: week.start, end: week.end, dates, items },
        updatedAt: stamp()
      };
    }
    const orderMatch = path.match(/^\/api\/appointments\/([^/]+)\/(.+)$/);
    if (orderMatch) {
      const order = state.orders.find((item) => item.id === orderMatch[1]);
      if (!order) throw new SimulationError('未找到此演示工单。', 404);
      const action = orderMatch[2];
      if (action === 'attachments') {
        const attached = state.attachments[order.id] || [];
        return list(
          attached.length
            ? attached
            : order.receivedAt
              ? [
                  {
                    id: 'sample-front',
                    filename: '接收正面.jpg',
                    size: 182400,
                    purpose: 'intake_front'
                  },
                  {
                    id: 'sample-back',
                    filename: '接收背面.jpg',
                    size: 162200,
                    purpose: 'intake_back'
                  }
                ]
              : []
        );
      }
      if (action.startsWith('attachments/')) return { sampleImage: true, id: action.split('/')[1] };
      if (action === 'credential')
        return { id: order.id, accessToken: 'demo-query-token', token: 'demo-query-token' };
      if (['history', 'original', 'repair-history'].includes(action))
        return management() ? order.repairHistory : { items: [] };
      if (action === 'information') {
        requirePermission('repair.information.edit');
        revise(order, body);
        for (const [key, value] of Object.entries(body))
          if (!['revision', 'requestId', 'note'].includes(key)) order[key] = value;
        if ('note' in body && management()) order.original.note = body.note;
      } else if (action === 'receive' || (action === 'status' && body.status === 'in_progress')) {
        requirePermission(action === 'receive' ? 'repair.receive' : 'repair.start');
        if (order.status !== 'booked')
          throw new SimulationError('仅待接单工单可以接收或开始维修。');
        if (!order.receivedAt && !(body.frontPhotoId && body.backPhotoId) && !body.uploadTimedOut)
          throw new SimulationError('请先添加正反面照片。');
        revise(order, body);
        const verification = body.verification || {};
        const firstReception = !order.receivedAt;
        Object.assign(order, {
          brand: verification.brand || order.brand,
          deviceModel: verification.model || order.deviceModel,
          receivedAt: order.receivedAt || stamp(),
          ...(firstReception
            ? { receivedBy: state.actor.account, receivedByName: state.actor.name }
            : {}),
          frontPhotoId: body.frontPhotoId || order.frontPhotoId,
          backPhotoId: body.backPhotoId || order.backPhotoId
        });
        if (body.uploadTimedOut) order.photoDeferredBy = state.actor.account;
        if (action === 'status')
          Object.assign(order, {
            status: 'in_progress',
            assignedMemberId: state.actor.memberId,
            assignedTo: state.actor.account,
            assignedToName: state.actor.name,
            startedAt: stamp()
          });
      } else if (action === 'status' || action === 'correction') {
        const projected = project(order);
        if (!(action === 'correction' ? projected.canCorrect : projected.canFinish))
          throw new SimulationError('当前身份无法结束或更正此工单。', 403);
        if (!body.outcome || !body.repairNote?.trim())
          throw new SimulationError('请选择处理结果并填写说明。');
        revise(order, body);
        Object.assign(order, {
          status: 'completed',
          outcome: body.outcome,
          repairNote: body.repairNote,
          completedAt: stamp()
        });
      } else if (action === 'transfer') {
        requirePermission('repair.transfer');
        if (!body.receivedDevice) throw new SimulationError('请先确认已实际接到设备。');
        revise(order, body);
        Object.assign(order, {
          assignedMemberId: state.actor.memberId,
          assignedTo: state.actor.account,
          assignedToName: state.actor.name
        });
      } else if (action === 'photos') {
        Object.assign(order, {
          frontPhotoId: body.frontPhotoId,
          backPhotoId: body.backPhotoId,
          photoDeferredBy: null
        });
      } else if (action === 'link') {
        Object.assign(order, {
          parentAppointmentId: body.parentAppointmentId || null,
          linkKind: body.linkKind || null
        });
      } else throw new SimulationError(`尚未实现演示操作：${action}`, 501, 'UNHANDLED_DEMO_API');
      order.repairHistory.events.push({
        action,
        actorName: state.actor.name,
        assignedMemberId: order.assignedMemberId,
        occurredAt: stamp(),
        reason: body.repairNote || '演示操作',
        before: {},
        after: {}
      });
      return project(order);
    }
    if (path === '/api/me/profile') {
      if (write) {
        revise(state.members[0], body);
        Object.assign(state.members[0], { name: body.name, college: body.college });
        state.actor.name = body.name;
      }
      return { member: state.members[0] };
    }
    if (path === '/api/me/volunteer-summary') {
      const records = state.attendances.filter((item) => item.memberId === state.actor.memberId);
      return {
        month: state.today.slice(0, 7),
        asOf: stamp(),
        settings: state.reportSettings,
        monthHours:
          records.filter((item) => item.businessDate.startsWith(state.today.slice(0, 7))).length *
          state.reportSettings.hoursPerCount,
        totalHours: records.length * state.reportSettings.hoursPerCount
      };
    }
    if (path === '/api/me/roster')
      return list(
        state.assignments.filter(
          (item) =>
            item.memberId === state.actor.memberId &&
            (!params.get('weekStart') ||
              (item.businessDate >= params.get('weekStart') &&
                item.businessDate <= addDays(params.get('weekStart'), 6))) &&
            (!params.get('upcoming') || item.businessDate >= state.today)
        )
      );
    if (path === '/api/me/availability') {
      if (!home(new URLSearchParams()).rosterParticipant)
        throw new SimulationError('当前身份不参与自动排班和空闲填报。', 403);
      const dutyType = params.get('dutyType') || body.dutyType || 'repair';
      const key = `${dutyType}:${body.weekStart ?? params.get('weekStart') ?? ''}`;
      if (method === 'DELETE' || body.useUsual) delete state.availability[key];
      else if (write)
        state.availability[key] = {
          revision: (state.availability[key]?.revision || 0) + 1,
          windows: body.windows
        };
      const usual = state.availability[`${dutyType}:`] || { revision: 1, windows: [] };
      const exception = key.endsWith(':') ? null : state.availability[key] || null;
      return {
        usual,
        exception,
        effectiveWindows: exception?.windows || usual.windows,
        source: exception ? 'exception' : 'usual',
        campuses,
        dutyType
      };
    }
    if (path === '/api/rosters/campus-week') {
      requirePermission('roster.manage');
      return roster(params, write ? body : null);
    }
    if (path === '/api/rosters/week/suggestions') {
      requirePermission('roster.manage');
      const assignments = [...body.assignments];
      for (let index = 0; index < 4; index++) {
        const businessDate = addDays(body.weekStart, index);
        const dutyType = index === 2 ? 'office' : 'repair';
        const weekday = new Date(`${businessDate}T00:00:00Z`).getUTCDay() || 7;
        const candidates = state.members.filter((person) =>
          availableForDuty(
            memberAvailability(person, dutyType, body.weekStart),
            weekday,
            body.campusId
          )
        );
        const person = candidates[index % candidates.length];
        if (!person) continue;
        assignments.push({
          id: `suggest-${index}`,
          memberId: person.memberId,
          memberName: person.name,
          businessDate,
          dutyType,
          startAt: '19:00',
          endAt: '21:00',
          suggested: true
        });
      }
      return { assignments, unassigned: [], gaps: [], sourceVersion: `demo-${state.logs.length}` };
    }
    if (path === '/api/rosters/covers')
      return list(
        state.covers.map((item) => ({
          ...item,
          fromName: item.fromMemberName,
          toName: item.toMemberName,
          canRespond: item.status === 'pending' && item.toMemberId === state.actor.memberId,
          canCancel: item.status === 'pending' && item.fromMemberId === state.actor.memberId,
          assignment: item.assignment || { ...item, id: item.assignmentId }
        }))
      );
    const shiftMatch = path.match(/^\/api\/rosters\/assignments\/([^/]+)\/(.+)$/);
    if (shiftMatch) {
      const assignment = state.assignments.find((item) => item.id === shiftMatch[1]);
      if (shiftMatch[2] === 'cover-candidates')
        return list(state.members.filter((item) => item.memberId !== state.actor.memberId));
      if (!assignment) throw new SimulationError('未找到班次。', 404);
      if (shiftMatch[2] === 'leave') assignment.leaveStatus = 'recorded';
      if (shiftMatch[2] === 'leave-withdraw') assignment.leaveStatus = null;
      if (shiftMatch[2] === 'cover')
        state.covers.push({
          ...assignment,
          id: crypto.randomUUID(),
          assignmentId: assignment.id,
          fromMemberId: state.actor.memberId,
          fromMemberName: state.actor.name,
          toMemberId: body.toMemberId,
          toMemberName: state.members.find((item) => item.memberId === body.toMemberId)?.name,
          status: 'pending',
          note: body.note
        });
      return assignment;
    }
    const coverMatch = path.match(/^\/api\/rosters\/covers\/([^/]+)\/response$/);
    if (coverMatch) {
      const cover = state.covers.find((item) => item.id === coverMatch[1]);
      if (!cover) throw new SimulationError('未找到接替邀请。', 404);
      if (body.decision === 'accepted') {
        const assignment = state.assignments.find((item) => item.id === cover.assignmentId);
        if (!assignment) throw new SimulationError('原班次不存在，无法接替。', 409);
        const member = state.members.find((item) => item.memberId === cover.toMemberId);
        Object.assign(assignment, {
          memberId: member.memberId,
          memberName: member.name,
          memberships: member.memberships,
          leaveStatus: null,
          revision: assignment.revision + 1
        });
      }
      Object.assign(cover, { status: body.decision || 'accepted' });
      return cover;
    }
    if (path === '/api/attendance/day') return attendanceDay(params);
    if (path === '/api/attendance/staffing') {
      const day = attendanceDay(params);
      return {
        idle: day.people.filter((item) => item.workStatus === 'idle' && item.repairEligible),
        missing: day.items.filter((item) => !item.record && item.status !== 'leave'),
        repairing: day.people.filter((item) => item.workStatus === 'repairing'),
        updatedAt: stamp()
      };
    }
    if (path === '/api/attendance/workload') {
      const month = params.get('month') || state.today.slice(0, 7);
      return {
        month,
        ...list(
          state.members.map((member) => {
            const orders = state.orders.filter(
              (order) =>
                order.assignedMemberId === member.memberId ||
                order.repairHistory.events.some(
                  (event) => event.assignedMemberId === member.memberId
                )
            );
            return {
              memberId: member.memberId,
              monthly: orders.filter((order) => order.startedAt?.startsWith(month)).length,
              total: orders.length
            };
          })
        )
      };
    }
    if (path === '/api/attendance/events') {
      requirePermission('attendance.token.issue');
      return { id: 'event-demo', revision: 1 };
    }
    if (/^\/api\/attendance\/events\/.+\/token$/.test(path)) {
      requirePermission('attendance.token.issue');
      return {
        token: 'pioneer:attendance:v1:demo-tutorial',
        expiresAt: new Date(Date.now() + 300000).toISOString()
      };
    }
    if (path === '/api/attendance/preview')
      return {
        campusId: 'campus-nanhu',
        campusName: '南湖',
        businessDate: state.today,
        startsAt: `${state.today}T18:30:00+08:00`,
        endsAt: `${state.today}T21:30:00+08:00`,
        type: 'duty'
      };
    if (
      [
        '/api/attendance/check-ins',
        '/api/attendance/self-check-in',
        '/api/attendance/corrections'
      ].includes(path)
    )
      return checkIn(body, path.endsWith('/corrections'));
    if (['/api/attendance', '/api/me/attendance'].includes(path))
      return {
        ...list(
          state.attendances.filter(
            (item) => path === '/api/attendance' || item.memberId === state.actor.memberId
          )
        ),
        definition: { timezone: 'Asia/Shanghai' },
        options: [],
        summary: {}
      };
    if (path === '/api/attendance/options')
      return { members: state.members, campuses, events: [], types: ['duty'] };
    if (path === '/api/attendance/report-settings') {
      if (write) {
        requirePermission('settings.manage');
        Object.assign(state.reportSettings, body, { revision: state.reportSettings.revision + 1 });
      }
      return state.reportSettings;
    }
    if (path === '/api/attendance/weekly-summary') {
      requirePermission('attendance.export');
      return {
        rows: memberRows(params),
        weekStart: params.get('weekStart') || state.week,
        weekEnd: params.get('weekEnd') || state.week
      };
    }
    if (path === '/api/attendance/volunteer-report') {
      requirePermission('attendance.export');
      return {
        month: params.get('month') || state.today.slice(0, 7),
        settings: state.reportSettings,
        weeks: [
          {
            weekStart: state.week,
            weekEnd: addDays(state.week, 6),
            weekNumber: 1,
            campuses: state.profile.campuses.map((campus) => ({
              campus,
              campusId: campuses.find((item) => item.name === campus).id,
              rows: memberRows(params)
            }))
          }
        ]
      };
    }
    if (path === '/api/attendance/matrix') {
      requirePermission('attendance.export');
      return { month: params.get('month'), dates: [state.today], rows: memberRows(params) };
    }
    if (path === '/api/organization/campuses') return list(campuses);
    if (path === '/api/organization/departments') return list(departments);
    if (path === '/api/members') {
      requirePermission('members.manage');
      if (write) {
        if (state.members.some((item) => item.studentId === body.studentId))
          throw new SimulationError('此学号已有人员记录。', 409, 'MEMBER_EXISTS');
        const member = {
          ...structuredClone(state.members[1]),
          ...body,
          memberId: crypto.randomUUID(),
          memberships: body.departmentId ? [membership()] : [],
          revision: 1
        };
        state.members.push(member);
        return { member };
      }
      return list(
        state.members.filter(
          (item) =>
            (!params.get('q') ||
              [item.name, item.studentId, ...item.memberships.map((post) => post.departmentName)]
                .join(' ')
                .includes(params.get('q'))) &&
            (!params.get('homeCampusId') || params.get('homeCampusId') === item.homeCampusId) &&
            (!params.get('status') || params.get('status') === item.status)
        )
      );
    }
    if (['/api/members/import', '/api/members/education-import'].includes(path)) {
      requirePermission('members.manage');
      const lines = (body.csv || '').trim().split(/\r?\n/).slice(1);
      const items = lines.filter(Boolean).map((line, index) => {
        const [studentId, name, college] = line.split(',');
        const education = path.endsWith('education-import');
        return {
          row: index + 2,
          studentId,
          name: education
            ? state.members.find((person) => person.studentId === studentId)?.name || '示例人员'
            : name,
          college: education ? name : college || '计算机科学与工程学院',
          revision: 1,
          status: 'created',
          action: 'created',
          errors: [],
          warnings: [],
          changes: [],
          conflicts: [],
          member: { studentId, name }
        };
      });
      if (body.confirm) {
        for (const item of items) {
          const existing = state.members.find((person) => person.studentId === item.studentId);
          if (existing) existing.college = item.college;
          else
            state.members.push({
              ...structuredClone(state.members[1]),
              ...item,
              memberId: crypto.randomUUID(),
              revision: 1
            });
        }
      }
      return {
        items,
        rows: items,
        count: items.length,
        summary: {
          created: items.length,
          updated: 0,
          skipped: 0,
          conflict: 0,
          total: items.length
        },
        previewToken: 'demo-preview',
        applied: body.confirm ? items.length : 0,
        confirmed: !!body.confirm
      };
    }
    const memberMatch = path.match(/^\/api\/members\/([^/]+)(?:\/(.+))?$/);
    if (memberMatch) {
      requirePermission('members.manage');
      const member = state.members.find((item) => item.memberId === memberMatch[1]);
      if (!member) throw new SimulationError('未找到成员。', 404);
      const action = memberMatch[2];
      if (action === 'audit')
        return list(
          state.logs.map((item) => ({
            ...item,
            id: crypto.randomUUID(),
            actorName: '林知行',
            occurredAt: stamp(),
            createdAt: stamp(),
            action: item.path
          }))
        );
      if (action === 'activation')
        return {
          status: 'open',
          authorizedCampuses: ['南湖'],
          roleNames: [],
          canConfigure: true,
          stateToken: 'demo'
        };
      if (action === 'retired-elder') {
        requirePermission('roles.manage');
        member.specialIdentities = body.enabled ? ['retired_elder'] : [];
        member.revision++;
      } else if (action === 'roles') {
        requirePermission('roles.manage');
        member.bindings = body.bindings;
        member.revision++;
      } else if (action?.startsWith('memberships')) {
        if (method === 'PATCH') {
          const post = member.memberships.find((item) => item.id === action.split('/')[1]);
          if (post) Object.assign(post, { effectiveTo: body.effectiveTo || state.today });
        } else {
          const department = departments.find((item) => item.id === body.departmentId);
          const primary = {
            ...membership(),
            ...body,
            departmentName: department?.name || '',
            departmentCode: department?.code || ''
          };
          if (body.memberships)
            for (const post of body.memberships)
              member.memberships.push({
                ...membership(post.assignmentType, post.positionCode || 'member'),
                ...post,
                effectiveFrom: body.effectiveFrom,
                effectiveTo: body.effectiveTo,
                revision: 1
              });
          else if (body.departmentId) member.memberships.push(primary);
          for (const [key, type] of [
            ['exchangeParticipation', 'exchange'],
            ['maintenanceParticipation', 'maintenance_affairs']
          ])
            if (body[key]) member.memberships.push(membership(type));
        }
        member.revision++;
      } else if (write && !action) {
        revise(member, body);
        Object.assign(member, { ...body, revision: member.revision });
      }
      return memberDetail(member);
    }
    if (path === '/api/users') {
      requirePermission('accounts.manage');
      return list(state.accounts);
    }
    const accountMatch = path.match(/^\/api\/users\/([^/]+)$/);
    if (accountMatch) {
      requirePermission('accounts.manage');
      const account = state.accounts.find((item) => item.account === accountMatch[1]);
      if (write && account) Object.assign(account, body);
      return account;
    }
    if (path === '/api/activation-requests') {
      requirePermission('accounts.manage');
      return list(state.activations);
    }
    if (path === '/api/activation-requests/review') {
      requirePermission('accounts.manage');
      if (body.status === 'approved' && !body.identityVerified)
        throw new SimulationError('请先核实本人身份。');
      for (const activation of state.activations.filter((item) => body.ids.includes(item.id))) {
        Object.assign(activation, { status: body.status, reviewNote: body.reviewNote });
        if (body.status === 'approved')
          state.accounts.push({
            ...structuredClone(state.accounts[1]),
            ...activation,
            status: 'enabled',
            actions: { edit: true, resetPassword: true, changeStatus: true }
          });
      }
      return { applied: body.ids, conflicts: [] };
    }
    if (path === '/api/staff-whitelist') {
      requirePermission('accounts.manage');
      return list(
        state.members.slice(4).map((item) => ({
          ...item,
          expectedName: item.name,
          expectedRole: 'technician',
          status: item.enrollmentStatus || 'open',
          authorizedCampuses: ['南湖'],
          roleNames: [],
          revision: 1,
          actions: { revoke: true, enable: true }
        }))
      );
    }
    if (path.startsWith('/api/staff-whitelist/')) {
      requirePermission('accounts.manage');
      const member = state.members.find(
        (item) => item.studentId === path.split('/')[3] || item.memberId === path.split('/')[3]
      );
      if (member)
        member.enrollmentStatus = body.status || (method === 'DELETE' ? 'revoked' : 'open');
      return { ok: true };
    }
    if (path === '/api/slot-capacities') {
      requirePermission('booking.manage');
      if (write)
        for (const change of body.items || body.changes || []) {
          const item = state.capacities.find(
            (row) =>
              row.campus === change.campus &&
              row.weekday === change.weekday &&
              row.timeSlot === change.timeSlot
          );
          if (item) {
            revise(item, change);
            item.capacity = change.capacity;
          }
        }
      return { items: state.capacities, applied: (body.items || []).length };
    }
    if (path === '/api/slot-capacities/actual') {
      const date = params.get('date') || state.today;
      const campus = params.get('campus') || '南湖';
      const items = TIME_SLOTS.map((timeSlot) => dateCapacity(date, campus, timeSlot));
      return {
        date,
        source: 'template',
        paused: items[0].paused,
        items,
        staffing: { repair: 3, office: 1 }
      };
    }
    if (path === '/api/booking-settings/manage') {
      const campus = params.get('campus') || '南湖';
      return {
        settings: state.bookingSettingsByCampus?.[campus] || {
          revision: 1,
          releaseTime: '12:00',
          campus
        },
        notices: state.notices.filter((item) => (item.campus || '南湖') === campus),
        suspended: !!state.serviceDays[`${campus}:${state.today}`]?.paused
      };
    }
    if (path === '/api/booking-settings') {
      requirePermission('booking.manage');
      state.bookingSettingsByCampus ||= {};
      const campus = body.campus || '南湖';
      const previous = state.bookingSettingsByCampus[campus] || {
        revision: 1,
        releaseTime: '12:00',
        campus
      };
      return (state.bookingSettingsByCampus[campus] = {
        ...previous,
        ...body,
        revision: previous.revision + 1
      });
    }
    if (path === '/api/booking-notices') {
      requirePermission('booking.manage');
      const notice = {
        ...body,
        id: body.id || crypto.randomUUID(),
        revision: (body.revision || 0) + 1
      };
      state.notices = [notice, ...state.notices.filter((item) => item.id !== notice.id)];
      return notice;
    }
    if (path === '/api/service-days') {
      requirePermission('booking.manage');
      const keyOf = (item) =>
        `${campuses.find((campus) => campus.id === item.campusId)?.name || params.get('campus') || '南湖'}:${item.businessDate}`;
      if (write)
        for (const item of body.items || [])
          state.serviceDays[keyOf(item)] = { ...item, revision: (item.revision ?? -1) + 1 };
      if (write) return { items: (body.items || []).map((item) => state.serviceDays[keyOf(item)]) };
      const start = params.get('start') || state.today;
      const campus = params.get('campus') || '南湖';
      return {
        serverNow: stamp(),
        items: Array.from({ length: 42 }, (_, index) => {
          const day = addDays(start, index);
          return {
            businessDate: day,
            item: state.serviceDays[`${campus}:${day}`] || null,
            affected: state.orders.filter(
              (item) => item.date === day && item.campus === campus && item.status === 'booked'
            )
          };
        })
      };
    }
    if (path === '/api/service-locations') {
      requirePermission('booking.manage');
      if (write) {
        const item = { ...body, revision: (body.revision || 0) + 1 };
        state.locations[`${body.campus}:${body.date}`] = item;
        return item;
      }
      return list(
        state.profile.campuses.map((campus) => ({
          campus,
          date: params.get('dateFrom') || state.today,
          location: '大学生活动中心202室',
          revision: 1,
          ...state.locations[`${campus}:${params.get('dateFrom') || state.today}`]
        }))
      );
    }
    if (path === '/api/service-locations/history') {
      const current = state.locations[`${params.get('campus')}:${params.get('date')}`];
      return {
        location: current?.location || '大学生活动中心202室',
        revision: current?.revision || 1,
        affectedAppointments: state.orders.filter((item) => item.status === 'booked'),
        changes: []
      };
    }
    if (path === '/api/stats/summary') {
      requirePermission('statistics.read');
      return {
        total: state.orders.length,
        completed: state.orders.filter((item) => item.status === 'completed').length,
        cancelled: 0,
        expired: 0,
        linkedRepairs: 0,
        repairSuccessRate: 100,
        completionRate: 40,
        daily: { [state.today]: { total: state.orders.length, completed: 1 } },
        faults: { 系统问题: 3, 清灰维护: 2 },
        campuses: { 南湖: state.orders.length },
        technicians: { 'tutorial-self': { assignedToName: '林知行', started: 3, completed: 1 } }
      };
    }
    if (path === '/api/roles') {
      requirePermission('roles.manage');
      return list(state.roles);
    }
    if (path === '/api/permissions') {
      requirePermission('roles.manage');
      return {
        items: ['settings.manage', 'roles.manage', 'audit.read'].map((code) => ({
          code,
          name: code,
          description: '额外系统权限',
          module: 'system',
          configurable: true
        })),
        modules: []
      };
    }
    if (path.startsWith('/api/roles/')) {
      requirePermission('roles.manage');
      const role = state.roles.find((item) => item.id === path.split('/')[3]);
      if (role) Object.assign(role, body);
      return role;
    }
    if (path === '/api/warranty/providers')
      return {
        providers: ['lenovo', 'dell', 'hp', 'asus', 'apple', 'huawei', 'honor', 'acer', 'msi'].map(
          (id) => ({ id, available: true, mode: 'automatic', message: '本地演示结果' })
        )
      };
    if (path === '/api/warranty/query')
      return {
        brand: body.brand,
        serial: body.serial,
        outcome: 'found',
        status: 'expired',
        checkedAt: stamp(),
        source: { name: '演示保修记录', url: '' },
        note: '此结果为教程示例。',
        services: [
          {
            name: '基础保修',
            category: '保修',
            start: '2026-01-01',
            end: addDays(state.today, -60),
            status: 'expired'
          }
        ]
      };
    if (path === '/api/activation')
      return { id: 'activation-demo', receipt: 'demo-receipt', status: 'pending' };
    if (path.startsWith('/api/activation/')) return state.activations[0];
    if (path.includes('export') || path.endsWith('.csv'))
      return { csv: '\uFEFF姓名,学号,演示记录\r\n林知行,20260001,1\r\n' };
    throw new SimulationError(`教程尚未覆盖此请求：${method} ${path}`, 501, 'UNHANDLED_DEMO_API');
  }
  return {
    state,
    project,
    home,
    async request(input, method = 'GET', body = {}) {
      const result = await dispatch(input, method, body);
      if (method !== 'GET')
        state.logs.push({
          path: new URL(input, 'https://tutorial.invalid').pathname,
          method,
          body: structuredClone(body)
        });
      return structuredClone(result);
    }
  };
}
