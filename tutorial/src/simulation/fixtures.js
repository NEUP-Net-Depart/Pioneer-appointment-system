import { dateKey, addDays, rosterWeekKey } from '../../../shared/time.js';
import { TIME_SLOTS } from '../../../shared/constants.js';

export const profiles = [
  { id: 'head', name: '硬件部部长', track: 'leader', position: 'head', campuses: ['南湖'] },
  {
    id: 'deputy-head',
    name: '硬件部副部长',
    track: 'leader',
    position: 'deputy_head',
    campuses: ['南湖']
  },
  {
    id: 'department-head',
    name: '其他部门部长',
    track: 'leader',
    position: 'head',
    department: 'office',
    campuses: ['南湖']
  },
  {
    id: 'department-deputy',
    name: '其他部门副部长',
    track: 'leader',
    position: 'deputy_head',
    department: 'office',
    campuses: ['南湖']
  },
  {
    id: 'director',
    name: '站长',
    track: 'leader',
    position: 'director',
    campuses: ['南湖', '浑南']
  },
  {
    id: 'deputy-director',
    name: '副站长',
    track: 'leader',
    position: 'deputy_director',
    campuses: ['南湖', '浑南']
  },
  {
    id: 'president',
    name: '主席',
    track: 'leader',
    position: 'president',
    campuses: ['南湖', '浑南']
  },
  {
    id: 'vice-president',
    name: '副主席',
    track: 'leader',
    position: 'vice_president',
    campuses: ['南湖', '浑南']
  },
  {
    id: 'affairs',
    name: '基础事务站值班 · 维修事务',
    track: 'affairs',
    assignment: 'maintenance_affairs',
    campuses: ['南湖']
  },
  {
    id: 'repair',
    name: '硬件部部员 · 维修工作人员',
    track: 'member',
    assignment: 'primary',
    campuses: ['南湖']
  },
  { id: 'exchange', name: '交流维修', track: 'member', assignment: 'exchange', campuses: ['南湖'] },
  { id: 'retired', name: '退休老登', track: 'leader', campuses: ['南湖', '浑南'] },
  { id: 'superadmin', name: '系统管理员', track: 'system', campuses: ['南湖', '浑南'] }
];

export const campuses = [
  { id: 'campus-nanhu', name: '南湖' },
  { id: 'campus-hunnan', name: '浑南' }
];
export function prepareWorkflow(state, workflow) {
  if (!workflow) return;
  Object.assign(state.orders[2], {
    assignedMemberId: 'demo-chen',
    assignedTo: 'demo-chen',
    assignedToName: '陈一帆',
    receivedBy: 'demo-zhou',
    receivedByName: '周宁'
  });
  Object.assign(state.orders[3], {
    assignedMemberId: 'demo-wen',
    assignedTo: 'demo-wen',
    assignedToName: '温言',
    date: addDays(state.today, -1),
    startedAt: `${addDays(state.today, -1)}T19:05:00+08:00`
  });
  const chen = state.assignments.find((item) => item.id === 'shift-chen');
  const invitation = state.covers[0];
  invitation.assignmentId = 'shift-chen-cover';
  state.assignments.push({
    ...structuredClone(chen),
    id: invitation.assignmentId,
    businessDate: invitation.businessDate
  });
  if (workflow !== 'attendance') return;
  for (const [memberId, leaveStatus] of [
    ['demo-wen', null],
    ['demo-xu', 'recorded']
  ]) {
    const person = state.members.find((item) => item.memberId === memberId);
    state.assignments.push({
      ...structuredClone(chen),
      id: `shift-${memberId}`,
      memberId,
      memberName: person.name,
      memberships: person.memberships,
      leaveStatus
    });
  }
  state.attendances = ['demo-chen', 'demo-lu', 'demo-zhou'].map((memberId, index) => ({
    id: `attendance-${memberId}`,
    memberId,
    name: state.members.find((item) => item.memberId === memberId).name,
    campusId: 'campus-nanhu',
    businessDate: state.today,
    eventId: 'event-demo',
    type: 'duty',
    revision: 1,
    occurredAt: `${state.today}T19:0${index + 1}:00+08:00`,
    checkinSource: { kind: memberId === 'demo-zhou' ? 'direct' : 'qr', issuerName: '周宁' }
  }));
}
export const rosterParticipantFor = (profile) =>
  profile.id === 'affairs' ||
  profile.id === 'repair' ||
  (!!profile.position && !profile.department);
export const departments = [
  {
    id: 'dept-hardware',
    code: 'hardware',
    name: '硬件部',
    kind: 'department',
    campusId: 'campus-nanhu',
    enabled: true
  },
  {
    id: 'dept-office',
    code: 'office',
    name: '办公室',
    kind: 'department',
    campusId: 'campus-nanhu',
    enabled: true
  },
  {
    id: 'dept-network',
    code: 'network',
    name: '网络部',
    kind: 'department',
    campusId: 'campus-nanhu',
    enabled: true
  },
  {
    id: 'station',
    code: 'station',
    name: '基础事务站',
    kind: 'station',
    campusId: 'campus-nanhu',
    enabled: true
  },
  { id: 'center', code: 'center', name: '先锋网络中心', kind: 'center', enabled: true }
];

export function membership(assignmentType = 'primary', positionCode = 'member') {
  return {
    id: crypto.randomUUID(),
    departmentId: assignmentType === 'maintenance_affairs' ? 'station' : 'dept-hardware',
    departmentCode: assignmentType === 'maintenance_affairs' ? 'station' : 'hardware',
    departmentName: assignmentType === 'maintenance_affairs' ? '基础事务站' : '硬件部',
    assignmentType,
    positionCode,
    isPrimary: assignmentType === 'primary',
    effectiveFrom: '2026-01-01',
    effectiveTo: '',
    enabled: true,
    revision: 1
  };
}

export function permissionsFor(profile) {
  const management = profile.track === 'leader' || profile.track === 'system';
  const hardware = ['head', 'deputy-head', 'repair', 'exchange'].includes(profile.id);
  const affairs = profile.id === 'affairs';
  return {
    'repair.summary.read': true,
    'repair.receive': hardware || affairs,
    'onsite.create': hardware || affairs,
    'repair.start': hardware,
    'repair.transfer': hardware,
    'repair.finish.own': hardware,
    'repair.correct.own': hardware,
    'repair.correct.any': management,
    'repair.information.edit': hardware || affairs || management,
    'repair.history.read': management,
    'repair.original.read': management,
    'attendance.self': !['retired', 'superadmin'].includes(profile.id),
    'attendance.token.issue': affairs || management,
    'attendance.correct': management,
    'attendance.export': management,
    'roster.manage': management,
    'members.manage': management,
    'accounts.manage': management,
    'statistics.read': management,
    'booking.manage': management,
    'roles.manage': profile.id === 'superadmin',
    'settings.manage': profile.id === 'superadmin',
    'audit.read': profile.id === 'superadmin'
  };
}

export function makeState(profileId = 'head', lessonId = '') {
  const profile = profiles.find((item) => item.id === profileId) || profiles[0];
  const today = dateKey();
  const week = rosterWeekKey(today);
  const permissions = permissionsFor(profile);
  const global = ['director', 'deputy-director', 'president', 'vice-president'].includes(
    profile.id
  );
  const posts = ['retired', 'superadmin'].includes(profile.id)
    ? []
    : [membership(profile.assignment || 'primary', profile.position || 'member')];
  if (global)
    Object.assign(posts[0], {
      departmentId: 'station',
      departmentCode: 'station',
      departmentName: '基础事务站'
    });
  if (profile.department)
    Object.assign(posts[0], {
      departmentId: 'dept-office',
      departmentCode: 'office',
      departmentName: '办公室'
    });
  const person = (memberId, name, index, memberships = [membership()]) => ({
    memberId,
    id: memberId,
    name,
    studentId: `2026${String(index + 1).padStart(4, '0')}`,
    college: '计算机科学与工程学院',
    major: '计算机科学与技术',
    homeCampusId: 'campus-nanhu',
    homeCampus: '南湖',
    status: 'active',
    revision: 1,
    memberships,
    specialIdentities: [],
    identities: memberships.map((post) => ({
      code: post.assignmentType,
      label:
        post.assignmentType === 'maintenance_affairs'
          ? '维修事务'
          : post.assignmentType === 'exchange'
            ? '交流维修'
            : '硬件部部员'
    }))
  });
  const members = [
    person('demo-self', '林知行', 0, posts),
    person('demo-chen', '陈一帆', 1),
    person('demo-zhou', '周宁', 2, [membership('maintenance_affairs')]),
    person('demo-lu', '陆可', 3, [membership('exchange')]),
    person('demo-wen', '温言', 4),
    person('demo-xu', '许星', 5, [membership('primary', 'head')])
  ];
  const actor = {
    ...members[0],
    account: 'tutorial-self',
    role: profile.id === 'superadmin' ? 'superadmin' : 'technician',
    actor: {
      memberId: 'demo-self',
      name: '林知行',
      account: 'tutorial-self',
      authorizedCampuses: profile.campuses
    },
    authorizedCampuses: profile.campuses,
    authVersion: 1,
    permissions,
    specialIdentities: profile.id === 'retired' ? ['retired_elder'] : [],
    navigation: [
      { id: 'workbench' },
      { id: 'members' },
      ...(profile.id === 'superadmin' ? [{ id: 'roles' }] : [])
    ]
  };
  const makeOrder = (suffix, name, brand, deviceModel, status = 'booked') => ({
    id: `0${today.replaceAll('-', '')}-${suffix}`,
    revision: 1,
    campus: '南湖',
    date: today,
    timeSlot: TIME_SLOTS[0],
    createdAt: `${today}T08:00:00+08:00`,
    deviceType: '笔记本',
    brand,
    deviceModel,
    faultType: '系统问题',
    issue: '开机后反复蓝屏，无法进入桌面。',
    warranty: '否',
    liquidMetal: '不清楚',
    dellG15: '否',
    liquidDrop: '否',
    serial: 'PF4DEMO26',
    name,
    studentId: '20269901',
    phone: '13800000000',
    email: 'demo@example.invalid',
    contactType: 'qq',
    contactValue: '10000001',
    college: '计算机科学与工程学院',
    status,
    repairCode: 'DEMO',
    receivedAt: status === 'booked' ? null : `${today}T19:03:00+08:00`,
    receivedBy: 'tutorial-self',
    receivedByName: '林知行',
    assignedMemberId: status !== 'booked' ? 'demo-self' : null,
    assignedTo: status !== 'booked' ? 'tutorial-self' : null,
    assignedToName: status !== 'booked' ? '林知行' : null,
    startedAt: status !== 'booked' ? `${today}T19:05:00+08:00` : null,
    outcome: status === 'completed' ? 'repaired' : '',
    repairNote: status === 'completed' ? '完成驱动修复，开机与网络测试正常。' : '',
    frontPhotoId: status !== 'booked' ? 'sample-front' : null,
    backPhotoId: status !== 'booked' ? 'sample-back' : null,
    original: {
      brand,
      deviceModel,
      warranty: '否',
      liquidMetal: '不清楚',
      college: '计算机科学与工程学院',
      issue: '开机蓝屏',
      note: '机主现场确认外观无损。',
      signature: null,
      agreementVersion: 'v1',
      agreementAt: `${today}T18:50:00+08:00`
    },
    customerHistory: [],
    repairHistory: { items: [], events: [] }
  });
  const orders = [
    makeOrder('01', '李同学', 'Lenovo', 'ThinkBook 14'),
    makeOrder('02', '王同学', 'Dell', 'G15'),
    makeOrder('03', '赵同学', 'ASUS', '天选 4', 'in_progress'),
    makeOrder('04', '刘同学', 'HP', '战 66', 'completed'),
    makeOrder('05', '张同学', 'Lenovo', '小新 Pro', 'in_progress')
  ];
  Object.assign(orders[4], {
    assignedMemberId: 'demo-chen',
    assignedTo: 'demo-chen',
    assignedToName: '陈一帆'
  });
  if (/start-received/.test(lessonId))
    Object.assign(orders[0], {
      receivedAt: `${today}T19:00:00+08:00`,
      frontPhotoId: 'sample-front',
      backPhotoId: 'sample-back'
    });
  if (/deferred/.test(lessonId))
    Object.assign(orders[0], {
      receivedAt: `${today}T19:00:00+08:00`,
      photoDeferredBy: 'tutorial-self'
    });
  const assignment = (id, member, businessDate, dutyType = 'repair') => ({
    id,
    memberId: member.memberId,
    memberName: member.name,
    businessDate,
    dutyType,
    campusId: 'campus-nanhu',
    campusName: '南湖',
    startAt: '19:00',
    endAt: '21:00',
    revision: 1,
    memberships: member.memberships,
    leaveStatus: null,
    status: 'published',
    servicePaused: false
  });
  const assignments = [
    assignment('shift-self', members[0], today, profile.id === 'affairs' ? 'office' : 'repair'),
    assignment('shift-chen', members[1], today),
    assignment('shift-zhou', members[2], today, 'office'),
    assignment('shift-future', members[0], addDays(today, 1))
  ];
  const windows = campuses.flatMap((campus) =>
    Array.from({ length: 7 }, (_, index) => ({
      weekday: index + 1,
      campusId: campus.id,
      startAt: '19:00',
      endAt: '21:00'
    }))
  );
  const capacities = profile.campuses.flatMap((campus) =>
    Array.from({ length: 4 }, (_, index) =>
      TIME_SLOTS.map((timeSlot) => ({
        campus,
        weekday: index + 1,
        timeSlot,
        capacity: 5,
        revision: 1
      }))
    ).flat()
  );
  const accounts = members.slice(0, 4).map((member, index) => ({
    ...member,
    account: index ? member.memberId : actor.account,
    role: 'technician',
    status: 'enabled',
    authorizedCampuses: ['南湖'],
    roleNames: [],
    protected: index === 0,
    actions: { edit: index !== 0, resetPassword: index !== 0, changeStatus: index !== 0 }
  }));
  return {
    profile,
    today,
    week,
    actor,
    members,
    orders,
    assignments,
    windows,
    capacities,
    accounts,
    attendances: [],
    covers: [
      {
        id: 'cover-invite',
        assignmentId: 'shift-chen',
        fromMemberId: 'demo-chen',
        fromMemberName: '陈一帆',
        toMemberId: 'demo-self',
        toMemberName: '林知行',
        businessDate: addDays(today, 2),
        campusId: 'campus-nanhu',
        campusName: '南湖',
        dutyType: 'repair',
        status: 'pending',
        revision: 1,
        startAt: '19:00',
        endAt: '21:00',
        note: '课程冲突，请帮忙接替。'
      }
    ],
    availability: {},
    rosters: {},
    attachments: {},
    logs: [],
    locations: {},
    serviceDays: {},
    reportSettings: {
      revision: 1,
      countMode: 'all',
      hoursPerCount: 2,
      mergeLeaders: true,
      canEdit: profile.id === 'superadmin'
    },
    bookingSettings: { revision: 1, releaseTime: '12:00', campus: '南湖' },
    notices: [
      {
        id: 'notice-demo',
        revision: 1,
        title: '期末维修安排',
        content: '请提前备份重要资料。',
        enabled: true,
        displayMode: 'inline',
        startsAt: `${today}T00:00:00+08:00`,
        endsAt: `${addDays(today, 14)}T23:59:00+08:00`
      }
    ],
    activations: [
      {
        id: 'activation-demo',
        memberId: 'demo-wen',
        name: '温言',
        studentId: '20260005',
        homeCampus: '南湖',
        homeCampusId: 'campus-nanhu',
        status: 'pending',
        account: 'demo-wen',
        requestedAt: `${today}T12:00:00+08:00`,
        authorizedCampuses: ['南湖'],
        revision: 1,
        actions: { approve: true, reject: true, review: true }
      }
    ],
    roles: [
      {
        id: 'system-settings',
        name: '系统配置维护',
        description: '系统配置的额外授权',
        revision: 1,
        enabled: true,
        grants: [{ permissionCode: 'settings.manage', scope: { all: true }, conditions: [] }],
        actions: { edit: true, bind: true }
      }
    ]
  };
}
