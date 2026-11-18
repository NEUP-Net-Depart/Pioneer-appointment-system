# 测试分工

默认检查保护持续有效的业务契约：权限与隐私、预约容量与并发、幂等和修订冲突、维修流转、排班与考勤，以及用户能够完成的关键页面操作。新增回归优先放在最低且真实的业务层，避免同一规则在服务测试和多个浏览器中重复枚举。

| 入口 | 内容 | 何时运行 |
| --- | --- | --- |
| `npm test` | `tests/*.test.mjs`：领域规则、实际 SQLite 数据操作、隐私和发布保护 | 每次变更；无需前端构建 |
| `npm run verify` | 格式、lint、类型、埋点目录与迁移指纹、Functions/前端构建、Node 和 6 项浏览器冒烟 | 默认 CI |
| `npm run test:migrations` | `tests/migrations/` 的历史数据升级与回滚，再执行两条完整本地 D1 迁移链 | 新迁移、历史恢复或升级流程变化 |
| `npm run test:deployment` | 构建后的发布目录、绑定和 CSP 集成检查 | 发布脚本、资源绑定或 CSP 变化 |
| `npm run test:e2e:full` | 全部浏览器回归，含专项诊断；默认 CI 只跑 6 项冒烟 | 相关模块修改、发布前验收 |
| `npm run test:e2e:diagnostics` | OCR/厂商验证码、图片编码和浏览器埋点诊断 | 对应模块或 SDK 升级 |
| `npm run test:sql` | 实际本地 D1 的 SQL 读写、规模增长和执行耗时 | 查询、索引、认证或轮询变化 |
| `npm run audit:architecture` | 基于源码结构的架构审计 | 模块划分或依赖调整，结果需结合代码评审 |

按需工具可在 GitHub Actions 的 **Optional test tools** 工作流选择分支和工具运行；它只执行诊断并保存报告，不发布、不读取远程数据库。默认 CI 仍保留迁移文件指纹检查，实际 Preview 发布前仍执行已有的迁移演练。历史迁移测试并未删除。

本轮删除了固定像素、边框、动画帧、断点与 DOM 排列的浏览器断言，特定机型 UA/HAL 模拟下的固定镜头调用序列，以及绑定内部调用顺序的 `field-loading` mock 测试。它们把实现细节当成契约，页面重排或服务组合调整就需要同步维护；校区权限与看板内容由实际数据库服务测试和按需浏览器回归覆盖。语法检查交给 ESLint/TypeScript，`check` 专门验证 Functions 构建。需要验证视觉效果时，应做有明确设计基准的人工或图像验收，不用零散尺寸断言替代。

## 按需属性测试与业务状态图

`fast-check@4.10.2` 和 `xstate@6.0.0-beta.2` 是精确锁定的开发依赖；图工具使用 v6 自带的 `xstate/graph`。这两个模式用于按需检查，默认 `npm test`、`verify`、浏览器冒烟和发布 CI 均不启用，也不在默认路径加载这两个库。手动工作流 **Optional test tools** 提供 `models-node`、`models-browser` 和 `properties`，均归档模型报告。XState v6 当前使用 beta 版本，升级时须重新验证图遍历与实际业务断言。

| 命令 | 内容 |
| --- | --- |
| `npm run test:models:node` | 在现有 Node 用例内部执行确定性业务状态图 |
| `npm run test:models:e2e` | 完整浏览器回归，并启用现有页面流程的状态图 |
| `npm run test:models` | 依次执行以上两个入口 |
| `npm run test:properties` | Node 确定性状态图，加属性数据与可缩减的业务命令序列 |
| `npm run test:models:check` | 执行器回归：参数校验、失败缩减后精确重放、两类覆盖隔离与并发报告保存 |

业务模型沿用现有测试回调，在手动模式中运行更多路径或数据，不额外注册一套业务测试。执行器自身的回归位于 `tools/model-report.test.mjs`，仅通过 `test:models:check` 或上述手动工作流运行。默认浏览器门禁仍为 **6 项冒烟**。

同步最新 `dev` 后，保留私人查询凭证的显式签发与复制失败恢复、图片取消/校验/压缩、未保存草稿保护及登记资料持久化回归。继续移除没有视觉基准的尺寸、颜色、边框、图标数量和布局顺序断言，并删除主要重复这些断言的管理工具展示用例。拖放命中测试保留坐标操作，因为它验证真实拖拽事件能否进入接收区；它不要求固定像素布局。保修网点测试专注品牌保存后的链接变化，登记字段的完整校验由服务测试和登记流程覆盖。

`fixtures/workflow-seed.mjs` 承载共用执行器，模型和操作适配器保留在各自的现有测试/辅助文件中：

- 服务模型使用独立声明的有限状态和事件。`xstate/graph` 求最短前置路径，再逐条附加目标转换，因此自环、重放和拒绝操作也必须执行，不能只统计可达节点。
- 每条路径、每轮随机运行及缩减重试均重新建立 fixture，结束时释放数据库和模拟时钟。模型事件调用真实业务服务与 SQLite；上传及原厂网络边界复用可控响应，不访问真实厂商。
- 每一步检查实际业务状态与副作用。拒绝写入比较所有业务表的前后快照，包含审计和请求回执。原有并发争抢、事务失败、权限、隐私和幂等断言继续执行。
- 页面和部分已有长流程按原有顺序执行。状态图的转换表独立于执行步骤声明；删除或漏执行步骤不会同步缩小覆盖目标。各步骤包含真实操作和结果断言，最后检查全部声明的状态与边是否执行，并输出覆盖计数和 JSON 报告。
- ID、revision、次数和日期数值不进入图节点标识；过期版本、角色和校区通过有限事件场景验证。这里的全覆盖指已声明业务图的状态和事件转换，不等于生产代码分支覆盖，也不声称穷举所有输入组合。

### 模型与原有用例对应

| 模型 | 状态/转换与拒绝分支 | 原有测试位置（标题起始词） |
| --- | --- | --- |
| `booking-capacity` | 可预约、满额、超额、暂停、零容量、截止、缺少地点；恢复与调额 | `booking-slots.test.mjs`：availability distinguishes |
| `booking-reservation` | 创建、取消释放容量、满额拒绝、现场登记不占线上容量 | `booking-concurrency.test.mjs`：competing online bookings |
| `repair-lifecycle` | 接收、直接开始、跨日开始、交接、结束、更正、部分/完整补图、取消、过期；越校区、过期版本、原主修、无确认交接及终态拒绝 | `direct-repairs.test.mjs`：hardware staff can receive multiple orders |
| `availability`、`roster-cover` | 通常时间/周例外/恢复；发布/重放、双方邀请/接受/拒绝/取消、重新发布；版本与权限拒绝 | `weekly-schedule.test.mjs`：usual availability、publish without weekly questionnaires |
| `attendance` | 待签到、到场、缺勤、暂停；补记、恢复、重复补记及无权补记拒绝 | `duty-workflow.test.mjs`：absence is automatic |
| `account-activation` | 开放、撤销、申请待审、批准、拒绝、重新提交；未核验身份、无权审核、重复审核与已激活资格撤销拒绝 | `member-activation-defaults.test.mjs`：default activation uses |
| `membership-lifecycle`、`membership-transaction` | 任职生效、当日结束、导入预览、重新任职；组合任职原子写入与无效/重复/事务失败拒绝 | `member-end-date.test.mjs`：same-day end；`member-identities.test.mjs`：combined appointments |
| `retired-identity` | 普通/授予/撤销；权限与会话失效、无权授予及审计失败回滚 | `retired-elder.test.mjs`：only the current superadmin |
| `repair-link` | 未关联/已关联，确认与校区拒绝、重复关联拒绝、学生历史隐私 | `repair-links.test.mjs`：linking an existing booking |
| `intake-upload` | 空接收确认、选图、部分失败、刷新、重试与完整关联；复用已成功图片 | `intake-upload.test.mjs`：a refreshed partial receipt |
| `warranty-acer`、`warranty-huawei`、`warranty-lenovo` | 挑战/续期/过期、人工验证、结果/无结果/未知/失败及重试；会话不匹配、篡改、缺少证明与验证类型降级拒绝；保修截止日 | `warranty-captcha.test.mjs`：only a human；`warranty-huawei.test.mjs`：Huawei submits；`warranty-service.test.mjs`：server sends only |
| `ui-student-booking`、`ui-working-campus`、`ui-repair`、`ui-office-reception`、`ui-save-draft` | 预约与私人结果、校区切换/重载/会话重置、维修结束与更正、办公室接收、保存失败保留草稿与重试切换 | `e2e/core-workflow.spec.mjs` 中对应现有流程 |
| `ui-record-pagination`、`ui-refresh`、`ui-cancel-pagination`、`ui-schedule-draft`、`ui-session-isolation` | 筛选/恢复/分页、刷新失败保留数据、取消及晚到响应、原草稿版本、退出和权限撤销 | `e2e/records-loading.spec.mjs` 中对应现有流程 |
| `ui-signature`、`ui-onsite-signature`、`ui-deferred-photo` | 签名旋转/确认/空签拒绝/替换取消/保存，现场签名返回编辑，照片超时关闭后完成关联 | `e2e/signature.spec.mjs`；`e2e/photo-upload.spec.mjs`：manual supplementation |
| `ui-workload-refresh`、`ui-roster-conflict`、`ui-repair-link` | 加载失败后恢复，冲突草稿保留并重试，关联原因变更后重新确认 | `e2e/duty-workload.spec.mjs`：workload failure；`e2e/maintenance-affairs.spec.mjs`：planner retries；`e2e/repair-links.spec.mjs` |
| `ui-warranty-input`、`ui-warranty-captcha` | 摄像头拒绝后手动输入、关闭清空，人工验证码等待/换码/查询 | `e2e/diagnostics/warranty-lookup.spec.mjs`：denied camera、Acer waits |

属性数据覆盖预约日期、容量守恒、TSV 格式与填充周期、签名采样、序列号字符保真、周边界、真实 SQLite 聚合和保修起止日。预约竞争随机化容量与提交人数。其余可重复执行的服务模型使用 `fc.commands` / `fc.asyncModelRun` 生成并缩减事件序列；预约容量和创建模型的随机输入由同一原有用例中的数据属性负责，不重复运行另一套随机断言。页面只走确定性路径。

### 预算与失败重放

默认纯函数属性每项 100 轮；服务序列、预约竞争和 SQLite 统计每项 30 轮，命令序列最多 20 步。以下环境变量只影响手动属性模式：

| 变量 | 含义 |
| --- | --- |
| `FC_NUM_RUNS` | 正整数，覆盖当前属性的轮次 |
| `FC_MAX_COMMANDS` | 正整数，覆盖每条命令序列的最大长度 |
| `FC_SEED` | 有符号 32 位整数；未指定时由 fast-check 选择 |
| `FC_PATH` | 失败日志提供的缩减路径，由冒号分隔的非负安全整数组成；必须同时设置 seed，并只选择一个原有测试用例 |
| `FC_REPLAY_PATH` | `fc.commands` 反例中的 `replayPath` 原始值，不含引号及 `replayPath=`；必须同时设置 seed 和 path，只用于命令模型。允许空日志 `:`，拒绝空字符串、非法字符和不匹配的编码长度 |

```sh
FC_NUM_RUNS=100 FC_MAX_COMMANDS=50 npm run test:properties

# 将三个值替换为同一次失败报告中的值，保留当时的运行预算。
FC_SEED=123456 FC_PATH='0:1:0' FC_REPLAY_PATH='AAC:B' \
  npm run test:properties -- --test-name-pattern='publish without weekly questionnaires' tests/weekly-schedule.test.mjs
```

PowerShell 中先设置 `$env:FC_SEED='123456'`、`$env:FC_PATH='0:1:0'`、`$env:FC_REPLAY_PATH='AAC:B'`，再执行相同的 npm 命令；结束后用 `Remove-Item Env:FC_SEED, Env:FC_PATH, Env:FC_REPLAY_PATH` 清理。所有 npm 模型入口通过 Node 设置开关，兼容 Windows 和 Linux。

命令序列的 `path` 与 `replayPath` 是两个不同参数：前者传给 `fc.check`，后者传给 `fc.commands`。重放应使用相同代码、锁定的依赖、`FC_NUM_RUNS` 和 `FC_MAX_COMMANDS`；执行器要求一个测试文件及 `--test-name-pattern`，标题需要定位唯一属性。普通数据属性只设置 seed/path，传入 `FC_REPLAY_PATH` 会明确报错，避免被静默忽略。

失败保留 fast-check 的 seed、path、replayPath 和缩减后的最小反例/命令序列；模型错误额外注明模型名、起始状态、事件和目标状态。不要用重跑成功替代修复，不把真实业务缺陷改成模型预期。基础设施发布、历史迁移和埋点诊断继续使用原来的验证方式。

### 模型报告

每次 npm 模型入口创建独立的 `output/model-reports/<运行标识>/model-report.json`，终端输出完整路径；`test:models` 将 Node 和浏览器结果写入同一份报告。手动 Actions 在成功或失败时均归档 `output/model-reports/`。当前交付为结构化 JSON，包含状态与转换定义，可供后续生成离线 HTML；没有部署报告网站。

- 每个模型包含状态/转换总数、具体定义、来源、浏览器项目、执行状态，以及独立的 `deterministic` / `random` 覆盖记录。`visitedStates`、`visitedTransitions` 是实际通过业务断言的集合，覆盖率为 0–1；失败的边不计入覆盖。空随机序列只计入已经观察成功的初始状态。
- 确定性 `runs` 是前置路径加目标边的执行次数；随机 `runs` 来自 fast-check，`attempts` 包含生成与缩减尝试，`steps` 只统计断言通过的转换。随机覆盖包含这些尝试实际访问的状态/边，完全不混入确定性覆盖。确定性全覆盖不表示随机探索充分，也不设置随机全覆盖硬门槛。
- 随机结果保存预算、实际 seed、fast-check 丢弃轮次与缩减次数，失败时保存 `path`、`replayPath`、`counterexample` 和错误。`numSkips` 是属性轮次的丢弃数，不是命令前置条件未满足的次数。`replay` 字段另外记录本次输入的重放参数。数据属性结果保存在顶层 `properties` 中。
- 未启用随机模式标记为 `not-requested`；页面模型和已有单路径模型标记为 `not-supported`。这类模型没有随机探索率的成功结论。
- 并行进程各写独立记录，执行器在子进程退出后汇总；同名浏览器模型按项目和调用实例保留，不会相互覆盖。测试失败保留已完成部分并返回非零。若强制终止整个执行器，尚未汇总的 `entries/*.json` 仍可用于诊断，不能把 `running` / `incomplete` 记录视为通过。

直接使用 `TEST_MODELS=1 node --test ...` 时可设置 `MODEL_REPORT_DIR` 保存单项记录；需要汇总 JSON 时使用 npm 入口。`MODEL_REPORT_ROOT` 可调整 npm 入口的报告父目录，默认为 `output/model-reports/`。

## SQL 读写与性能诊断

```sh
npm ci
npm run test:sql
```

工具使用临时 Miniflare/workerd D1，应用当前全部迁移，随后调用真实仓储和 HTTP 路由。数据为虚构的 100 / 1,000 个账号及 2,001 / 20,001 条预约，包含有效任职、历史预约和同日其他校区记录。目标账号和目标校区的业务量不变，专门检查无关数据增长是否导致读取成本增长。

覆盖单账号读取、普通成员与领导的 `/api/auth/me`、指定校区的预约余量和注销写入。每种规模重复三次，每次都检查预算；报告包括 SQL 文本、语句数、`meta.rows_read`、`meta.rows_written`、D1 执行毫秒数和本地 SQL 调用耗时合计的中位数。初始化、迁移、客户端令牌准备及反例不计入业务预算。报告保存在 `output/sql-profile/report.json`，失败也保留已完成部分；工具退出非零即表示失败。

读写行数使用宽裕的上限，并要求大数据集读行数不超过小数据集的 `2 倍 + 32`。这允许小范围实现调整，同时能发现全局扫描。预算位于 `tests/tools/sql-performance.test.mjs`。增加场景时通过同一个 `sqlProfiler` 执行真实服务；不要复制生产 SQL 当作业务场景，也不要自动接受新的预算。逐条 SQL 能帮助区分调用次数增加和单条扫描成本增加。

`first()` 原生返回值不带 meta，工具将其转换为一次 `all()` 并保留首行语义；`batch()` 按返回的每条语句统计，不重复查询。缺少计数元数据会报错。该适配器仅用于本地诊断，不改生产数据库包装器。

工具还执行两个隔离反例：issue #144 中从全局 `staff_access_campuses` 视图取单账号权限的查询，以及没有过滤条件的全账号 UPDATE。两者必须被同一套预算检测出超限，否则工具自身失败。正常场景超限始终失败，不因反例被检出而放行。

耗时仅作诊断信息，不设毫秒硬门槛，避免 CI 机器负载造成波动。本地 workerd 数据不能直接等同线上计费或请求延迟；线上数据分布、运行版本和流量仍需结合 D1 Analytics 核实。评估轮询时可用“单次 rows_read × 每小时请求数 × 活跃会话数 × 活跃小时数”估算该接口的日读取，再合计其他接口和环境。
