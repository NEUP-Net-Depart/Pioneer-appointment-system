import { courses, courseAllowed, track } from './courses.js';
import { profiles, permissionsFor } from './simulation/fixtures.js';

export const tutorialProfiles = [
  { id: 'head', name: '部长' },
  { id: 'repair', name: '部员' },
  { id: 'affairs', name: '维修事务' }
];

const click = (target) => ({ type: 'click', target });
const nav = (view) => ({ type: 'navigate', view });
const page = (view, tab) => [
  { type: 'closeDialogs' },
  nav(view),
  ...(tab ? [click(`text=${tab}`)] : [])
];
const step = (title, description, target, action = null, options = {}) => ({
  title,
  description,
  target,
  action,
  ...options
});
const prompts = {
  办公与维修值班: '核查今日到岗与请假人员',
  人员工作状态: '陆可已签到，当前空闲',
  三个选择: '未保存时可丢弃或保存',
  准备现场签到记录: '核查陈一帆的扫码签到',
  查看已签到人员: '核对陈一帆的签到时间',
  打开来源详情: '查看谁出具了签到码',
  选择人员补录: '为漏签的温言补录签到',
  选择修正时间: '更正温言的签到时间',
  确认统计规则: '核对每次签到计入的时长',
  选择特殊计数: '同一人每周只计首次签到',
  核算预览: '核对实际签到与核算次数',
  预约记录: '按日期查找预约工单',
  查看筛选入口: '按时段或状态筛选工单',
  补充设备资料: '校对设备型号与序列号',
  切换到另一个操作: '切换操作前先处理草稿',
  查看附件列表: '点击附件可下载照片',
  核对原结果: '已结束的工单仍可更正',
  任职历史: '核对任职身份与生效日期',
  账号列表: '查看刚激活成员的账号',
  管理普通账号: '打开刚激活成员的账号',
  每周模板: '按校区与时段设置名额',
  准备周一的示例名额: '把周一各时段设为六人',
  日期实际容量: '查看指定日期的实际名额',
  已占用与剩余: '核对已预约人数与余量',
  查看公告状态: '核对公告是否启用',
  今日安排: '核对本人的校区与班次',
  我的志愿时长: '志愿时长按签到计算',
  核对历史: '核对本人的逐次签到记录',
  选择可到岗的整班: '勾选周日可到岗',
  接受示例邀请: '确认接替陈一帆的班次',
  核对回应结果: '确认新班次已归本人',
  输入关键词: '输入机主姓名查找预约',
  下载示例照片: '点击文件名下载照片'
};
const phase = (name, steps) =>
  steps.map((item) => ({ ...item, title: prompts[item.title] || item.title, phase: name }));

const lessonUnits = {
  'edit-information': [
    ['现场发现差异，可校对原填资料', [0]],
    ['校对后保存到当前工单', [1, 2]]
  ],
  unsaved: [
    ['切换操作会提醒处理未保存内容', [0, 1]],
    ['未保存时可取消、丢弃或保存', [2, 3]]
  ],
  supplement: [
    ['维修过程照片用补充照片留档', [0]],
    ['上传后可从附件列表下载', [1, 2, 3]]
  ],
  finish: [
    ['记录处理与验证结果，再完结', [0, 1, 2]],
    ['结束后核对实际处理结果', [3]]
  ],
  'correct-result': [['已结束的工单仍可更正结果', [0, 1, 2]]],
  credential: [
    ['机主丢失链接时，先核验再补发', [0, 1, 2]],
    ['复制新链接，确认交付机主', [3, 4]]
  ],
  original: [
    ['原始登记保留校对前的资料', [0]],
    ['核对原填资料与协议', [1]]
  ],
  'repair-history': [
    ['维修与交接记录可追溯责任', [0]],
    ['核对接收、主修与操作时间', [1]]
  ],
  'attendance-source': [
    ['打开陈一帆的签到来源', [0, 2]],
    ['扫码签到会保留出码人', [1], 'dialog[open] > .workspace-dialog-body']
  ],
  'attendance-correction': [['为漏签的温言补录签到', [0, 1, 2]]],
  'attendance-time': [['已签到可更正实际到场时间', [0, 1, 2]]],
  'attendance-history': [
    ['按人员查考勤，展开逐日记录', [0, 1, 2]],
    ['导出沿用当前月份与筛选', [3]]
  ],
  volunteer: [
    ['核对签到计时规则与报表范围', [0, 1]],
    ['按周、校区生成志愿登记表', [2]]
  ],
  'weekly-export': [
    ['周核算可选择仅计首次签到', [0]],
    ['核对实际次数与核算次数', [1, 2]],
    ['导出核对后的周考勤', [3]]
  ],
  'member-create': [
    ['先建人员档案，再开通账号', [0]],
    ['建立新成员的人员档案', [1, 2]]
  ],
  membership: [
    ['任职身份决定业务权限', [0, 1]],
    ['独立身份可单独添加', [2, 3]]
  ],
  'member-history': [['人员变更可查看操作历史', [0, 1]]],
  'activation-review': [
    ['核验本人身份后批准激活', [0, 1, 2]],
    ['确认同一成员已激活', [3]]
  ],
  accounts: [['打开刚激活成员的账号', [0, 1]]],
  'reset-password': [['忘记密码时可重置成员账号', [0, 1, 2]]],
  availability: [
    ['通常空闲与单周例外分开保存', [0]],
    ['勾选可到岗整班，保存通常空闲', [1, 2]],
    ['单周例外只覆盖选定工作周', [3, 4]]
  ],
  planner: [
    ['按校区与工作周生成排班建议', [0, 1]],
    ['建议只是草稿，核对后再发布', [2, 3]]
  ],
  'manual-roster': [
    ['可在建议之外手动调整人员', [0, 1]],
    ['核对冲突后发布调整', [2, 3]]
  ],
  capacity: [
    ['每周模板决定各时段默认名额', [0, 1]],
    ['核对受影响时段后保存', [2, 3]]
  ],
  'capacity-copy-day': [
    ['可把一天的名额复制到其他天', [0, 1]],
    ['复制只改草稿，保存后生效', [2]]
  ],
  'actual-capacity': [['实际名额同时考虑占用与暂停', [0, 1, 2]]],
  'service-location': [
    ['地点变更前核对校区与日期', [0, 1]],
    ['变更后需核对受影响预约', [2, 3]]
  ],
  'service-days': [
    ['临时暂停需说明原因并核对预约', [0, 1, 2]],
    ['暂停服务会保留已有预约', [3]]
  ],
  'restore-service': [['暂停日期可恢复正常预约', [1, 2]]],
  'release-time': [['放号时间按当前校区保存', [0, 1, 2]]],
  notice: [
    ['公告按校区与有效期展示', [0]],
    ['保存后核对公告展示状态', [1, 2, 3]]
  ],
  'notice-edit': [['停用公告会保留内容供再次启用', [0, 1, 2]]],
  'my-shifts': [['我的值班可查班次与签到历史', [0, 1, 2, 3]]],
  leave: [
    ['请假不代表已有同事接替', [0, 1, 2]],
    ['恢复可到岗时可撤回请假', [3]]
  ],
  cover: [['邀请接替需等待对方确认', [0, 1, 2]]],
  'cancel-cover': [['未接受的接替邀请可以撤回', [1, 2]]],
  'cover-response': [
    ['核对班次后再确认接替', [0, 1]],
    ['接受后核对本人的新增班次', [2]]
  ],
  lookup: [
    ['没有维修码时，可搜索机主资料', [0]],
    ['查到预约后仍需当面核对设备', [1, 2, 3]]
  ],
  onsite: [
    ['无预约的设备从现场登记开始', [0]],
    ['登记内容与预约表一致', [1, 2]],
    ['协议与签名必须由机主本人确认', [3, 4]]
  ],
  attachments: [
    ['接收原图与补充照片都在附件中', [0]],
    ['点击文件名可下载照片', [1]]
  ]
};

function lessons(name, ids, profile, { currentOrder = false, omit = {} } = {}) {
  return ids.flatMap((id) => {
    const course = courses.find((item) => item.id === id);
    if (!course || !courseAllowed(course, profile, permissionsFor(profile))) return [];
    const source = course.steps.map((item) => ({ ...item }));
    if (id === 'staffing') source[1].target = '[data-member-id="demo-lu"]';
    if (id === 'attendance-source') {
      source[2].action = [
        click(`[data-member-id="demo-chen"] ${track('staff.attendancemanagement.checkin-detail')}`)
      ];
    }
    if (id === 'attendance-correction' || id === 'attendance-time') {
      source[0].target = `[data-member-id="demo-wen"] ${track('staff.attendancemanagement.button.3')}`;
      source[0].action = [click(source[0].target)];
    }
    if (id === 'availability') {
      source[1].action = [{ type: 'check', target: track('staff.schedule.input.6') }];
      source[3].action = [
        ...source[3].action,
        { type: 'check', target: '.duty-availability > div:first-child label:nth-of-type(2) input' }
      ];
    }
    const selected = lessonUnits[id]
      ? lessonUnits[id]
          .map(([title, indices, target]) => {
            const included = indices
              .filter((index) => !(omit[id] || []).includes(index))
              .map((index) => source[index])
              .filter(Boolean);
            if (!included.length) return null;
            return {
              ...included[0],
              title,
              target: target || included[0].target,
              action: included.flatMap((item) => item.action || []),
              expect: included.filter((item) => item.action?.length).at(-1)?.expect
            };
          })
          .filter(Boolean)
      : source.filter((item, index) => !(omit[id] || []).includes(index));
    return phase(
      name,
      selected.map((item, index) => ({
        ...item,
        teaches: index ? [] : [id],
        before: index
          ? []
          : currentOrder && course.prepare.some((action) => action.type === 'order')
            ? [{ type: 'currentOrder' }]
            : [{ type: 'closeDialogs' }, ...course.prepare],
        target:
          item.target === 'dialog[open]'
            ? 'dialog[open] > :not(header):not(.driver-layer)'
            : item.target
      }))
    );
  });
}

function arrival(profile) {
  const scanner = profile.id === 'repair';
  return phase('到岗签到', [
    step(
      '先核对今日校区与班次',
      '先核对工作校区与日期。到岗签到记录人员出勤，接收工单则记录设备，两种扫码接下来会分别展示。',
      '.today-work-window',
      null,
      { teaches: ['arrival-context'] }
    ),
    ...(scanner
      ? [
          step(
            '打开扫码，准备到岗签到',
            '向维修事务或负责人出示的签到二维码扫码。这里使用同一扫码窗口，先展示工作人员签到。',
            track('staff.field.todayscene.button.2'),
            [click(track('staff.field.todayscene.button.2'))],
            { expect: { target: '.field-scanner' }, teaches: ['self-attendance'] }
          ),
          step(
            '识别现场签到二维码',
            '实际到站时用摄像头对准签到码；也可以从相册识别。教程通过相册载入示例码，识别后先显示签到确认。',
            '.field-scanner',
            [{ type: 'attendanceImage' }],
            { expect: { target: track('staff.field.fieldapp.button.5') } }
          ),
          step(
            '核对校区与本人，再签到',
            '现在还没有产生签到记录。核对校区、日期、有效时段和姓名，确认无误后才提交签到。',
            track('staff.field.fieldapp.button.5'),
            [click(track('staff.field.fieldapp.button.5'))],
            { expect: { request: '/api/attendance/check-ins' } }
          )
        ]
      : [
          step(
            '完成本人的到岗签到',
            '部长和维修事务可以直接签到。先记下本人到岗，再为其他值班人员展示签到码。',
            track('staff.field.todayworkwindow.attendance'),
            [click(track('staff.field.todayworkwindow.attendance'))],
            { expect: { request: '/api/attendance/self-check-in' }, teaches: ['self-attendance'] }
          )
        ]),
    step(
      '签到成功，返回工作台',
      '这里显示本次签到的校区、日期和时间。重复签到保留首次记录；确认成功后返回工作台，继续当天工作。',
      '.field-checkin-result',
      [click(track('staff.field.fieldapp.button.4'))],
      { expect: { target: '.today-work-window' } }
    ),
    step(
      '确认工作台显示已签到',
      scanner
        ? '工作台已经显示“已签到”。人员签到完成后，下一件事是查看预约，再扫描机主的维修码接收设备。'
        : '本人签到已完成。接下来展示工作人员签到码，再核查今日值班人员。',
      '.today-work-window'
    )
  ]);
}

function showAttendanceCode() {
  return phase('展示签到码', [
    step(
      '出示签到码，让同事签到',
      '把这个二维码展示给当天到站的同事。它用于人员签到，不是机主的设备维修码。',
      track('staff.field.todayworkwindow.attendance'),
      [click(track('staff.field.todayworkwindow.attendance'))],
      { expect: { request: '/token' }, teaches: ['issue-token'] }
    ),
    step(
      '留意校区与二维码有效期',
      '同事扫码后还要确认本人签到。这里可以更新自己的签到码；刷新不会替换其他出码人的码。看完后返回工作台核查人员。',
      '.field-credential--attendance',
      [{ type: 'closeTopDialog' }]
    )
  ]);
}

function scanAppointment() {
  return phase('扫描机主维修码', [
    step(
      '打开扫码，接待李同学',
      '已经核对了预约列表。现在李同学来到现场，打开“扫码”，扫描机主查询页上的维修码。没有二维码时才用姓名、设备或联系方式查询。',
      track('staff.field.todayscene.button.2'),
      [click(track('staff.field.todayscene.button.2'))],
      { before: page('scene:today'), expect: { target: '.field-scanner' }, teaches: ['scan-order'] }
    ),
    step(
      '扫描机主维修码打开工单',
      '这次识别的是设备工单，不会再次给人员签到。教程载入李同学的示例维修码，并打开同一台电脑的工单。',
      '.field-scanner',
      [{ type: 'scanOrder' }],
      { expect: { request: '/api/scan/resolve' } }
    ),
    step(
      '当面核对机主、设备与故障',
      '核对姓名、联系方式、型号和故障描述。此时设备尚未接收，后面还需要确认现场资料并拍摄正反面照片。',
      '.repair-summary'
    )
  ]);
}

function warranty() {
  return phase('确认保修与处理范围', [
    step(
      '维修前先查原厂保修',
      '拆机或维修前，先确认保修、液金散热、进液等情况。需要官方处理的设备，应先向机主说明。',
      track('staff.field.warrantylookup.button.1'),
      [click(track('staff.field.warrantylookup.button.1'))],
      { expect: { target: '.warranty-lookup' }, teaches: ['warranty'] }
    ),
    step(
      '按品牌与机身序列号查询',
      '选择实际品牌，录入序列号。标签难读时，可用旁边的照片识别，再核对识别候选，不能直接把候选当成已确认的资料。',
      '.warranty-lookup',
      [{ type: 'warrantyFill' }, click(track('staff.field.warrantylookup.button.12'))],
      { expect: { request: '/api/warranty/query' } }
    ),
    step(
      '核对保修结果后返回工单',
      '有保修或不适合现场处理时，可使用官方支持中的售后网点入口。示例中已与机主确认，继续现场处理这台设备。',
      '.warranty-result',
      [{ type: 'closeTopDialog' }]
    )
  ]);
}

function photosAndReceive(start) {
  return phase('设备接收', [
    step(
      '接收前保留设备正反面原图',
      '先保留接收时的外观照片。这里使用统一的照片控件，选择图片后会显示预览。',
      '.repair-intake',
      [
        { type: 'upload', side: 'front' },
        { type: 'upload', side: 'back' }
      ],
      { expect: { photos: true }, teaches: ['intake-photos'] }
    ),
    step(
      start ? '设备到手，接收并开始维修' : '仅接收设备，交给维修同事',
      start
        ? '本次由你直接处理，所以选择“接收并开始维修”。如果设备已由接待人员接收，只会显示“开始维修”；仅接收不会把接待人设为主修。'
        : '维修事务选择“仅接收设备”，留下接收人和原图，等待有维修资格的同事接手，不会成为主修。',
      track(start ? 'staff.field.repair.button.5' : 'staff.field.repair.button.6'),
      [click(track(start ? 'staff.field.repair.button.5' : 'staff.field.repair.button.6'))],
      {
        expect: { request: start ? '/status' : '/receive' },
        teaches: [start ? 'receive-start' : 'receive']
      }
    ),
    step(
      start ? '确认本人主修与开始时间' : '确认已接收，等待维修',
      start
        ? '工单已进入维修中，并记录你的主修责任和开始时间。实际排查完成后，还要留下处理和验证结果。'
        : '现在可以把这台设备交给维修同事。他会从“已接收待维修”开始维修；接待与维修的责任分别记录。',
      '.repair-summary'
    )
  ]);
}

function repair(profile) {
  return [
    ...recordOverview(),
    ...scanAppointment(),
    ...warranty(),
    ...lessons('现场资料校对', ['edit-information', 'unsaved'], profile, { currentOrder: true }),
    ...phase('现场资料校对', [
      step(
        '资料已保存，返回设备接收',
        '刚才切换到了补充照片。设备还未接收，先返回上方拍摄正反面；维修过程照片稍后再补。',
        '.repair-attachment-upload',
        [click(track('staff.repairattachments.cancel'))]
      )
    ]),
    ...photosAndReceive(true),
    ...lessons('维修过程留档', ['supplement'], profile, { currentOrder: true }),
    ...lessons('处理结果与完结', ['finish', 'correct-result'], profile, { currentOrder: true }),
    ...lessons('交付机主与查询', ['credential'], profile, { currentOrder: true }),
    ...(profile.id === 'head'
      ? lessons('追溯原登记与责任', ['original', 'repair-history'], profile, { currentOrder: true })
      : []),
    ...phase('回到当天工作', [
      step(
        '交还设备，回到今日工作',
        '向机主说明处理和验证结果，再交还设备。回到今日工作查看剩余工单；其他人的维修不能直接标为自己的已完成。',
        '.repair-summary',
        page('scene:today'),
        { before: profile.id === 'head' ? [{ type: 'closeTopDialog' }] : [] }
      )
    ])
  ];
}

function recordOverview() {
  return phase('预约概览与筛选', [
    step(
      '切换概览日期，查看当天预约',
      '按日期查看预约概览。',
      '.records-periods',
      [click(`${track('staff.records.button.25')}:nth-child(2)`)],
      { before: page('staff'), teaches: ['records-overview'] }
    ),
    step('点概览状态，可直达对应工单', '时段和处理状态会同步筛选列表。', '.records-campus', [
      click(track('staff.records.button.28'))
    ]),
    step('搜索会暂时放开原有筛选', '输入关键词搜索。', '.records-toolbar', [
      { type: 'fill', target: track('staff.records.input.4'), value: 'ThinkBook' }
    ]),
    step('清空搜索，会恢复原筛选', '清空搜索返回原来的日期和状态。', '.records-active-filters', [
      { type: 'fill', target: track('staff.records.input.4'), value: '' }
    ])
  ]);
}

function attendance(profile) {
  return [
    ...arrival(profile),
    ...showAttendanceCode(),
    ...lessons('核查今日人员', ['staffing'], profile),
    ...phase('核查今日人员', [
      step('陈一帆正在维修两台设备', '维修中来自正在处理的工单。', '[data-member-id="demo-chen"]')
    ]),
    ...phase('查看工作量', [
      step(
        '接单量不计入志愿时长',
        '人员行同时展示工作状态、本月接单和累计接单。它们用于分派维修；志愿时长按考勤计算，不能拿接单数量代替签到。',
        '.duty-workload',
        null,
        { teaches: ['workload'] }
      )
    ]),
    ...(profile.id === 'head'
      ? [
          ...lessons('核对签到来源', ['attendance-source'], profile),
          ...lessons('处理漏签与时间更正', ['attendance-correction', 'attendance-time'], profile),
          ...lessons(
            '考勤历史与核算',
            ['attendance-history', 'volunteer', 'weekly-export'],
            profile
          )
        ]
      : [])
  ];
}

function configuration(profile) {
  return [
    ...lessons('成员与任职', ['member-create', 'membership', 'member-history'], profile),
    ...phase('激活与账号', [
      step(
        '新成员已提交激活申请',
        '现在模拟刚建档的新成员提交了本人激活申请。负责人核实身份后，才能批准同一人的账号。',
        '.accounts-workspace',
        null,
        {
          before: [
            { type: 'closeDialogs' },
            { type: 'simulateApplication' },
            nav('members'),
            click('text=激活与账号')
          ]
        }
      )
    ]),
    ...lessons('激活与账号', ['activation-review', 'accounts', 'reset-password'], profile, {
      omit: { accounts: [2, 3] }
    }),
    ...lessons('收集空闲与编排班表', ['availability', 'planner', 'manual-roster'], profile),
    ...lessons('预约名额配置', ['capacity', 'capacity-copy-day', 'actual-capacity'], profile),
    ...lessons(
      '地点与临时服务安排',
      ['service-location', 'service-days', 'restore-service'],
      profile,
      { omit: { 'restore-service': [0] } }
    ),
    ...lessons('放号与公告', ['release-time', 'notice', 'notice-edit'], profile)
  ];
}

function reception(profile) {
  return [
    ...lessons('查询预约', ['lookup'], profile),
    ...scanAppointment(),
    ...lessons('核对现场资料', ['edit-information'], profile, { currentOrder: true }),
    ...photosAndReceive(false),
    ...lessons('设备记录与查询凭证', ['attachments', 'credential'], profile, {
      currentOrder: true
    }),
    ...phase('没有预约的下一位机主', [
      step(
        '下一位没预约，现场登记',
        '这时从今日工作进入“现场登记”，由机主核对资料、阅读协议并本人签名。不能借用李同学的工单登记另一台设备。',
        '.repair-summary',
        page('scene:today')
      )
    ]),
    ...lessons('现场登记与机主签名', ['onsite'], profile),
    ...phase('接收刚登记的新设备', [
      step(
        '为刚登记的新设备拍照接收',
        '下面操作的是刚才登记的新工单。签名和登记已经保留，仍需要拍照接收才能交给维修同事。',
        '.repair-summary',
        null,
        { before: [{ type: 'currentOrder' }] }
      )
    ]),
    ...photosAndReceive(false).map((item) => ({
      ...item,
      phase: '接收刚登记的新设备',
      teaches: []
    })),
    ...phase('完成接待交接', [
      step(
        '核对两台设备的交接状态',
        '已经预约的设备和现场登记的设备分别保留独立工单。交给维修同事后，回到今日工作继续接待下一位机主。',
        '.repair-summary',
        page('scene:today')
      )
    ])
  ];
}

export function journeysFor(profile) {
  const actor = profiles.find((item) => item.id === profile.id) || profiles[0];
  const flow = (id, title, description, steps) => ({
    id,
    title,
    description,
    prepare: page('scene:today'),
    steps
  });
  if (actor.id === 'head')
    return [
      flow(
        'attendance',
        '考勤与值班核查',
        '到岗出码 → 核查签到与工作量 → 考勤记录与核算',
        attendance(actor)
      ),
      flow('repairs', '预约与设备维修', '预约与扫码 → 保修与接收 → 维修完结与交付', repair(actor)),
      flow(
        'configuration',
        '值班与业务配置',
        '成员账号 → 下周排班 → 名额、地点与公告',
        configuration(actor)
      )
    ];
  if (actor.id === 'affairs')
    return [
      flow(
        'attendance',
        '到岗出码与人员协调',
        '本人签到 → 展示签到码 → 查看今日人员与工作量',
        attendance(actor)
      ),
      flow(
        'reception',
        '接待与设备交接',
        '预约与扫码 → 设备接收 → 现场登记与交接',
        reception(actor)
      )
    ];
  return [
    flow('duty-repair', '到岗与完整维修', '扫码签到 → 预约接单 → 维修完结与个人记录', [
      ...arrival(actor),
      ...repair(actor),
      ...lessons('本人值班与签到记录', ['my-shifts'], actor)
    ]),
    flow('shift-change', '值班安排与变动', '空闲填报 → 请假与撤回 → 接替邀请与回应', [
      ...lessons('空闲填报', ['availability'], actor),
      ...lessons('班次请假与恢复', ['leave'], actor),
      ...lessons('邀请与撤回接替', ['cover', 'cancel-cover'], actor, {
        omit: { 'cancel-cover': [0] }
      }),
      ...lessons('回应接替邀请', ['cover-response'], actor)
    ])
  ];
}
