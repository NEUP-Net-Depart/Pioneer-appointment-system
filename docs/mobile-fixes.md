# 后台移动端与首屏布局修复

验证日期：2026-10-21；CI 补充修复：2026-10-22，Asia/Shanghai。分支：`fix/mobile`；基线：`origin/dev` 的 `66ce1e08ca3c8f95aefd15f30b363e2b31481c9e`。

本次完成后台辅助文案精简、桌面首屏布局修复及此前审查的 M01–M06。业务接口、权限判断、校验条件和数据库结构没有变更。

## 首屏根因与证据

`WorkspaceBootstrap` 原先只有一个 `main.field-main`，却使用了正式工作区的 `.field-app` 网格：`216px minmax(0, 1fr)`。缺少侧边栏时，CSS 自动排版把唯一的主区放进第一列，内容被压到 216px；岗位和任务加载完成后，正式工作区插入侧边栏，主区才移到第二列。

在三个浏览器运行未修改的基线代码，均复现该问题。下表为 1440 × 900 冷启动的逐帧实测值；CSS 完成时间早于第一个错误布局帧，说明挤压来自加载态 DOM 结构。

| 引擎 | 基线 CSS 完成 / 首个错误帧（ms） | 基线加载态主区 x / 宽（px） | 修复后加载态与正式主区 x / 宽（px） |
| --- | --- | --- | --- |
| Chromium 156.0.8078.4 | 172.9 / 257.7 | 0 / 216 | 216 / 1224 |
| Firefox 157.0 | 376 / 459 | 0 / 216 | 216 / 1224 |
| WebKit 27.2 | 118 / 207 | 0 / 216 | 216 / 1224 |

修复让加载态复用 `StaffWorkspace`，从第一帧就保留真实侧边栏及主区结构；侧栏菜单尚未加载时显示装饰骨架。入口 HTML 直接设置 `field-mode`，避免依赖挂载后的 effect 才建立页面样式。正式工作区仍按原有权限生成菜单。

生产代码没有增加固定等待、强制刷新或隐藏页面的处理。

| 引擎 | 修复前加载态 | 修复后加载态 | 原始逐帧数据 |
| --- | --- | --- | --- |
| Chromium | [截图](mobile-fixes/chromium-before-bootstrap.png) | [截图](mobile-fixes/chromium-regression-bootstrap.png) | [前](mobile-fixes/chromium-before-frames.json) / [后](mobile-fixes/chromium-regression-frames.json) |
| Firefox | [截图](mobile-fixes/firefox-before-bootstrap.png) | [截图](mobile-fixes/firefox-regression-bootstrap.png) | [前](mobile-fixes/firefox-before-frames.json) / [后](mobile-fixes/firefox-regression-frames.json) |
| WebKit | [截图](mobile-fixes/webkit-before-bootstrap.png) | [截图](mobile-fixes/webkit-regression-bootstrap.png) | [前](mobile-fixes/webkit-before-frames.json) / [后](mobile-fixes/webkit-regression-frames.json) |

[桌面完成态](mobile-fixes/chromium-desktop-ready.png)、[手机完成态](mobile-fixes/chromium-phone-ready.png)及 [72 个修复前后场景的测量摘要](mobile-fixes/layout-summary.json)一并保留。时序数值来自本机确定性复现，不代表线上性能基准。

## M01–M06

| 问题 | 修复 | 回归依据 |
| --- | --- | --- |
| M01 错误跳转 | 暂停日期的“前往预约记录”使用现有路由键 `staff` | 真实预约 → 配置 → 受影响预约 → 记录工作区；三引擎、五视口 |
| M02 输入字号 | 后台手机文本输入、选择框、多行文本最小 `16px`，同时覆盖登录、激活及弹窗的局部字号覆盖；保留继承的大字号 | 测量可见文本控件的计算字号；聚焦、横竖屏与可见高度检查 |
| M03 触控区域 | 定向扩大手机岗位切换、详情展开、批量工具、参与名单、帮助与照片操作；学生校区及照片／刷新操作同步修复 | 后台选定高频控件有效区域至少 `44 × 44px`；保留其他小控件的审查记录 |
| M04 对比度 | 加深登录／激活主按钮、底部导航、状态与主要辅助文字颜色；学生成功页及详情文字同步修复 | axe 检查普通、选中及实际表单／弹窗状态；对比度问题作为失败断言 |
| M05 排班外溢 | 状态行和操作区允许换行、收缩；只在存在未保存修改时显示编辑状态；保留业务限制 | 真实办公草稿及发布修订、密集维修班表、200% DOM 字号、横屏与 768px 视口 |
| M06 骨架语义 | 装饰骨架设为 `aria-hidden="true"`；沿用已有 `role="status"` 加载文本，避免重复播报 | 暂缓真实成员接口，验证状态文本与骨架，并断言无 `aria-prohibited-attr` |

输入字号规则排除复选框、单选框、文件及隐藏控件。此次没有机械地扩大所有按钮，也没有禁止用户缩放。

## 辅助文案处理

已逐项检查维修、接待、现场、个人中心、签到、值班填报／换班、维修／办公排班、请假审批、考勤、预约记录、配置、成员、授权、统计、账号与安全工作区及其表单／弹窗。

删除重复标题、字段含义或按钮顺序的说明，例如“核对当天实际生效的名额和工作人员安排”“选择角色，调整权限后统一保存”“先选择班次……再发送邀请”。没有批量增加占位符或 Tooltip。

复杂帮助按需展开：预约表格快捷操作放入既有“批量填写与复制”；名单字段和角色配置、邀请 CSV 格式、预约号码查询规则放入具名 `details`。培训确认风险及导入授权覆盖／清空后果仍直接展示，未藏入帮助。

保留了以下关键信息：容量快照生效规则、暂停后的预约处理、地点变更与人工通知、资格和授权范围区别、交流培训要求、每人每日班次限制、负责人名额、超出原填报的人工安排、审批覆盖、记录纠错后果、密码长度与会话撤销、循环任务和自动延续边界、统计口径、加载／错误反馈。

[手机预约配置](mobile-fixes/phone-capacity.jpg)与 [200% 字号办公排班](mobile-fixes/office-roster-font200.jpg)可用于复核实际呈现。200% 检查针对整页外溢，不据此宣称所有大字号控件细节均已达到最佳排版。

## 自动化方法与结果

所有操作均连接现有 `scripts/test-e2e.mjs` 创建的本机临时 D1/R2；移动端套件还限制请求只访问该 loopback 服务。未操作共享 Preview／生产数据。

首屏测试包含 **36 个基础场景**：Chromium / Firefox / WebKit × 393 / 1440px × 冷启动、硬刷新、延迟 CSS 与会话、CSS 不缓存的普通维修人员刷新、未登录、过期会话。另补充 Chromium 桌面／手机各 6 个固定 15px 占位滚动条场景，共 **48 个场景**。使用响应闸门暂缓真实 CSS、`auth/me`、`field/home`，在释放前后连续 `requestAnimationFrame` 测量根区域、工作区、主区与侧栏边界，保存首屏／中间态／完成态截图、资源时序和浏览器版本。延迟条件由测试控制，不在产品中加入等待。

基础 36 个场景的断言在基线得到 **21 通过、15 失败**，失败均为桌面加载态；第一次本地修复后 **36 通过、0 跳过**。CI 发现滚动条占位差异后，补充修复的 **48 个场景全部通过**。现在断言要求工作区占满根区域，主区准确填满扣除侧栏后的可用宽度；桌面保留 216px 侧栏，手机不显示桌面侧栏，所有帧无整页横向外溢。

| 命令 | 最终结果 |
| --- | --- |
| `npm test` | 289 通过，0 跳过 |
| `npm run test:e2e` | 184 通过；41 个工作人员专用用例按配置跳过，由下行单独执行 |
| `npm run test:field` | 41 通过，0 跳过 |
| `npm run test:mobile` | 270 通过，0 跳过；最后局部调整另定向复跑 60 个组合，全部通过 |
| `npm run test:layout` | CI 补充修复后 48 通过，0 跳过 |
| `npm run format:staff:check`、`npm run lint`、`npm run typecheck` | 通过 |
| `npm run audit:architecture`、`npm run audit:staff-platform`、`npm run check` | 通过 |
| `npm run db:verify` | 新建、重复迁移及外键检查通过 |

复用此前审查的 18 类移动场景，覆盖三引擎和 360 / 393 / 430 / 768 / 1440px；增加输入字号、高频触控、对比度／加载语义失败断言，并扩展真实办公排班的发布修订及激活批准后的入口检查。办公排班场景使用不同周次，避免其他测试已发布班次影响参与资格。并发预约集成测试立即读取每个响应流，修复 Node 26 下等待其他响应时的垃圾回收竞态；3 次成功／5 次冲突的断言保持原样。

按每个场景／视口组合的最新结果汇总，共 270 个组合、2700 次状态测量、525 次 axe 扫描，26 个页面在 15 个组合均有记录；整页外溢、对比度及无效 ARIA 命名结果均为零。最后 60 个定向组合覆盖学生预约、维修排班、换班和成员／激活流程，包含最终色值、触控区域及辅助文案调整。[精简测试结果](mobile-fixes/test-results.json)保存每次运行的统计，重复执行不计作新的覆盖组合。

仍保留两类待确认观测：权限编辑区有 9 条 `scrollable-region-focusable` 提示；WebKit 的故障／重载场景有 5 条 `auth/me due to access control checks` 页面异常。它们没有被写成“全部无障碍通过”或“无页面异常”，也未据此推断为生产缺陷。读取顺序、原生滚动区焦点和该重载异常仍需人工复核。

复跑方式：

```bash
npm ci
npx playwright install chromium webkit firefox
npm run test:layout
npm run test:mobile
node scripts/mobile-audit-summary.mjs
```

`npm run verify` 已包含首屏回归；CI 安装 Firefox 并保存 `output/first-layout/` 截图与测量。全量移动矩阵保留为独立命令。新结果写入忽略的 `output/mobile-audit/` 与 `output/first-layout/`，不会覆盖此前审查的 `docs/mobile-audit/`。此前未提交的大体积审查证据保持原位置；本次提交本报告及精简后的修复证据。

## CI 占位滚动条补充修复（2026-10-22）

[`aa5cbaa` 的 CI](https://github.com/NEUP-Net-Depart/Pioneer-appointment-system/actions/runs/39628362996) 在新增首屏套件中得到 31 通过、5 失败，全部失败为 Chromium 393px 的加载态场景；此前的 289 项单元／集成、184 项常规 E2E、41 项工作人员流程均已通过。

原因有两层：全局 `html` 与后台 `body.field-mode` 同时设置 `scrollbar-gutter: stable`，而 `body` 已有 `overflow-x: hidden`。Linux Chromium 为两个区域各预留 15px，393px 窗口中的根区域为 378px，后台主区却只有 363px。原断言按 `innerWidth × 95%` 要求主区大于 373.35px；macOS 默认叠加式滚动条不占宽度，所以首次本地验证没有暴露该差异。原先缺少侧栏导致的 216px 挤压没有复发。

修复删除后台 `body` 的重复预留，仍由全局 `html` 稳定页面滚动条空间。同时将比例断言改成根区域／工作区／主区之间的严格几何关系，保留侧栏位置及横向溢出断言。新增的 15px 占位滚动条配置在 macOS 也能重现 Linux 情况：修复前手机 6 场景中 5 失败，修复后完整 48 场景全部通过。

| 393px 视口 | 根区域 | 工作区／主区 |
| --- | --- | --- |
| 重复预留 | 378px | 363px |
| 仅根区域预留 | 378px | 378px |

[修复前截图](mobile-fixes/classic-before-bootstrap.png)、[修复后截图](mobile-fixes/classic-after-bootstrap.png)和[测量与测试摘要](mobile-fixes/ci-followup.json)保留了可复核证据。此次补充只修改一处生产样式及首屏测试，未改业务逻辑。

## 修改文件

生产界面共 37 个文件：

- 首屏结构：`frontend/staff-react/main.jsx`、`StaffWorkspace.tsx`、`index.html`。
- 配置与数据页面文案：同目录 `AccountSettings.tsx`、`Accounts.jsx`、`ActualDayCapacity.jsx`、`Attendance.tsx`、`AttendanceManagement.jsx`、`CapacityEditor.jsx`、`Members.jsx`、`MemberEditor.jsx`、`MemberImport.jsx`、`Permissions.jsx`、`Records.jsx`、`ServiceDayEditor.jsx`、`ServiceLocationEditor.jsx`、`Statistics.tsx`。
- 排班与审批文案／状态：同目录 `CollectionComposer.jsx`、`LeaveReview.tsx`、`Roster.jsx`、`RosterAssignment.jsx`、`RosterCandidatePicker.jsx`、`RosterTaskWorkspace.jsx`、`RosterWorkflow.jsx`、`SwapRequests.tsx`、`WeeklyAvailability.jsx`。
- 现场操作文案：`frontend/staff-react/field/AppointmentLookup.tsx`、`DeskScene.tsx`、`FieldApp.tsx`、`PersonalScene.tsx`、`Repair.tsx`。
- 定向样式：`frontend/staff-react/base.css`、`workspace-foundation.css`、`roster-workflow.css`、`field/field.css`；`frontend/user/student.css`、`shared/styles.css`。

测试及工具：`tests/layout/{playwright.config.mjs,first-layout.spec.mjs}`、`tests/mobile-audit/*.mjs`、`scripts/mobile-audit*.mjs`、`tests/e2e/field-flow.spec.mjs`、`tests/integration.test.mjs`、`package.json`、`package-lock.json`、`.gitignore`、`.github/workflows/check.yml`。交付文档和精简证据为本文件及 `docs/mobile-fixes/`。

## 仍需真机验证

- iPhone Safari：聚焦缩放、收起键盘后的比例恢复、底部导航与安全区、浏览器工具栏和输入法。
- Android / OPPO：真实镜头选择、权限拒绝与恢复、扫码对焦／弱光、照片选择器、HEIC／EXIF 和大照片弱网上传。
- VoiceOver / TalkBack：成员加载状态实际播报、阅读顺序、触摸与手势误触。
- 系统字号／浏览器真实 200% 缩放及横竖屏持久化；Playwright DOM 字号放大与 WebKit 仿真不能替代上述检查。
