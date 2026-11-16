import { rosterParticipantFor } from './simulation/fixtures.js';

export const groups = [
  { id: 'start', name: '开始工作', subtitle: '先熟悉你的工作区' },
  { id: 'intake', name: '接待与设备接收', subtitle: '从找到预约到接收设备' },
  { id: 'repair', name: '维修与交接', subtitle: '完整走通一张维修工单' },
  { id: 'information', name: '工单资料与支持', subtitle: '资料、照片和查询凭证' },
  { id: 'mine', name: '我的值班', subtitle: '签到、空闲、请假与接替' },
  { id: 'duty', name: '排班与考勤管理', subtitle: '从安排班表到核对出勤' },
  { id: 'people', name: '人员与账号', subtitle: '成员入站、任职与账号管理' },
  { id: 'booking', name: '预约与业务配置', subtitle: '容量、地点、公告与放号' },
  { id: 'system', name: '系统专属操作', subtitle: '系统管理员的额外权限' }
];

export const track = (name) => `[data-track="${name}"]`;
const text = (name) => `text=${name}`;
const label = (name) => `label=${name}`;
const click = (target) => ({ type: 'click', target });
const fill = (target, value) => ({ type: 'fill', target, value });
const choose = (target, value) => ({ type: 'choose', target, value });
const nav = (view) => ({ type: 'navigate', view });
const tab = (name) => click(text(name));
const open = (index = 0) => ({ type: 'order', index });
const inspect = (title, description, target) => ({ title, description, target, action: null });
const act = (title, description, target, action, expect) => ({
  title,
  description,
  target,
  action: Array.isArray(action) ? action : [action],
  expect
});
const lesson = (id, group, title, summary, permission, prepare, steps) => ({
  id,
  group,
  title,
  summary,
  permission,
  prepare,
  steps,
  minutes: Math.max(2, Math.ceil(steps.length * 0.55))
});
const repairPrepare = (index = 0) => [nav('scene:today'), open(index)];
const dutyPrepare = (tabName) => [nav('duties'), tab(tabName)];
const peoplePrepare = (...tabs) => [nav('members'), ...tabs.map(tab)];
const info = track('staff.repairdetails.summary.2');
const upload = (side) => ({ type: 'upload', side });
const photos = act(
  '准备设备照片',
  '分别添加设备正面和背面照片。可以拖入，也可以点击选择。',
  '.repair-intake',
  [upload('front'), upload('back')],
  { photos: true }
);
const saveInfo = act(
  '保存校对结果',
  '保存后回到工单，后续接收会使用刚刚校对的资料。',
  track('staff.repairdetails.button.5'),
  click(track('staff.repairdetails.button.5')),
  { request: '/information' }
);
const myDuty = dutyPrepare('我的值班');
const accounts = (...tabs) => peoplePrepare('激活与账号', ...tabs);

export const courses = [
  lesson(
    'workspace',
    'start',
    '认识你的工作区',
    '入口、任务和身份范围',
    null,
    [nav('scene:today')],
    [
      inspect('今日工作', '当天待接单、已接收和维修中的设备集中在这里。', '.today-work-window'),
      inspect(
        '待接单与维修中',
        '打开任意工单查看详情；具体操作取决于你的实际任职。',
        '.today-orders'
      ),
      act(
        '查找功能',
        '使用功能搜索快速到达任务，也支持 Ctrl / ⌘ K。',
        '.workspace-find',
        click('.workspace-find'),
        { target: '.workspace-launcher' }
      ),
      inspect(
        '按任务导航',
        '现场工作、排班考勤、人员权限、业务设置和个人任务分别组织。',
        'dialog[open]'
      )
    ]
  ),
  lesson(
    'campus',
    'start',
    '在授权校区间工作',
    '各任务独立选择校区',
    'global',
    [nav('scene:today')],
    [
      inspect(
        '当前工作校区',
        '站长及主席（含副职）可管理两个校区；部长仅管理所属授权校区。',
        '.today-work-window'
      ),
      act(
        '切换工作校区',
        '这里只切换今日工作，不会更改人员资料或其他任务范围。',
        track('staff.field.todayworkwindow.campus'),
        { type: 'campus' }
      ),
      inspect(
        '查看对应工单',
        '列表随任务校区更新。其他管理任务仍使用各自选择的校区。',
        '.today-orders'
      )
    ]
  ),
  lesson(
    'lookup',
    'start',
    '查找预约与打开工单',
    '按编号、设备、姓名或完整联系方式定位',
    null,
    [nav('scene:today')],
    [
      act('打开搜索', '先打开预约搜索。', track('staff.field.todayscene.search.open'), {
        type: 'searchOpen'
      }),
      act(
        '输入关键词',
        '输入示例机主姓名，系统会在当前授权范围内查找。',
        track('staff.field.appointmentlookup.input.2'),
        fill(track('staff.field.appointmentlookup.input.2'), '李同学'),
        { target: '[role="option"]' }
      ),
      act(
        '选择对应预约',
        '核对日期和状态后打开工单。',
        '[role="option"]',
        click('[role="option"]'),
        { target: '.repair-order-dialog' }
      ),
      inspect('核对工单', '确认编号、设备与故障，再选择接收或维修操作。', '.repair-summary')
    ]
  ),
  lesson(
    'records',
    'start',
    '预约记录筛选与排序',
    '搜索、日期、校区、状态与排序',
    null,
    [nav('staff')],
    [
      inspect('预约记录', '使用顶部日期概览和列表筛选定位工单。', '.records-workspace'),
      act(
        '搜索设备',
        '关键词搜索会暂时放开原有浏览范围；清空后恢复。',
        'input[type="search"]',
        fill('input[type="search"]', 'ThinkBook')
      ),
      act('查看筛选入口', '可以进一步按时间段、状态或校区过滤。', '.records-workspace', {
        type: 'recordFilter'
      }),
      inspect('打开记录', '列表记录与今日工作的工单详情共用同一套操作。', '.records-workspace')
    ]
  ),
  lesson(
    'records-export',
    'start',
    '导出预约记录',
    '从更多操作导出演示 CSV',
    'members.manage',
    [nav('staff')],
    [
      act('打开更多操作', '导出入口在记录页面的更多操作中。', '.records-workspace', {
        type: 'more'
      }),
      act(
        '下载预约数据',
        '下载仅包含本地示例数据，文件会标注演示用途。',
        'text=导出',
        { type: 'clickText', value: '导出' },
        { download: true }
      ),
      inspect('完成导出', '正式系统会按当前权限返回数据。', '.records-workspace')
    ]
  ),
  lesson(
    'receive',
    'intake',
    '只接收设备，交给维修人员',
    '维修事务的标准接待流程',
    'repair.receive',
    repairPrepare(),
    [
      inspect('核对机主与设备', '确认是面前这台设备，再准备接收照片。', '.repair-summary'),
      photos,
      act(
        '仅接收设备',
        '设备进入已接收状态，尚未开始维修，也不会把接待人员设为主修。',
        track('staff.field.repair.button.6'),
        click(track('staff.field.repair.button.6')),
        { request: '/receive' }
      ),
      inspect(
        '确认接收结果',
        '工单记录接收人；有维修任职的人员可以接着开始维修。',
        '.repair-summary'
      )
    ]
  ),
  lesson(
    'receive-start',
    'intake',
    '接收并开始维修',
    '一次操作完成接收与成为主修',
    'repair.start',
    repairPrepare(),
    [
      inspect('确认待接单设备', '当前工单尚未接收，先核对设备和故障。', '.repair-summary'),
      photos,
      act(
        '接收并开始维修',
        '确认后你成为当前主修，工单状态变为维修中。',
        track('staff.field.repair.button.5'),
        click(track('staff.field.repair.button.5')),
        { request: '/status' }
      ),
      inspect('查看维修操作', '选定处理结果并填写说明后，才能结束本次服务。', '.field-results')
    ]
  ),
  lesson(
    'onsite',
    'intake',
    '没有预约的现场登记',
    '登记信息、协议确认与手写签名',
    'onsite.create',
    [nav('scene:today')],
    [
      act(
        '打开现场登记',
        '为没有预约的机主创建现场工单。',
        track('staff.field.todayscene.button.3'),
        click(track('staff.field.todayscene.button.3')),
        { target: track('staff.field.registration.form.1') }
      ),
      act(
        '填写机主与设备',
        '按实际情况填写，设备条件项与预约表保持一致。',
        track('staff.field.registration.form.1'),
        { type: 'registration' }
      ),
      act(
        '进入机主确认',
        '核对设备和故障，再交由机主阅读协议。',
        track('staff.field.registration.button.5'),
        click(track('staff.field.registration.button.5')),
        { target: track('staff.field.registration.form.6') }
      ),
      act(
        '确认协议并签名',
        '演示笔迹仅用于练习；正式工作必须由机主本人签名。',
        '.field-signature',
        [
          { type: 'check', target: track('staff.field.registration.input.7') },
          { type: 'signature' }
        ],
        { signature: true }
      ),
      act(
        '确认登记',
        '创建工单后仍需按设备接收流程上传照片并接收。',
        track('staff.field.registration.button.10'),
        click(track('staff.field.registration.button.10')),
        { request: '/api/scan/onsite' }
      )
    ]
  ),
  lesson(
    'photos',
    'intake',
    '选择、替换与预览照片',
    '熟悉统一照片控件',
    'repair.receive',
    repairPrepare(),
    [
      act(
        '添加设备正面',
        '支持拖拽和点击选择，取消文件选择不会关闭工单。',
        '.field-intake-photo',
        upload('front'),
        { target: '.field-photo-preview' }
      ),
      act(
        '查看照片',
        '点击预览核对清晰度及设备外观。',
        '.field-photo-preview',
        click('.field-photo-preview'),
        { target: '.field-photo-expanded' }
      ),
      act('返回并替换', '关闭预览后可以重新选择，正式接收前请核对正反面。', 'dialog[open]', {
        type: 'replacePhoto'
      })
    ]
  ),
  lesson(
    'deferred-photos',
    'intake',
    '补传首次接收照片',
    '恢复尚未传完的接收原图',
    'repair.receive',
    repairPrepare(),
    [
      inspect('识别待传照片', '这台设备已经接收，首次接收照片尚未传完。', '.repair-order-dialog'),
      act(
        '选择接收原图',
        '使用首次接收时保留的正反面原图。',
        '.field-intake-photo',
        [upload('front'), upload('back')],
        { photos: true }
      ),
      act(
        '重试补传',
        '照片关联到当前工单，已有接收记录保持不变。',
        track('staff.field.repair.button.9'),
        click(track('staff.field.repair.button.9')),
        { request: '/photos' }
      )
    ]
  ),
  lesson(
    'start-received',
    'repair',
    '为已接收设备开始维修',
    '接待与维修分开完成',
    'repair.start',
    repairPrepare(),
    [
      inspect('确认接收记录', '设备已经接收，核对接收人与外观照片后接手。', '.repair-summary'),
      act(
        '开始维修',
        '点击后成为当前主修，并记录开始时间。',
        track('staff.field.repair.button.5'),
        click(track('staff.field.repair.button.5')),
        { request: '/status' }
      ),
      inspect('进入维修中', '维修责任与处理结果记录在当前工单中。', '.field-results')
    ]
  ),
  lesson(
    'finish',
    'repair',
    '填写结果并结束服务',
    '已解决、部分解决、未解决或无需维修',
    'repair.start',
    repairPrepare(2),
    [
      inspect(
        '选择实际处理结果',
        '处理结果描述本次服务，部分解决或未解决时需说明剩余问题。',
        '.field-results'
      ),
      act('填写结果与说明', '示例选择已解决，并记录所做处理和验证。', '.field-results', [
        { type: 'check', target: 'input[name="outcome"]' },
        fill(track('staff.field.repair.textarea.14'), '修复系统驱动，连续开机与网络测试通过。')
      ]),
      act(
        '结束本次服务',
        '保存后工单进入服务已结束状态。',
        track('staff.field.repair.button.15'),
        click(track('staff.field.repair.button.15')),
        { request: '/status' }
      ),
      inspect('核对结果', '结束后仍可查看结果；具备相应权限时可更正。', '.repair-summary')
    ]
  ),
  lesson(
    'handoff',
    'repair',
    '实际接手其他人的维修',
    '确认设备到手后转移主修责任',
    'repair.transfer',
    repairPrepare(4),
    [
      inspect('查看当前主修', '示例工单由陈一帆负责。接手前请先完成线下交接。', '.repair-summary'),
      act(
        '确认设备已到手',
        '只有确认实际接到设备后，才能成为新的主修。',
        track('staff.field.repair.input.10'),
        { type: 'check', target: track('staff.field.repair.input.10') }
      ),
      act(
        '确认接手',
        '操作会变更当前主修，并保留既有维修与交接事实。',
        track('staff.field.repair.button.11'),
        click(track('staff.field.repair.button.11')),
        { request: '/transfer' }
      ),
      inspect('继续维修', '接手成功后可以填写结果并结束服务。', '.field-results')
    ]
  ),
  lesson(
    'correct-result',
    'repair',
    '更正已结束工单的结果',
    '补全或修正原处理结论',
    'correct',
    repairPrepare(3),
    [
      inspect('核对原结果', '原主修可更正自己的结果；负责人可在管理范围内代改。', '.field-results'),
      act(
        '修改处理说明',
        '结果更正会保留操作记录，不会重开维修计时。',
        track('staff.field.repair.textarea.14'),
        fill(
          track('staff.field.repair.textarea.14'),
          '补充验证：重启三次、无线网络及睡眠唤醒均正常。'
        )
      ),
      act(
        '保存结果更正',
        '提交后核对新的说明。',
        track('staff.field.repair.button.15'),
        click(track('staff.field.repair.button.15')),
        { request: '/correction' }
      )
    ]
  ),
  lesson(
    'return-repair',
    'repair',
    '返修与维修关联',
    '新建关联登记或关联已有工单',
    'onsite.create',
    repairPrepare(3),
    [
      inspect('维修历史与关联', '返修创建新工单，保留原维修结果。', '.repair-relations'),
      act(
        '选择返修登记',
        '从原工单发起，沿用机主和设备资料后再次核对。',
        track('staff.repairrelations.input.6'),
        [
          { type: 'check', target: track('staff.repairrelations.input.6') },
          click(track('staff.repairrelations.button.9'))
        ],
        { target: track('staff.field.registration.form.1') }
      ),
      inspect(
        '重新确认资料',
        '核对本次故障后，继续协议签名和设备接收。',
        track('staff.field.registration.form.1')
      )
    ]
  ),
  lesson(
    'link-repair',
    'repair',
    '关联已有维修工单',
    '表达同设备故障与返修关系',
    'repair.information.edit',
    repairPrepare(3),
    [
      inspect(
        '已有工单的关联',
        '已有另一张工单时可以关联，无需再重复登记。',
        track('staff.repairrelations.input.7')
      ),
      inspect(
        '选择关系与工单',
        '选择已有工单及关系类型，按页面要求确认设备与故障关系。',
        '.repair-relations'
      ),
      act(
        '填写关联并保存',
        '示例关联另一张设备工单；实际工作须核对一致性。',
        '.repair-relations',
        { type: 'link' },
        { request: '/link' }
      )
    ]
  ),
  lesson(
    'edit-information',
    'information',
    '校对与补充工单资料',
    '设备、机主、保修与现场补充',
    'repair.information.edit',
    repairPrepare(),
    [
      act('打开资料编辑', '资料按照设备与故障、机主与联系方式、现场补充分组。', info, click(info), {
        target: track('staff.repairdetails.form.3')
      }),
      act(
        '补充设备资料',
        '示例修改型号和序列号。学号、签名和协议证据保持只读。',
        track('staff.repairdetails.form.3'),
        [fill(label('设备型号'), 'ThinkBook 14 2026'), fill(label('设备序列号'), 'PF4DEMO26')]
      ),
      saveInfo
    ]
  ),
  lesson(
    'supplement',
    'information',
    '补充照片与查看附件',
    '后续照片作为独立附件保存',
    'repair.information.edit',
    repairPrepare(2),
    [
      act(
        '打开补充照片',
        '补充照片使用与设备接收相同的选择控件。',
        track('staff.repairattachments.button.2'),
        click(track('staff.repairattachments.button.2')),
        { target: '.repair-attachment-upload' }
      ),
      act(
        '选择补充照片',
        '添加维修后的设备照片，保存到当前工单。',
        '.repair-attachment-upload',
        upload('supplement'),
        { target: '.field-photo-preview' }
      ),
      act(
        '保存附件',
        '上传完成后切到附件列表查看。',
        '.repair-attachment-upload',
        { type: 'submit', target: '.repair-attachment-upload' },
        { request: '/attachments' }
      ),
      inspect('查看附件列表', '可以点击附件下载。', '.repair-attachment-list')
    ]
  ),
  lesson(
    'attachments',
    'information',
    '查看与下载照片附件',
    '核对接收图与后续附件',
    null,
    repairPrepare(2),
    [
      act(
        '展开照片与附件',
        '这里显示当前权限允许读取的附件。',
        track('staff.repairattachments.button.1'),
        click(track('staff.repairattachments.button.1')),
        { target: '.record-attachments' }
      ),
      act(
        '下载示例照片',
        '点击文件名下载到本机。',
        track('staff.repairattachments.button.4'),
        click(track('staff.repairattachments.button.4')),
        { download: true }
      )
    ]
  ),
  lesson(
    'credential',
    'information',
    '补发机主查询链接',
    '核验机主身份后恢复查询凭证',
    'repair.information.edit',
    repairPrepare(2),
    [
      act(
        '打开补发查询链接',
        '查询凭证用于机主自行查看维修进度。',
        track('staff.repairdetails.summary.7'),
        click(track('staff.repairdetails.summary.7')),
        { target: track('staff.repairdetails.form.8') }
      ),
      act(
        '记录核验过程',
        '确认机主身份后勾选核验，并记录补发原因。',
        track('staff.repairdetails.form.8'),
        [
          { type: 'check', target: track('staff.repairdetails.input.9') },
          fill(
            track('staff.repairdetails.textarea.10'),
            '已当面核验学生证及设备，机主遗失原查询链接。'
          )
        ]
      ),
      act(
        '生成查询链接',
        '补发操作会生成新的机主查询凭证。',
        track('staff.repairdetails.button.11'),
        click(track('staff.repairdetails.button.11')),
        { request: '/credential' }
      ),
      inspect(
        '复制并交给机主',
        '本地教程凭证仅供演示，不能用于正式系统。',
        track('staff.repairdetails.credential-url')
      ),
      act(
        '确认已交付机主',
        '机主收到链接后，完成这次补发。',
        track('staff.repairdetails.finish-credential'),
        click(track('staff.repairdetails.finish-credential'))
      )
    ]
  ),
  lesson(
    'repair-history',
    'information',
    '查看维修与交接记录',
    '管理身份查看责任流转',
    'members.manage',
    repairPrepare(2),
    [
      act(
        '打开操作记录',
        '负责人可以查看维修、接收和交接的管理记录。',
        track('staff.repairdetails.button.12'),
        click(track('staff.repairdetails.button.12'))
      ),
      inspect(
        '核对责任与时间',
        '普通部员只能看到必要维修事实，无法读取管理操作日志。',
        'dialog[open]'
      )
    ]
  ),
  lesson(
    'original',
    'information',
    '查看原始登记与协议',
    '保留原登记证据与后续校对的区别',
    'members.manage',
    repairPrepare(2),
    [
      act(
        '打开原始登记',
        '负责人可查看原始登记及协议证据。',
        track('staff.repairoriginal.button.1'),
        click(track('staff.repairoriginal.button.1'))
      ),
      inspect(
        '查看原始信息',
        '原登记用于追溯，后续补充在工单资料中保存。演示不包含真实签名。',
        'dialog[open]'
      )
    ]
  ),
  lesson(
    'warranty',
    'information',
    '查询设备保修状态',
    '品牌、序列号与查询结果',
    null,
    [nav('scene:today')],
    [
      act(
        '打开保修查询',
        '官方支持与维修信息分组展示。',
        track('staff.field.warrantylookup.button.1'),
        click(track('staff.field.warrantylookup.button.1')),
        { target: '.warranty-dialog' }
      ),
      act('输入设备序列号', '对照设备标签核对品牌和序列号。', '.warranty-dialog', {
        type: 'warrantyFill'
      }),
      act(
        '查询保修',
        '教程使用本地示例结果，不访问厂商接口。',
        '.warranty-dialog',
        { type: 'clickText', value: '查询原厂保修' },
        { request: '/api/warranty/query' }
      ),
      inspect(
        '核对保修服务',
        '根据服务项目和有效期判断，必要时引导机主使用官方售后。',
        '.warranty-dialog'
      )
    ]
  ),
  lesson(
    'service-center',
    'information',
    '查找官方售后网点',
    '在保设备的官方服务入口',
    'repair.start',
    repairPrepare(),
    [
      inspect('官方支持', '保修查询与售后网点入口放在一起。', '.repair-support'),
      act(
        '打开售后网点',
        '教程会显示目标网址，正式系统在新标签页打开品牌官方页面。',
        'text=查找售后网点',
        { type: 'external', target: 'text=查找售后网点' }
      ),
      inspect(
        '核对品牌',
        '入口根据工单品牌匹配，不支持的品牌需要先核对设备资料。',
        '.repair-summary'
      )
    ]
  ),
  lesson(
    'unsaved',
    'information',
    '未保存时取消、切换与继续',
    '保留草稿、丢弃或保存后继续',
    'repair.information.edit',
    repairPrepare(),
    [
      act('修改一项资料', '先打开编辑并修改型号，暂时不保存。', info, [
        click(info),
        fill(label('设备型号'), 'ThinkBook 14 · 已校对')
      ]),
      act(
        '切换到另一个操作',
        '点击补充照片，会提示如何处理未保存资料。',
        track('staff.repairattachments.button.2'),
        click(track('staff.repairattachments.button.2')),
        { target: '.unsaved-changes-dialog' }
      ),
      inspect(
        '三个选择',
        '右上角取消操作保留草稿；左下丢弃并继续；右下保存并继续。',
        '.unsaved-changes-dialog'
      ),
      act(
        '保存并继续',
        '保存成功后才切换操作区，保存失败则保留内容。',
        'text=保存并继续',
        click('text=保存并继续'),
        { request: '/information' }
      )
    ]
  ),
  lesson(
    'retry',
    'information',
    '保存失败后的重试',
    '验证错误反馈与草稿保留',
    'repair.information.edit',
    repairPrepare(),
    [
      act('准备一份修改', '修改工单型号，示例会模拟一次保存失败。', info, [
        click(info),
        fill(label('设备型号'), 'ThinkBook 14 · 重试示例'),
        { type: 'failNext' }
      ]),
      act(
        '观察失败反馈',
        '首次保存失败，输入内容会保留。',
        track('staff.repairdetails.button.5'),
        click(track('staff.repairdetails.button.5')),
        { error: true }
      ),
      act(
        '再次保存',
        '恢复后重试同一份草稿。',
        track('staff.repairdetails.button.5'),
        click(track('staff.repairdetails.button.5')),
        { request: '/information' }
      )
    ]
  ),
  lesson(
    'checkin',
    'mine',
    '完成本人到岗签到',
    '维修事务直接签到，维修人员使用签到码',
    'attendance.self',
    [nav('scene:mine')],
    [
      inspect('确认签到校区', '先核对当前签到校区与当天安排。', '.field-content'),
      act(
        '到岗签到',
        '维修事务可在有效窗口内直接签到；其他参与人员扫描现场签到码。',
        track('staff.field.attendanceactions.button.1'),
        { type: 'checkin' },
        { request: '/api/attendance/' }
      ),
      inspect('确认签到结果', '重复签到保留首次记录，不会重复累计。', '.field-content')
    ]
  ),
  lesson(
    'show-code',
    'mine',
    '展示当日到岗签到码',
    '维修事务出示个人签到码',
    'attendance.token.issue',
    [nav('scene:today')],
    [
      act('先完成本人签到', '示例先完成直接签到。', '.today-work-window', { type: 'checkin' }),
      act(
        '展示签到码',
        '同一出码人刷新自己的码，不替换其他人的码。',
        track('staff.field.todayworkwindow.attendance'),
        click(track('staff.field.todayworkwindow.attendance')),
        { request: '/token' }
      ),
      inspect('让值班人员扫码', '演示码仅供教程使用；正式码有有效期和出码人记录。', 'dialog[open]')
    ]
  ),
  lesson(
    'my-shifts',
    'mine',
    '查看我的值班与签到历史',
    '本周班次、当日安排与志愿时长',
    'attendance.self',
    myDuty,
    [
      inspect('今日安排', '确认班次校区和时段，再进行签到。', '.schedule-page'),
      inspect(
        '我的志愿时长',
        '本月和累计时长按现有考勤规则计算，维修数量不参与核算。',
        '.duty-hours'
      ),
      inspect(
        '查看本人签到历史',
        '本人记录直接显示在我的值班下方，不混入管理报表。',
        '.attendance-history'
      ),
      inspect('核对历史', '本人记录保留签到事实，出码人等来源仅对管理身份展示。', '.schedule-page')
    ]
  ),
  lesson(
    'availability',
    'mine',
    '填报常规空闲与本周例外',
    '整班空闲按校区填报',
    'rosterParticipant',
    myDuty,
    [
      act(
        '编辑常规空闲',
        '维修事务填办公空闲，硬件部正式任职填维修空闲。',
        track('staff.schedule.button.9'),
        click(track('staff.schedule.button.9')),
        { target: track('staff.schedule.form.5') }
      ),
      act(
        '选择可到岗的整班',
        '每一项对应一个校区和一天的 19:00–21:00。',
        track('staff.schedule.input.6'),
        click(track('staff.schedule.input.6'))
      ),
      act(
        '保存常规空闲',
        '安排下周时会读取这些空闲。',
        track('staff.schedule.button.7'),
        click(track('staff.schedule.button.7')),
        { request: '/api/me/availability' }
      ),
      act(
        '填写本周例外',
        '临时变化只覆盖选定工作周。',
        track('staff.schedule.button.10'),
        click(track('staff.schedule.button.10')),
        { target: track('staff.schedule.form.5') }
      ),
      act(
        '保存本周例外',
        '保留常规空闲，单独保存本周安排。',
        track('staff.schedule.button.7'),
        click(track('staff.schedule.button.7')),
        { request: '/api/me/availability' }
      )
    ]
  ),
  lesson('leave', 'mine', '为班次请假与撤回', '请假不等同于有人接替', 'attendance.self', myDuty, [
    act(
      '为班次请假',
      '选中对应班次的请假入口。',
      track('staff.schedule.button.18'),
      click(track('staff.schedule.button.18')),
      { target: track('staff.schedule.form.12') }
    ),
    act(
      '填写请假原因',
      '提交后该班次会显示已请假。',
      track('staff.schedule.input.14'),
      fill(track('staff.schedule.input.14'), '临时课程冲突，已提前与负责人沟通。')
    ),
    act(
      '确认请假',
      '请假会影响应到人数；接替需要另行邀请。',
      track('staff.schedule.button.15'),
      click(track('staff.schedule.button.15')),
      { request: '/leave' }
    ),
    act(
      '撤回请假',
      '恢复能够到岗后，可在班次操作中撤回。',
      track('staff.schedule.button.17'),
      click(track('staff.schedule.button.17')),
      { request: '/leave-withdraw' }
    )
  ]),
  lesson('cover', 'mine', '邀请同事接替班次', '选择接替人并等待回应', 'attendance.self', myDuty, [
    act(
      '发起接替邀请',
      '在需要替换的班次下操作。',
      track('staff.schedule.button.19'),
      click(track('staff.schedule.button.19')),
      { target: track('staff.schedule.form.12') }
    ),
    act(
      '选择同事并写明原因',
      '邀请不会立即变更班表，须等待对方接受。',
      track('staff.schedule.form.12'),
      [
        choose(track('staff.schedule.select.13'), '陈一帆'),
        fill(track('staff.schedule.input.14'), '课程冲突，请协助接替本次值班。')
      ]
    ),
    act(
      '发送接替邀请',
      '本地示例只改变演示状态。',
      track('staff.schedule.button.15'),
      click(track('staff.schedule.button.15')),
      { request: '/cover' }
    )
  ]),
  lesson(
    'cover-response',
    'mine',
    '回应接替邀请',
    '接受或拒绝同事的邀请',
    'attendance.self',
    myDuty,
    [
      inspect('查看邀请', '核对邀请人、校区、日期、时段和原因。', '.roster-invitations'),
      act(
        '接受示例邀请',
        '接受后才变更对应班次，拒绝则保留原安排。',
        track('staff.schedule.button.20'),
        click(track('staff.schedule.button.20')),
        { request: '/response' }
      ),
      inspect('核对回应结果', '确认新的值班安排和接替状态。', '.schedule-page')
    ]
  ),
  lesson(
    'profile',
    'start',
    '更新个人资料',
    '姓名与学院，保留身份边界',
    null,
    [nav('scene:mine')],
    [
      inspect(
        '个人资料',
        '这里只修改允许本人维护的资料，学号和所属校区用于核对。',
        '.personal-profile'
      ),
      act('修改显示姓名', '示例把姓名补充为练习用名称。', '.personal-profile', {
        type: 'profileFill'
      }),
      act(
        '保存本人资料',
        '保存后工作区姓名同步更新。',
        '.personal-profile',
        { type: 'clickText', value: '保存资料' },
        { request: '/api/me/profile' }
      )
    ]
  ),
  lesson(
    'password',
    'start',
    '修改密码并退出设备',
    '两次确认新密码',
    null,
    [nav('settings')],
    [
      act('填写密码表单', '演示密码只在浏览器中校验，不会发送到任何服务。', '.security-layout', [
        fill('[name="currentPassword"]', 'PioneerDemo26'),
        fill('[name="newPassword"]', 'PioneerDemo2026!'),
        fill('[name="confirmPassword"]', 'PioneerDemo2026!')
      ]),
      act(
        '修改并退出',
        '正式系统会撤销所有设备会话，随后使用新密码登录。',
        track('staff.accountsettings.button.5'),
        click(track('staff.accountsettings.button.5')),
        { request: '/api/auth/password' }
      ),
      inspect('回到登录页', '使用新密码重新登录后，继续检查设备会话。', '#staff-react-root')
    ]
  ),
  lesson(
    'sessions',
    'start',
    '撤销所有登录会话',
    '其他设备也会退出登录',
    null,
    [nav('settings')],
    [
      act(
        '发起撤销',
        '发现账号在不可信设备登录时，可撤销全部会话。',
        track('staff.accountsettings.button.6'),
        click(track('staff.accountsettings.button.6')),
        { target: 'dialog[open]' }
      ),
      act(
        '确认撤销并退出',
        '正式系统需要重新登录。',
        track('staff.accountsettings.button.8'),
        click(track('staff.accountsettings.button.8')),
        { request: '/api/auth/revoke' }
      )
    ]
  ),
  lesson(
    'staffing',
    'duty',
    '查看今日人员与工作量',
    '维修事务看人员状态，负责人可管理考勤',
    'attendance.token.issue',
    dutyPrepare('今日值班'),
    [
      inspect('办公与维修值班', '查看应到、已签到、请假和临时支援人员。', '.attendance-management'),
      inspect('人员工作状态', '空闲与维修中用于接待分派参考，不替代考勤记录。', '.duty-person'),
      act('刷新当日数据', '刷新沿用当前校区和日期。', '.attendance-management', {
        type: 'clickText',
        value: '刷新值班'
      })
    ]
  ),
  lesson(
    'planner',
    'duty',
    '生成建议并发布下周班表',
    '核对维修、办公与负责人覆盖',
    'roster.manage',
    dutyPrepare('安排下周'),
    [
      inspect('选择排班范围', '按任务选择校区和工作周，维修与办公一起核对。', '.duty-planner'),
      act(
        '生成排班建议',
        '建议读取任职和空闲，不会立即发布。',
        'text=生成建议',
        { type: 'clickText', value: '生成建议' },
        { request: '/suggestions' }
      ),
      inspect('核对建议与提示', '检查人员、日期、负责人覆盖及未安排人员。', '.duty-planner'),
      act(
        '发布班表',
        '维修和办公班表同时保存，并准备对应签到场次。',
        'text=发布',
        { type: 'clickText', value: '发布' },
        { request: '/api/rosters/campus-week' }
      )
    ]
  ),
  lesson(
    'manual-roster',
    'duty',
    '手动安排与移除人员',
    '在自动建议之外调整班次',
    'roster.manage',
    dutyPrepare('安排下周'),
    [
      act(
        '打开当天选人',
        '按日期和维修或办公类型安排。',
        '.duty-planner',
        { type: 'plannerPick' },
        { target: '.roster-person-picker' }
      ),
      act('选择工作人员', '可以搜索并勾选；跨部门或重复安排会有提示。', 'dialog[open]', {
        type: 'plannerChoose'
      }),
      inspect('核对手动安排', '选人后返回班表，检查日期和人员，再发布。', '.duty-planner'),
      act(
        '发布调整',
        '正式使用前先处理冲突和核对提示。',
        'text=发布',
        { type: 'clickText', value: '发布' },
        { request: '/api/rosters/campus-week' }
      )
    ]
  ),
  lesson(
    'roster-refresh',
    'duty',
    '重新读取班表与保留草稿',
    '读取最新基线后核对手动变更',
    'roster.manage',
    dutyPrepare('安排下周'),
    [
      act('生成一份草稿', '先生成未发布的建议。', 'text=生成建议', {
        type: 'clickText',
        value: '生成建议'
      }),
      act(
        '读取最新班表',
        '读取会合并最新结果；手动新增会保留，远端修改优先。',
        'text=读取最新班表',
        { type: 'clickText', value: '读取最新班表' }
      ),
      inspect('核对后再发布', '先查看提示，再决定继续发布或放弃草稿。', '.duty-planner')
    ]
  ),
  lesson(
    'attendance-correction',
    'duty',
    '补录与更正考勤',
    '固定值班日，记录更正原因',
    'attendance.correct',
    dutyPrepare('今日值班'),
    [
      act(
        '选择人员补录',
        '在对应人员行发起补录。',
        '.duty-person',
        click(track('staff.attendancemanagement.button.3')),
        { target: '.duty-correction-form' }
      ),
      act(
        '填写补录原因',
        '无签到记录时按当天班次开始时间补记；已有记录时仅更正当天时分。',
        'dialog[open]',
        { type: 'correctionFill' }
      ),
      act(
        '保存考勤',
        '原因与操作人记录在管理数据中。',
        'dialog[open]',
        { type: 'clickText', value: '保存考勤' },
        { request: '/api/attendance/corrections' }
      )
    ]
  ),
  lesson(
    'attendance-source',
    'duty',
    '核对签到来源',
    '出码人、直接签到与补录来源',
    'attendance.correct',
    dutyPrepare('今日值班'),
    [
      act(
        '准备现场签到记录',
        '模拟陈一帆刚刚扫描现场签到码，随后核对出码来源。',
        '.attendance-management',
        { type: 'seedAttendance' }
      ),
      inspect('查看已签到人员', '管理视角能看到签到时间和来源。', '.duty-person'),
      act(
        '打开来源详情',
        '历史未保存的来源明确显示未知，不推断补填。',
        '.duty-person',
        click(track('staff.attendancemanagement.checkin-detail'))
      )
    ]
  ),
  lesson(
    'attendance-history',
    'duty',
    '考勤历史筛选与下钻',
    '按月、校区、人员与状态核对',
    'attendance.export',
    dutyPrepare('统计与历史'),
    [
      act(
        '切换考勤记录',
        '统计与历史区分志愿时长和实际出勤。',
        track('staff.attendancereports.button.9'),
        click(track('staff.attendancereports.button.9')),
        { target: '.attendance-history-browser' }
      ),
      act(
        '搜索人员',
        '搜索姓名、学号或部门。',
        track('staff.history.search'),
        fill(track('staff.history.search'), '陈一帆')
      ),
      act(
        '展开人员记录',
        '查看逐日班次和签到事实，并可进入当日考勤。',
        track('staff.history.person'),
        click(track('staff.history.person'))
      ),
      act(
        '导出当前结果',
        '导出遵循当前月份、校区及筛选条件。',
        track('staff.history.export'),
        click(track('staff.history.export')),
        { download: true }
      )
    ]
  ),
  lesson(
    'volunteer',
    'duty',
    '核对并导出逐周志愿登记表',
    '检查缺失资料后生成文件',
    'attendance.export',
    [...dutyPrepare('统计与历史'), click(track('staff.attendancereports.button.8'))],
    [
      inspect(
        '确认统计规则',
        '查看每次小时数和负责人计数方式。仅系统设置授权可编辑规则。',
        '.report-settings'
      ),
      inspect(
        '核对月份与校区',
        '报表范围继承任务选择，缺学院或学号时先补全人员资料。',
        '.report-controls'
      ),
      act(
        '下载逐周文件',
        '生成各周、各校区的演示登记表压缩包。',
        track('staff.attendancereports.button.11'),
        click(track('staff.attendancereports.button.11')),
        { download: true }
      )
    ]
  ),
  lesson(
    'weekly-export',
    'duty',
    '按周核算与导出考勤',
    '首次签到、负责人周计一次',
    'attendance.export',
    dutyPrepare('统计与历史'),
    [
      act(
        '打开按周核算',
        '可独立选择起止工作周，继承当前报表校区。',
        track('staff.attendancereports.button.13'),
        click(track('staff.attendancereports.button.13')),
        { target: 'dialog[open]' }
      ),
      act(
        '选择特殊计数',
        '示例启用同一人本周仅首次有效签到。',
        track('staff.weeklyattendanceexport.input.2'),
        click(track('staff.weeklyattendanceexport.input.2'))
      ),
      act(
        '核算预览',
        '预览实际签到次数、核算次数和依据。',
        track('staff.weeklyattendanceexport.button.4'),
        click(track('staff.weeklyattendanceexport.button.4')),
        { request: '/api/attendance/weekly-summary' }
      ),
      act(
        '导出周考勤',
        '下载本地演示 CSV。',
        track('staff.weeklyattendanceexport.button.5'),
        click(track('staff.weeklyattendanceexport.button.5')),
        { download: true }
      )
    ]
  ),
  lesson(
    'members',
    'people',
    '查找人员与维护基本资料',
    '人员校区、状态、学院与专业',
    'members.manage',
    peoplePrepare('人员列表'),
    [
      act(
        '查找成员',
        '按姓名、学号或部门检索。',
        track('staff.members.input.1'),
        fill(track('staff.members.input.1'), '陈一帆')
      ),
      act(
        '打开成员详情',
        '基本资料、任职身份和账号分开管理。',
        '.members-results',
        { type: 'memberOpen' },
        { target: 'dialog[open]' }
      ),
      act(
        '补充专业信息',
        '示例修改专业，保留已有任职。',
        'dialog[open]',
        fill(label('专业'), '计算机科学与技术（演示校对）')
      ),
      act(
        '保存基本资料',
        '只更新当前人员，沿用人员版本。',
        track('staff.membereditor.button.9'),
        click(track('staff.membereditor.button.9')),
        { request: '/api/members/' }
      )
    ]
  ),
  lesson(
    'member-create',
    'people',
    '新增成员与加入资格',
    '填写资料、任职及授权校区',
    'members.manage',
    peoplePrepare('人员列表'),
    [
      act(
        '新增人员',
        '一次创建人员资料、任职和默认待激活资格。',
        track('staff.members.button.4'),
        click(track('staff.members.button.4')),
        { target: track('staff.membercreate.form.1') }
      ),
      act(
        '填写成员资料',
        '示例学号和姓名都是虚构资料。可选部门，也可只添加独立身份。',
        track('staff.membercreate.form.1'),
        [
          fill(track('staff.membercreate.input.2'), '20268888'),
          fill(track('staff.membercreate.input.3'), '新成员示例')
        ]
      ),
      act(
        '创建人员',
        '创建人员后仍需本人提交激活申请并由负责人核验。',
        track('staff.membercreate.form.1'),
        { type: 'submit', target: track('staff.membercreate.form.1') },
        { request: '/api/members' }
      )
    ]
  ),
  lesson(
    'member-import',
    'people',
    '批量导入成员',
    '下载模板、预览与整批确认',
    'members.manage',
    peoplePrepare('人员列表'),
    [
      act(
        '打开批量导入',
        '支持基础 CSV 和含任职字段的进阶格式。',
        track('staff.members.button.5'),
        click(track('staff.members.button.5')),
        { target: track('staff.memberimport.textarea.7') }
      ),
      act(
        '填写示例 CSV',
        '按模板列名填写，预览前不会写入人员。',
        track('staff.memberimport.textarea.7'),
        fill(
          track('staff.memberimport.textarea.7'),
          'studentId,name,college\n20268881,示例甲,计算机科学与工程学院\n20268882,示例乙,软件学院'
        )
      ),
      act(
        '预览变更',
        '核对新增、更新、跳过和冲突结果。',
        track('staff.memberimport.button.8'),
        click(track('staff.memberimport.button.8')),
        { request: '/api/members/import' }
      ),
      act(
        '确认导入',
        '预览结果无冲突后整批确认。',
        track('staff.memberimport.button.10'),
        click(track('staff.memberimport.button.10')),
        { request: '/api/members/import' }
      )
    ]
  ),
  lesson(
    'education-import',
    'people',
    '批量补全学院',
    '定位人员后预览学院变更',
    'members.manage',
    peoplePrepare('人员列表'),
    [
      act('打开更多操作', '批量补学院在人员列表更多操作中。', '.members-list-actions', {
        type: 'more'
      }),
      act(
        '批量补学院',
        '只补资料，不改变任职。',
        track('staff.members.button.6'),
        click(track('staff.members.button.6'))
      ),
      act(
        '填写人员与学院',
        '使用学号匹配现有人员。',
        track('staff.educationimport.textarea.4'),
        fill(
          track('staff.educationimport.textarea.4'),
          'studentId,college\n20260002,计算机科学与工程学院'
        )
      ),
      act(
        '预览并确认',
        '核对学院名称后批量保存。',
        track('staff.educationimport.button.5'),
        [
          click(track('staff.educationimport.button.5')),
          click(track('staff.educationimport.button.8'))
        ],
        { request: '/api/members/education-import' }
      )
    ]
  ),
  lesson(
    'membership',
    'people',
    '新增任职或独立身份',
    '正式部门、交流维修、维修事务',
    'members.manage',
    [...peoplePrepare('人员列表'), { type: 'memberOpen' }, tab('任职与身份')],
    [
      inspect(
        '任职历史',
        '任职有生效和结束日期；交流维修与维修事务可以并存。',
        '.member-membership-list'
      ),
      act(
        '新增任职',
        '不添加部门时也可以仅添加独立身份。',
        track('staff.membermemberships.add'),
        click(track('staff.membermemberships.add')),
        { target: track('staff.membermemberships.form.2') }
      ),
      act(
        '选择维修事务',
        '示例仅添加维修事务身份，不额外制造维修资格。',
        track('staff.membermemberships.form.2'),
        { type: 'membershipFill' }
      ),
      act(
        '保存任职',
        '有效任职会影响登录后的业务权限。',
        track('staff.membermemberships.button.9'),
        click(track('staff.membermemberships.button.9')),
        { request: '/memberships' }
      )
    ]
  ),
  lesson(
    'end-membership',
    'people',
    '结束任职与保留历史',
    '结束日期当天起不再有效',
    'members.manage',
    [...peoplePrepare('人员列表'), { type: 'memberOpen' }, tab('任职与身份')],
    [
      act(
        '结束对应任职',
        '请核对结束的是哪一项任职或独立身份。',
        track('staff.membermemberships.button.1'),
        click(track('staff.membermemberships.button.1')),
        { target: track('staff.membermemberships.form.2') }
      ),
      inspect(
        '确认结束日期',
        '结束日当天不再提供权限；历史记录保留。',
        track('staff.membermemberships.form.2')
      ),
      act(
        '保存结束操作',
        '相关账号授权在正式系统中会同步更新。',
        track('staff.membermemberships.button.9'),
        click(track('staff.membermemberships.button.9')),
        { request: '/memberships/' }
      )
    ]
  ),
  lesson(
    'member-history',
    'people',
    '核对成员操作历史',
    '资料与任职操作追溯',
    'members.manage',
    [...peoplePrepare('人员列表'), { type: 'memberOpen' }],
    [
      act('打开操作历史', '查看人员管理操作的时间和操作者。', 'text=操作记录', {
        type: 'clickText',
        value: '操作记录'
      }),
      inspect('阅读变更记录', '核对刚才的资料与任职操作。', 'dialog[open]')
    ]
  ),
  lesson(
    'accounts',
    'people',
    '账号资料、授权校区与启停',
    '普通账号的管理边界',
    'accounts.manage',
    accounts('账号列表'),
    [
      inspect('账号列表', '本人、系统管理员及受保护账号有独立限制。', '.accounts-workspace'),
      act(
        '管理普通账号',
        '打开陈一帆的演示账号。',
        '.account-list',
        { type: 'accountOpen' },
        { target: track('staff.accounts.form.7') }
      ),
      act(
        '更新账号名称',
        '账号所属和授权校区影响访问范围。',
        track('staff.accounts.input.8'),
        fill(track('staff.accounts.input.8'), '陈一帆（演示）')
      ),
      act(
        '保存账号',
        '正式保存会撤销该账号已有会话。',
        track('staff.accounts.button.15'),
        click(track('staff.accounts.button.15')),
        { request: '/api/users/' }
      )
    ]
  ),
  lesson(
    'reset-password',
    'people',
    '重置成员登录密码',
    '在普通账号详情中操作',
    'accounts.manage',
    [...accounts('账号列表'), { type: 'accountOpen' }],
    [
      act(
        '勾选重置密码',
        '只对允许管理的普通账号提供操作。',
        track('staff.accounts.input.12'),
        click(track('staff.accounts.input.12'))
      ),
      act(
        '设置新密码',
        '本地演示密码不会发送到正式系统。',
        track('staff.accounts.input.13'),
        fill(track('staff.accounts.input.13'), 'PioneerDemo2026!')
      ),
      act(
        '保存账号',
        '重置后成员使用新密码重新登录。',
        track('staff.accounts.button.15'),
        click(track('staff.accounts.button.15')),
        { request: '/api/users/' }
      )
    ]
  ),
  lesson(
    'activation-review',
    'people',
    '核验并批准激活申请',
    '先选申请，再核实本人身份',
    'accounts.manage',
    accounts('激活审核'),
    [
      act(
        '选择申请',
        '核对姓名、学号和预期校区。',
        track('staff.accounts.input.18'),
        click(track('staff.accounts.input.18'))
      ),
      act('记录核验', '逐一核实本人身份后，才允许批准。', track('staff.accounts.input.19'), [
        { type: 'check', target: track('staff.accounts.input.19') },
        fill(track('staff.accounts.textarea.20'), '已核对本人学生证与任职资料。')
      ]),
      act(
        '批准申请',
        '通过后建立普通账号并复制已配置校区范围。',
        track('staff.accounts.button.22'),
        click(track('staff.accounts.button.22')),
        { request: '/api/activation-requests/review' }
      ),
      act(
        '查看已处理',
        '核对审批结果与说明。',
        track('staff.accounts.button.27'),
        click(track('staff.accounts.button.27'))
      )
    ]
  ),
  lesson(
    'activation-reject',
    'people',
    '拒绝不符合条件的激活申请',
    '记录原因并保留审核历史',
    'accounts.manage',
    accounts('激活审核'),
    [
      act(
        '选择申请',
        '只处理已核对的申请。',
        track('staff.accounts.input.18'),
        click(track('staff.accounts.input.18'))
      ),
      act(
        '填写拒绝原因',
        '给出可核对的原因。',
        track('staff.accounts.textarea.20'),
        fill(track('staff.accounts.textarea.20'), '资料与本人身份不一致，请联系负责人核对。')
      ),
      act(
        '拒绝申请',
        '申请会进入已处理列表。',
        track('staff.accounts.button.21'),
        click(track('staff.accounts.button.21')),
        { request: '/api/activation-requests/review' }
      )
    ]
  ),
  lesson(
    'invitations',
    'people',
    '管理加入资格与激活入口',
    '查看待激活状态和撤销资格',
    'accounts.manage',
    accounts('加入资格'),
    [
      inspect(
        '加入资格',
        '人员创建后默认获得待激活资格；仍需本人申请和负责人审核。',
        '.accounts-workspace'
      ),
      act('撤销示例资格', '撤销只影响对应人员的加入资格。', '.accounts-workspace', {
        type: 'clickText',
        value: '撤销资格'
      }),
      act(
        '复制激活网址',
        '教程展示本地激活入口，正式工作请分享正式系统地址。',
        'text=复制激活网址',
        { type: 'clickText', value: '复制激活网址' }
      )
    ]
  ),
  lesson(
    'capacity',
    'booking',
    '修改每周名额模板',
    '编辑、批量填充、核对与发布',
    'booking.manage',
    [nav('capacity')],
    [
      inspect('每周模板', '按校区、周一至周四和四个时段设置名额。', '.capacity-template'),
      act(
        '批量填充当前范围',
        '示例把当前选择范围填成 6，先形成草稿。',
        track('staff.capacityeditor.input.13'),
        [
          fill(track('staff.capacityeditor.input.13'), '6'),
          click(track('staff.capacityeditor.button.15'))
        ]
      ),
      act('核对待保存变更', '检查每个受影响的日期时段。', '.capacity-page', {
        type: 'capacityReview'
      }),
      act(
        '保存容量模板',
        '正式系统会保留已有占用与名额生效规则。',
        '.capacity-page',
        { type: 'capacitySave' },
        { request: '/api/slot-capacities' }
      )
    ]
  ),
  lesson(
    'capacity-copy',
    'booking',
    '复制、撤销与恢复模板草稿',
    '在日期或校区间复用设置',
    'booking.manage',
    [nav('capacity')],
    [
      inspect(
        '复制目标',
        '可把当前设置复制到其他工作日；有双校区权限时可跨校区复制。',
        '.capacity-page'
      ),
      act(
        '修改并查看草稿',
        '先批量设置一份草稿，再查看撤销与恢复操作。',
        track('staff.capacityeditor.input.13'),
        [
          fill(track('staff.capacityeditor.input.13'), '7'),
          click(track('staff.capacityeditor.button.15'))
        ]
      ),
      act('撤销这次修改', '撤销只影响当前未发布草稿。', '.capacity-page', {
        type: 'clickText',
        value: '撤销'
      })
    ]
  ),
  lesson(
    'actual-capacity',
    'booking',
    '核对指定日期的实际名额',
    '占用、剩余和排班参考',
    'booking.manage',
    [nav('capacity'), tab('日期实际容量')],
    [
      inspect('日期实际容量', '与每周模板分开查看，以实际日期为准。', '.capacity-actual'),
      inspect('已占用与剩余', '核对每个时段的名额与现有预约。', '.capacity-actual'),
      act('刷新实际容量', '沿用当前任务校区和日期。', '.capacity-actual', {
        type: 'clickText',
        value: '刷新当日容量'
      })
    ]
  ),
  lesson(
    'service-location',
    'booking',
    '修改维修地点并核对受影响预约',
    '地点修改、历史与通知名单',
    'booking.manage',
    [nav('capacity'), tab('维修地点')],
    [
      inspect('当前维修地点', '校区和日期属于本次修改的明确范围。', '.capacity-locations'),
      act('编辑地点', '示例把地点调整到图书馆服务区。', '.capacity-locations', {
        type: 'locationEdit'
      }),
      act(
        '保存地点变更',
        '保存前检查受影响预约，必要时人工通知机主。',
        '.capacity-locations',
        { type: 'locationSave' },
        { request: '/api/service-locations' }
      ),
      act(
        '查看受影响预约与历史',
        '可查看名单与地点修改记录。',
        track('staff.servicelocationeditor.button.10'),
        click(track('staff.servicelocationeditor.button.10'))
      )
    ]
  ),
  lesson(
    'service-days',
    'booking',
    '暂停与恢复维修日期',
    '选择日期、填写原因和核对预约',
    'booking.manage',
    [nav('capacity'), tab('暂停日期')],
    [
      act('选择将要暂停的日期', '只能修改尚未过去且在当前范围内的维修日。', '.service-day-editor', {
        type: 'serviceDayPick'
      }),
      act(
        '填写暂停原因',
        '原因用于向机主说明当天安排。',
        track('staff.servicedayeditor.textarea.5'),
        fill(track('staff.servicedayeditor.textarea.5'), '场地维护，请改约其他维修日期。')
      ),
      act(
        '核对并确认暂停',
        '暂停不会静默删除已有预约，需核对受影响名单。',
        track('staff.servicedayeditor.button.6'),
        { type: 'serviceDayPause' },
        { request: '/api/service-days' }
      ),
      inspect('确认暂停状态', '同一区域也可选择暂停日期后恢复服务。', '.service-day-editor')
    ]
  ),
  lesson(
    'release-time',
    'booking',
    '调整预约放号时间',
    '按校区设置每天的放号时刻',
    'booking.manage',
    [nav('capacity'), tab('放号时间')],
    [
      inspect('当前放号时间', '预约配置的任务校区决定这次设置的作用范围。', '.booking-settings'),
      act('调整放号时刻', '可以手工输入时分，也可使用统一时间控件。', '.booking-settings', {
        type: 'releaseFill'
      }),
      act(
        '保存放号时间',
        '更改只写入当前校区配置。',
        '.booking-settings',
        { type: 'clickText', value: '保存放号时间' },
        { request: '/api/booking-settings' }
      )
    ]
  ),
  lesson(
    'notice',
    'booking',
    '发布和停用校区公告',
    '标题、内容、展示方式与有效期',
    'booking.manage',
    [nav('capacity'), tab('校区公告')],
    [
      act('新增公告', '公告按校区和有效时间展示。', '.booking-settings', {
        type: 'clickText',
        value: '新增公告'
      }),
      act('填写公告', '示例使用有效期内的维修安排提醒。', 'dialog[open]', { type: 'noticeFill' }),
      act(
        '保存公告',
        '保存后可以再次编辑或停用。',
        'dialog[open]',
        { type: 'clickText', value: '保存公告' },
        { request: '/api/booking-notices' }
      ),
      inspect('查看公告状态', '启用与停用、内联与弹窗展示均在公告配置中维护。', '.booking-settings')
    ]
  ),
  lesson(
    'statistics',
    'booking',
    '查看维修业务统计',
    '预约量、结果、故障与工作量',
    'statistics.read',
    [nav('stats')],
    [
      inspect('核心指标', '预约总数、已完成、关联返修与修复成功率。', '.report-metrics'),
      act(
        '调整统计范围',
        '可以选择最近 7 天、30 天、全部或单日。',
        track('staff.statistics.select.2'),
        choose(track('staff.statistics.select.2'), '最近 30 天')
      ),
      inspect(
        '每日、故障与校区分布',
        '维修工作量用于业务分析，不替代考勤与志愿时长。',
        '.report-grid'
      ),
      act(
        '刷新统计',
        '保留当前筛选范围。',
        track('staff.statistics.button.1'),
        click(track('staff.statistics.button.1'))
      )
    ]
  ),
  lesson(
    'login',
    'start',
    '使用工作人员账号登录',
    '首次激活通过后使用学号登录',
    null,
    [{ type: 'logout' }],
    [
      inspect('工作人员登录', '使用审核通过的账号。教程中的学号与密码都是示例。', '#login-form'),
      act('填写演示账号', '本地登录不会连接正式系统。', '#login-form', [
        fill('#login-id', '20260001'),
        fill('#login-password', 'PioneerDemo2026!')
      ]),
      act(
        '进入系统',
        '登录后只显示当前有效任职允许的入口。',
        track('staff.staffaccess.button.5'),
        click(track('staff.staffaccess.button.5')),
        { request: '/api/auth/login' }
      ),
      inspect('确认身份与工作区', '检查当前任职和工作校区。', '.today-work-window')
    ]
  ),
  lesson(
    'activation',
    'start',
    '首次申请账号激活',
    '提交本人资料并查看审核进度',
    null,
    [],
    [
      inspect(
        '首次激活申请',
        '须先由负责人建立人员及加入资格，再由本人提交申请。',
        '#activation-form'
      ),
      act('填写激活资料', '核对学号、姓名、所属校区，设置并确认密码。', '#activation-form', [
        fill('#activation-student-id', '20260005'),
        fill('#activation-name', '温言'),
        choose(track('staff.staffaccess.select.10'), '南湖'),
        fill('#activation-password', 'PioneerDemo2026!'),
        fill('#activation-confirm', 'PioneerDemo2026!')
      ]),
      act(
        '提交申请',
        '提交后保留回执，等待负责人核验。',
        track('staff.staffaccess.button.11'),
        click(track('staff.staffaccess.button.11')),
        { request: '/api/activation' }
      ),
      act(
        '查看批准后的结果',
        '现在模拟负责人完成核验并批准，再刷新审核状态。',
        '#activation-result',
        [{ type: 'approveActivation' }, click(track('staff.staffaccess.button.12'))]
      ),
      inspect('审核通过', '正式工作中使用学号和自行设置的密码登录。', '#activation-result')
    ]
  ),
  lesson(
    'scan-order',
    'intake',
    '扫描维修码定位工单',
    '摄像头与相册识别入口',
    null,
    [nav('scene:today')],
    [
      act(
        '打开扫码',
        '扫码入口也允许手工输入，设备不可用时可继续工作。',
        track('staff.field.todayscene.button.2'),
        click(track('staff.field.todayscene.button.2'))
      ),
      act(
        '从相册识别示例维修码',
        '从相册识别这台设备的本地示例码。',
        'dialog[open]',
        { type: 'scanOrder' },
        { request: '/api/scan/resolve' }
      ),
      inspect('核对识别结果', '打开工单后仍需核对机主、设备和日期。', '.repair-summary')
    ]
  ),
  lesson(
    'warranty-ocr',
    'information',
    '从设备标签照片识别序列号',
    '相册识别、候选核对与采用',
    null,
    [nav('scene:today'), click(track('staff.field.warrantylookup.button.1'))],
    [
      act(
        '选择设备品牌',
        '先选品牌，识别结果按该品牌的序列号规则检查。',
        track('staff.field.warrantylookup.select.2'),
        choose(track('staff.field.warrantylookup.select.2'), '联想')
      ),
      act(
        '识别示例标签',
        '选择设备标签照片，示例识别结果会显示为待核对候选。',
        track('staff.field.warrantylookup.button.5'),
        { type: 'ocrPhoto' },
        { target: '.warranty-album-feedback' }
      ),
      act(
        '采用核对后的序列号',
        '识别候选须对照机身标签确认。',
        track('staff.field.warrantylookup.button.7'),
        click(track('staff.field.warrantylookup.button.7'))
      ),
      inspect('继续保修查询', '也可复制序列号或前往品牌官方支持。', '.warranty-dialog')
    ]
  ),
  lesson(
    'decline-cover',
    'mine',
    '拒绝接替与保留原班次',
    '无法到岗时明确回应邀请',
    'attendance.self',
    myDuty,
    [
      inspect('核对邀请安排', '确认校区、时段和原因，无法到岗时不要接受。', '.roster-invitations'),
      act('拒绝邀请', '拒绝后原值班安排保留。', 'text=拒绝', click('text=拒绝'), {
        request: '/response'
      }),
      inspect('查看回应状态', '邀请会显示已拒绝。', '.duty-personal')
    ]
  ),
  lesson(
    'cancel-cover',
    'mine',
    '撤回尚未接受的接替邀请',
    '停止等待同事回应',
    'attendance.self',
    myDuty,
    [
      act(
        '准备一份待回应邀请',
        '示例先邀请陈一帆接替本人的班次。',
        track('staff.schedule.button.19'),
        [
          click(track('staff.schedule.button.19')),
          choose(track('staff.schedule.select.13'), '陈一帆'),
          click(track('staff.schedule.button.15'))
        ],
        { request: '/cover' }
      ),
      act(
        '撤回邀请',
        '只撤回本人发出且尚未完成的邀请。',
        track('staff.schedule.button.21'),
        click(track('staff.schedule.button.21')),
        { request: '/response' }
      ),
      inspect('核对撤回结果', '邀请显示已撤回，不产生接替。', '.duty-personal')
    ]
  ),
  lesson(
    'availability-reset',
    'mine',
    '删除本周例外，恢复通常空闲',
    '清除单周覆盖，保留常规安排',
    'rosterParticipant',
    myDuty,
    [
      act(
        '先保存本周例外',
        '示例先建立一份仅本周生效的安排。',
        track('staff.schedule.button.10'),
        [click(track('staff.schedule.button.10')), click(track('staff.schedule.button.7'))],
        { request: '/api/me/availability' }
      ),
      act(
        '恢复通常安排',
        '移除本周例外后，再次使用通常空闲。',
        track('staff.schedule.button.11'),
        click(track('staff.schedule.button.11')),
        { request: '/api/me/availability' }
      ),
      inspect('查看有效空闲', '常规安排不受本周例外删除影响。', '.duty-personal')
    ]
  ),
  lesson(
    'attendance-time',
    'duty',
    '更正已有签到的到场时间',
    '保留原值班日，只修改当天时分',
    'attendance.correct',
    [...dutyPrepare('今日值班'), { type: 'seedAttendance' }],
    [
      act(
        '选择修正时间',
        '已有签到记录的人员行会显示修正时间。',
        'text=修正时间',
        click('text=修正时间')
      ),
      act(
        '修改时分与原因',
        '日期固定为原值班日，保留原记录和版本。',
        track('staff.attendancemanagement.form.9'),
        [
          { type: 'attendanceTime' },
          fill(
            track('staff.attendancemanagement.input.12'),
            '核对值班现场记录，实际到场时间为19:10。'
          )
        ]
      ),
      act(
        '保存时间更正',
        '管理历史可追溯本次修正。',
        track('staff.attendancemanagement.button.13'),
        click(track('staff.attendancemanagement.button.13')),
        { request: '/api/attendance/corrections' }
      )
    ]
  ),
  lesson(
    'remove-roster',
    'duty',
    '移除排班人员与放弃草稿',
    '核对移除影响，再决定是否发布',
    'roster.manage',
    dutyPrepare('安排下周'),
    [
      act(
        '生成示例安排',
        '先查看尚未发布的建议，再决定是否保留。',
        track('staff.dutyplanner.button.6'),
        click(track('staff.dutyplanner.button.6'))
      ),
      act(
        '移除一名人员',
        '移除只发生在当前草稿，发布后才作用于班表。',
        track('staff.dutyplanner.button.9'),
        click(track('staff.dutyplanner.button.9'))
      ),
      act('放弃草稿并重新读取', '放弃后回到原班表，需要时可再次生成建议。', '.duty-planner', {
        type: 'discardRoster'
      }),
      inspect('回到已发布基线', '当前班表与重新读取结果一致。', '.duty-planner')
    ]
  ),
  lesson(
    'member-status',
    'people',
    '停用与恢复人员资料',
    '停用保留历史，不删除维修与任职事实',
    'members.manage',
    [...peoplePrepare('人员列表'), { type: 'memberOpen' }],
    [
      act(
        '设置人员停用',
        '用于已经离开或暂不参与工作的成员。',
        track('staff.membereditor.select.7'),
        choose(track('staff.membereditor.select.7'), '停用')
      ),
      act(
        '保存人员状态',
        '正式系统会更新关联账号授权版本。',
        track('staff.membereditor.button.9'),
        click(track('staff.membereditor.button.9')),
        { request: '/api/members/' }
      ),
      act(
        '恢复正常状态',
        '状态恢复后仍按当前有效任职判断权限。',
        track('staff.membereditor.select.7'),
        [
          choose(track('staff.membereditor.select.7'), '正常'),
          click(track('staff.membereditor.button.9'))
        ],
        { request: '/api/members/' }
      )
    ]
  ),
  lesson(
    'account-status',
    'people',
    '启停普通工作人员账号',
    '账号状态与人员资料分开管理',
    'accounts.manage',
    [...accounts('账号列表'), { type: 'accountOpen' }],
    [
      act(
        '停用账号',
        '系统账号及本人账号遵循独立保护规则。',
        track('staff.accounts.select.11'),
        choose(track('staff.accounts.select.11'), '停用')
      ),
      act(
        '保存账号状态',
        '停用阻止后续登录，历史记录继续保留。',
        track('staff.accounts.button.15'),
        click(track('staff.accounts.button.15')),
        { request: '/api/users/' }
      ),
      inspect('核对账号列表', '需要恢复时，可再次打开账号并设为启用。', '.accounts-workspace')
    ]
  ),
  lesson(
    'capacity-copy-day',
    'booking',
    '把一天的名额复制到其他日期',
    '先形成草稿，再核对保存',
    'booking.manage',
    [nav('capacity')],
    [
      act(
        '准备周一的示例名额',
        '将周一四个时段统一填为6。',
        track('staff.capacityeditor.input.13'),
        [
          fill(track('staff.capacityeditor.input.13'), '6'),
          click(track('staff.capacityeditor.button.15'))
        ]
      ),
      act(
        '复制到其他三天',
        '复制内容包括当前草稿中的数值。',
        track('staff.capacityeditor.button.18'),
        click(track('staff.capacityeditor.button.18'))
      ),
      act(
        '核对并保存',
        '检查所有受影响时段后再保存。',
        '.capacity-page',
        [{ type: 'capacityReview' }, { type: 'capacitySave' }],
        { request: '/api/slot-capacities' }
      )
    ]
  ),
  lesson(
    'capacity-copy-campus',
    'booking',
    '把名额模板复制到另一校区',
    '只在双校区管理范围内操作',
    'global',
    [nav('capacity')],
    [
      act(
        '准备来源校区模板',
        '示例把当前校区整周名额统一设为6。',
        track('staff.capacityeditor.input.13'),
        [
          choose(track('staff.capacityeditor.select.14'), '当前校区整周'),
          fill(track('staff.capacityeditor.input.13'), '6'),
          click(track('staff.capacityeditor.button.15'))
        ]
      ),
      act(
        '复制到目标校区',
        '目标校区是本次写入参数，不是页面的查看范围。',
        track('staff.capacityeditor.button.20'),
        click(track('staff.capacityeditor.button.20'))
      ),
      act(
        '核对两校区变更并保存',
        '保存前检查变更列表中的校区与时段。',
        '.capacity-page',
        [{ type: 'capacityReview' }, { type: 'capacitySave' }],
        { request: '/api/slot-capacities' }
      )
    ]
  ),
  lesson(
    'restore-service',
    'booking',
    '恢复已暂停的维修日期',
    '解除暂停并恢复正常服务',
    'booking.manage',
    [nav('capacity'), tab('暂停日期')],
    [
      act(
        '准备一份暂停安排',
        '本课先选择日期并保存暂停。',
        '.service-day-editor',
        [
          { type: 'serviceDayPick' },
          fill(track('staff.servicedayeditor.textarea.5'), '演示暂停日期'),
          { type: 'serviceDayPause' }
        ],
        { request: '/api/service-days' }
      ),
      act(
        '恢复所选日期',
        '恢复前核对校区和日期。',
        track('staff.servicedayeditor.button.7'),
        [
          click(track('staff.servicedayeditor.button.7')),
          click(track('staff.servicedayeditor.button.10'))
        ],
        { request: '/api/service-days' }
      ),
      inspect('确认恢复正常', '暂停原因与历史操作仍可追溯。', '.service-day-editor')
    ]
  ),
  lesson(
    'notice-edit',
    'booking',
    '编辑公告与停用展示',
    '保留公告内容，控制是否启用',
    'booking.manage',
    [nav('capacity'), tab('校区公告')],
    [
      act(
        '编辑已有公告',
        '示例打开现有的期末维修安排。',
        track('staff.bookingsettingseditor.button.7'),
        click(track('staff.bookingsettingseditor.button.7'))
      ),
      act('修改内容并停用', '停用保留内容，之后可以再次启用。', '.booking-notice-form', [
        fill(
          track('staff.bookingsettingseditor.textarea.11'),
          '期末安排已调整，请以最新公告为准。'
        ),
        click(track('staff.bookingsettingseditor.input.16'))
      ]),
      act(
        '保存停用状态',
        '列表会显示已停用。',
        track('staff.bookingsettingseditor.button.19'),
        click(track('staff.bookingsettingseditor.button.19')),
        { request: '/api/booking-notices' }
      )
    ]
  ),
  lesson(
    'member-system-role',
    'system',
    '给人员添加额外系统授权',
    '指定角色、校区、原因与有效期',
    'roles.manage',
    [...peoplePrepare('人员列表'), { type: 'memberOpen' }, tab('账号与系统授权')],
    [
      act(
        '添加一项系统授权',
        '这不会生成维修或业务负责人资格。',
        track('staff.membereditor.button.18'),
        click(track('staff.membereditor.button.18'))
      ),
      act('填写范围和原因', '选择校区并记录授权原因。', '.member-roles-form', [
        { type: 'check', target: track('staff.membereditor.input.13') },
        fill(track('staff.membereditor.input.14'), '演示：临时协助维护系统配置。')
      ]),
      act(
        '保存系统授权',
        '正式账号需要重新登录后使用更新的系统能力。',
        '.member-roles-form',
        { type: 'submit', target: '.member-roles-form' },
        { request: '/roles' }
      )
    ]
  ),
  lesson(
    'system-roles',
    'system',
    '管理额外系统角色',
    '系统权限不代替业务任职',
    'roles.manage',
    [nav('permissions')],
    [
      inspect(
        '系统权限',
        '仅配置剩余系统能力，不生成接收、维修或业务负责人资格。',
        '.permissions-workspace'
      ),
      act('选择角色模板', '核对模板中可配置的系统权限。', '.permissions-workspace', {
        type: 'roleOpen'
      }),
      act(
        '调整额外系统权限',
        '示例为该模板增加全局审计读取，仍不制造业务身份。',
        track('staff.permissions.input.5'),
        { type: 'roleGrant' }
      ),
      act(
        '保存角色模板',
        '业务权限继续由有效任职决定。',
        'text=保存权限',
        { type: 'clickText', value: '保存权限' },
        { request: '/api/roles/' }
      )
    ]
  ),
  lesson(
    'report-rules',
    'system',
    '修改志愿登记表规则',
    '计数方式、每次时长与负责人规则',
    'settings.manage',
    dutyPrepare('统计与历史'),
    [
      act(
        '编辑登记规则',
        '普通负责人仅查看；有系统配置授权时可修改。',
        track('staff.attendancereportsettings.button.1'),
        click(track('staff.attendancereportsettings.button.1'))
      ),
      act('设置每次小时数', '修改后报表使用更新后的现有规则。', '.report-settings', {
        type: 'reportRuleFill'
      }),
      act(
        '保存导出规则',
        '仅改变演示内存数据。',
        '.report-settings',
        { type: 'clickText', value: '保存规则' },
        { request: '/api/attendance/report-settings' }
      )
    ]
  ),
  lesson(
    'retired-identity',
    'system',
    '授予与撤销退休老登身份',
    '只由系统管理员维护的独立身份',
    'roles.manage',
    [...peoplePrepare('人员列表'), { type: 'memberOpen' }, tab('任职与身份')],
    [
      inspect(
        '独立身份边界',
        '退休老登有双校区业务管理能力，但不参与排班、签到或填报空闲。',
        'dialog[open]'
      ),
      act(
        '授予示例身份',
        '不映射成站长任职，也不追溯修改历史时长。',
        'dialog[open]',
        { type: 'clickText', value: '授予退休老登身份' },
        { request: '/retired-elder' }
      ),
      act(
        '撤销示例身份',
        '操作保留审计，正式账号授权会即时更新。',
        'dialog[open]',
        { type: 'clickText', value: '撤销退休老登身份' },
        { request: '/retired-elder' }
      )
    ]
  )
];

export function courseAllowed(course, profile, permissions) {
  if (!course.permission) return true;
  if (course.permission === 'global') return profile.campuses.length > 1;
  if (course.permission === 'rosterParticipant') return rosterParticipantFor(profile);
  if (course.permission === 'correct')
    return permissions['repair.start'] || permissions['members.manage'];
  return permissions[course.permission] === true;
}
