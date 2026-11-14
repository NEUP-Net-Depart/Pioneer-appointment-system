# 全站分析与错误排查（PostHog + Cloudflare Pages）

前端使用 PostHog 做产品分析、漏斗、热力图、会话回放、网页性能和异常分组；Cloudflare Analytics Engine 保留 API、D1、R2 和原厂接口汇总，Pages 保留结构化实时日志。无需新 Worker、数据库迁移或通知服务。浏览器直接访问 PostHog，不通过 Pages Functions 反向代理。

## 首次配置

在 PostHog Cloud 创建项目，选择 US 或 EU。将下列配置放在 GitHub 仓库 **Settings → Environments → production**，然后按现有流程发布 main。工作流已经传递这些变量，不需要把它们重复写入 Cloudflare Pages 运行时配置。

| 类型 | 名称 | 配置值 |
| --- | --- | --- |
| Variable | `POSTHOG_PROJECT_TOKEN` | PostHog 项目的公开 Project Token（通常以 `phc_` 开头） |
| Variable | `POSTHOG_HOST` | US：`https://us.i.posthog.com`；EU：`https://eu.i.posthog.com`。省略默认 US |
| Variable | `POSTHOG_ENABLED` | `true`；Production 有 token 时默认启用，未配置 token 则不加载 SDK |
| Variable | `POSTHOG_PROJECT_ID` | 同一项目的数字 Project ID，用于 source maps |
| Secret | `POSTHOG_PERSONAL_API_KEY` | Personal API Key，授予 Error Tracking Write 和 Organization Read，用于构建上传 source maps |

Project Token 与 Personal API Key 用途不同。只有公开 token、接收地址、采样配置、环境和提交版本写入浏览器配置；Personal API Key 只用于 CI 构建。source maps 上传地址按所选区域自动使用 `https://us.posthog.com` 或 `https://eu.posthog.com`。

PostHog 控制台还需配置：

1. 在项目设置开启 Autocapture、Session Replay、Heatmaps 和 Web Vitals。
2. Session Replay 选择全部会话，取消 URL、事件和 feature flag 录制触发条件，将最短时长设为 0。应用默认回放采样率为 **100%**，但控制台的录制总开关和触发条件仍然生效。
3. Error Tracking 接收应用调用 `captureException` 上报的异常。应用自己统一捕获运行错误、未处理 Promise、React 边界、资源/模块失败、HTTP 5xx、网络失败和超时，因此关闭 SDK 重复的全局异常监听；不是关闭 Error Tracking。
4. 发布后在 Live Events、Session Replay、Error Tracking 检查实际数据；在 Error Tracking 的 Symbol Sets 检查当前提交的 source maps。

Preview、本地默认不采集。需要验收 Preview 时，在 GitHub `preview` Environment 配置同样的变量，并明确设置 `POSTHOG_ENABLED=true`；验收后恢复 `false`。免费计划只有一个项目时，用 `environment` 区分 production/preview，报表默认筛选 production。本地只需在启动构建的 shell 中设置公开 token、host 和 `POSTHOG_ENABLED=true`；`.dev.vars` 是 Functions 配置，不会自动注入前端构建。

## 默认采集与开关

| 配置 | 默认 | 作用 |
| --- | --- | --- |
| `POSTHOG_INTERACTIONS` | `true` | 自动点击/表单、热力图、无效点击、显式控件事件 |
| `POSTHOG_REPLAY_ENABLED` | `true` | 会话回放，含控制台日志、网络时序和 canvas |
| `POSTHOG_REPLAY_SAMPLE_RATE` | `1` | 录制 100% 会话；可设置 0–1，仅影响回放 |
| `TELEMETRY_ENABLED` | Production `true`、Preview `false` | Cloudflare 后端指标及自有实时日志总开关，与 PostHog 分开 |
| `TELEMETRY_SAMPLE_RATE` | `1` | 常规 API 汇总采集比例 |
| `TELEMETRY_POLL_SAMPLE_RATE` | `0.01` | Cloudflare 成功后台 GET 轮询采集 1%；异常和拒绝始终保留，不影响 PostHog 交互或回放 |
| `OBSERVABILITY_LOGS` | `true` | 输出已保留的结构化后端实时日志 |
| `CF_WEB_ANALYTICS_TOKEN` | 空 | 可选的 Cloudflare Web Analytics 公开站点 token |

上述变量在 GitHub 对应 Environment 配置后重新发布生效。如之前显式设置了 `TELEMETRY_POLL_SAMPLE_RATE=1`，请改为 `0.01` 或删除覆盖值，以使用仓库默认值。环境和版本由部署流程注入。PostHog 没有普通事件抽样、每日批次上限或重复事件合并；SDK 负责批量发送、失败重试和页面离开时尽力发送。SDK 的每秒 100 条、突发 1,000 条限制只用于防止失控循环；初始本地 SDK 模块加载期间缓冲最多 1,000 次调用，模块加载失败则丢弃缓冲，不阻塞业务。不能保证网络断开、浏览器终止或广告拦截时仍完整送达。

新前端不再使用 `/api/telemetry`。旧接口暂时保留给尚未刷新的旧页面，沿用单批 20 条/16 KiB、同源 JSON、每 IP 每实例每分钟 6 批普通事件和 2 批错误的限制；后续旧部署退出使用后再删除。这些旧保护不限制 PostHog。`TELEMETRY_INTERACTIONS` 也仅影响旧采集路径。

紧急关闭：前端设置 `POSTHOG_ENABLED=false` 并重新发布；回放可立即通过 PostHog 项目录制总开关停止，再发布 `POSTHOG_REPLAY_ENABLED=false`。后端单独设置 `TELEMETRY_ENABLED=false`。已打开的页面仍持有旧构建配置，需刷新；控制台配置传播也有延迟。

可选 Web Analytics：在 Cloudflare 添加站点，使用手动 token 接入，并关闭控制台自动注入以避免重复。它提供独立访问概览，业务分析以 PostHog 为准。构建仅在启用 PostHog 时，为学生端和 staff CSP 增加所选区域的接收域、SDK 资源域及 `worker-src blob:`，保修 iframe 的来源限制保持独立。

## 事件与身份

学生原生 JS 与工作人员 React 使用同一个本地 SDK bundle `/assets/posthog.js`；同一文档通过共享实例避免重复初始化。普通 DOM 交互交给 PostHog 自动采集，保留现有 `data-track`，可以通过元素属性筛选，不依赖易变的文案。

| 事件 | 含义 |
| --- | --- |
| `$pageview` / `app.view` | 页面与虚拟页面切换；前者用于 PostHog 原生访问/热力图，后者用于业务导航分析，报表选一种口径 |
| `$autocapture` | 点击、表单提交和字段变化，含元素属性和稳定 `data-track` |
| `ui.change/invalid/toggle/dialog` | 自定义选择器提交、校验拒绝、折叠/弹窗/帮助提示开闭；SDK 加载前的点击也有 `ui.*` 补充 |
| `flow.step/result` | 预约、私人链接导入、照片、扫码/OCR、维修、保修、排班、考勤、人员、权限、配置、导入导出等业务步骤与请求结果 |
| `$exception` | 原始前端异常和堆栈，补充 `errorCode`、`requestId`、`view`、`release`、`environment` |
| `$snapshot` / `$web_vitals` | SDK 会话回放与网页性能数据 |
| `api.request`（Cloudflare） | 一次 API 请求的状态、耗时和 D1/R2/上游汇总 |

每次事件独立送入 SDK，保留发生顺序和各自请求 ID；不再将重复点击合为 `count`。同一个 Error 对象只上报一次；同一请求 ID 在 API 桥接与全局边界重复捕获时也只上报一次。主动取消单列 `flow.result/cancelled`，不会进入异常列表；超时仍是异常。HTTP 4xx 以拒绝结果记录，HTTP 5xx 同时进入 Error Tracking。JSON 与照片上传请求附带服务端 `errorCode` 和 `failureFields`（字段名），同一次请求只记一个 HTTP 结果；成功的流式下载保持原有读取方式。

SDK 持久化键按项目 token、环境和 `surface=student/staff` 隔离，包括身份、设备及录制会话；同一浏览器跨标签页访问两端、刷新或工作人员退出均不会把学生操作归给工作人员。切换到独立持久化键后，旧共享身份不迁移，首次访问会生成新的匿名身份；跨发布版本比较独立访客数时需考虑这一变化。学生使用 SDK 匿名浏览器身份；工作人员取得 profile 后以 `staff:<memberId>` 识别，携带 role。登录尝试、退出和认证失效会重置身份及设备 ID，避免共用终端串号。匿名浏览器数量不等于真实人数，业务成功仍以服务端已提交的数据为准。点击、提交、HTTP 重试、前端收到结果是不同阶段，不能相加当作业务数量。

详情页直接进入、刷新和私人链接导入只记录实际的 `student.detail`，不把加载期间的列表容器记作一次 `student.lookup`；返回列表时才记录 lookup。虚拟页面继续显式记录；自定义 Select、日期/时间选择器、键盘操作、Portal 弹窗仍保留语义埋点。新自有控件继续分配稳定 ID，运行 `npm run telemetry:catalog` 更新目录，CI 用 `telemetry:check` 防止遗漏。验证码子站的内部第三方页面无法穿透采集，仍由经过 origin/source/nonce 校验的消息边界记录 start/ok/error/cancelled。

本次没有新增自定义脱敏层，PostHog 使用 SDK 默认采集行为；现有业务事件目录及 Cloudflare 字段白名单继续使用。前端异常保留原始消息和堆栈，以便 PostHog 分组和定位。

## Source maps

构建生成 Vite 与共享 SDK 的 source maps。配置完整上传凭据时，`@posthog/cli` 注入 chunk/release 信息并上传到同一 PostHog 项目，版本为 Git 提交；第三方上传失败、CLI 启动失败、超时或凭据不全只在构建日志中告警，继续发布预约系统。每个 CLI 步骤最多等待 30 秒，注入失败后跳过上传；未配置上传凭据时跳过。失败版本的压缩堆栈可能无法还原，可在修复上传配置后的下一次构建核对 Symbol Sets。

无论上传、跳过或失败，构建都会删除部署目录内 `.map` 和 sourceMappingURL 引用。部署目录本身无法清理属于本地构建错误，仍会使构建失败，防止遗留映射被部署。学生端和 shared 原生 JS 本来就直接发布源码，不需要额外的反混淆映射。Cloudflare 服务端 source maps 继续由 Wrangler 上传，和 PostHog 的前端映射相互独立。

## 免费额度与用量

截至 2026-11-13，PostHog 每月免费 100 万条分析事件、5,000 次回放、10 万条异常；免费计划超额后停止接收并丢弃超额数据，额度按组织共享。免费事件保留一年、回放保留一个月。若开启付费，按产品设置 $0 billing limit 可避免超出免费用量产生支出，仍需留意项目账单设置。

以每日 100 人、每人一次会话估算，每月约 3,000 次回放；若每人每天两次会话则约 6,000 次，不能只用人数保证低于录制额度。100 万条事件对应 3,000 次会话时，平均每次约 333 条。默认优先完整采集，先看实际 Billing / Usage，接近额度再调整回放比例或关闭非必要事件，不预先降低采样。

Cloudflare Workers/Pages Functions 共享 100,000 次请求/日；Analytics Engine 公布免费 100,000 次写入/日、10,000 次查询/日（文档仍说明尚未开始收费）。一个业务请求至多写一个分析点；健康检查和旧采集端自身不写请求汇总。前端直接上报 PostHog，不消耗本项目 Functions 请求和 Analytics Engine 写入。默认 AE 每日写入约为「主动成功请求数 + 所有失败/拒绝请求数 + 成功后台轮询数 × 1%」，另加少量旧页面事件；已保留的后台轮询带 `sampleWeight=100`，查询必须应用该权重。不同项目与 Preview 仍共享账户用量，这不是账户级硬上限。

## 看板与排错

PostHog 报表筛选 `environment=production`：

- 页面使用：`app.view` 按 `view` 分组；不要和 `$pageview` 相加。
- 转化漏斗：筛选 `surface=student`，用 `flow.step/result=start` 表示进入步骤，以 `flow.result/control=booking.submit/result=ok` 表示前端确认预约成功；`reason=CREATED/RECOVERED` 区分提交成功与幂等查询恢复。`booking.submit/result=start` 是提交尝试，不能当作新预约数。带 `route` 的 HTTP 结果用于请求分析，不与业务完成事件相加。按人或会话计算漏斗，业务记录总量仍看现有业务统计。
- 流失原因：`flow.step/result=rejected` 按 `control/reason` 分组。`FIELD_REQUIRED/FIELD_INVALID` 附带 `missingFields/invalidFields/failureFields`，区分必填缺失和格式/长度错误；协议及签名分别在字段列表中。照片有 `PHOTO_PREPARING/PHOTO_PREPARATION_FAILED`；时段有 `SLOT_SELECTION_REQUIRED/SLOT_UNAVAILABLE/AVAILABILITY_REFRESH_FAILED`；公告为 `NOTICE_UNACCEPTED`。最终提交失败查看 `booking.submit` 的业务错误码或 `OUTCOME_UNCONFIRMED`。这些事件只在尝试前进或提交时记录，不逐次输入上报校验错误。
- 交互：`$autocapture` 按元素 `data-track` 筛选；自定义选择结果查看 `ui.change`，弹窗查看 `ui.dialog`。
- 异常：Error Tracking 按 release/errorCode/route 筛选，通过 requestId 对照 Cloudflare；从异常跳转关联会话回放。
- 性能：Web Analytics / Web Vitals，以及回放中的网络瀑布；后端耗时使用 Cloudflare 请求与依赖汇总。

Cloudflare 账户需先在 **Workers & Pages → Analytics Engine** 开通服务，再发布启用后端分析的环境；未开通时，Cloudflare 会拒绝含 `ANALYTICS` 绑定的部署。暂不启用时，在对应 GitHub Environment 设置 `TELEMETRY_ENABLED=false`：部署脚本会从临时发布配置中移除这个绑定，不影响 PostHog。Preview 默认关闭，因而无需先开通该服务即可发布；验收后端分析时先开通，再设置 `TELEMETRY_ENABLED=true`。

Cloudflare 绑定 `ANALYTICS`，Production 数据集 `pioneer_telemetry_production`，Preview 数据集 `pioneer_telemetry_preview`。绑定随现有部署发布，首次写入自动建数据集；账户需开通可用的 Analytics Engine。不会为遥测读写 D1、R2 或 KV。

```bash
npx wrangler pages deployment tail --project-name pioneer-appointment-system
npm run telemetry:query -- --query errors --hours 24 --print
npm run telemetry:query -- --query latency --hours 24
npm run telemetry:query -- --query dependencies --hours 24
npm run telemetry:query -- --query volume --hours 24
```

只读查询需要 `CLOUDFLARE_ACCOUNT_ID` 和具有 Account Analytics Read 权限的 `CLOUDFLARE_ANALYTICS_API_TOKEN`。每次脚本只发一条 SELECT，`--print` 离线输出 SQL，不做自动轮询。原有 `interactions/funnel` 模板仍可查迁移前历史数据；迁移后的前端漏斗/交互在 PostHog 查询。

Pages 项目的 Metrics 查看请求量及平台错误；实时日志仅在打开流时可见，不提供持久化 Workers Observability / Issues。CPU 超限、进程终止、首屏 JS 完全无法启动等故障可能来不及上报，要结合平台指标；Free 单次 CPU 上限仍为 10 ms，仓库已有 cpu_ms 设置不会提高免费套餐实际限制。

Analytics Engine 数据保留三个月，存在平台抽样。即使应用采样率为 1，也不能把 AE 当作精确审计账本。D1 行数只使用现有返回元数据，不补查；R2 耗时只到取得响应流，不读取整个文件计算耗时。

## 列映射（schema 1）

所有数据点的 `blob1` 为 `1`；`index1` 为事件名加路由/页面。新增或调整列含义必须升级 schema 并同时更新查询。`timestamp` 是 Cloudflare 接收时间。

| 列 | 含义 |
| --- | --- |
| blob2–blob6 | 事件名、路由 ID、页面、控件/步骤、结果 |
| blob7–blob10 | 请求 UUID、异常类型、异常代码、安全代码位置 |
| blob11–blob15 | 服务端环境、服务端提交、客户端提交、HTTP 方法、依赖失败类别 |
| double1–double4 | 合并次数、总耗时 ms、HTTP 状态、应用采样权重 |
| double5–double10 | D1 调用次数、耗时、已观察读行数、写行数、含完整行数元数据的结果数、失败调用次数 |
| double11–double13 | R2 调用次数、耗时、失败次数 |
| double14–double16 | 原厂请求次数、耗时、失败次数 |
| double17 | 应用事件时间，Unix 毫秒 |

计数用 `SUM(double1 * double4 * _sample_interval)`，请求延迟用相同权重计算平均值与分位数。写入量估算只使用 `_sample_interval`，不能乘应用采样权重。合并交互的耗时是总和，不用于请求 p95。

D1 `.first()`/`.raw()` 没有行数元数据，记录调用与耗时但不补查；批量调用算一次调用，批内每个含元数据结果分别计数，所以 double9 可能大于 double5。读写行数是已观察部分，不是 D1 总用量或完整覆盖率。R2 下载耗时测到返回流，未读取完整文件计算耗时。

## 验收与维护

`npm run verify` 保留后端故障隔离/限流/响应流、事件顺序/请求 ID、异常去重/取消分类、环境隔离、两端身份隔离、业务失败原因、导航计数及真实 SDK 浏览器验收。浏览器拦截外部 PostHog 请求和 SDK 扩展资源，不向真实项目上传测试数据。旧前端队列/每日限额测试已删除，重复的人员业务场景测试不再在遥测套件重跑。

上线人工验收检查：CSP 无拒绝、自动点击与业务事件都存在、回放含操作过程、异常能关联请求 ID、Symbol Sets 有当前提交，Preview 和 Production 可区分。保持 PostHog 项目本身的录制设置与应用开关一致。

官方依据：[PostHog 定价](https://posthog.com/pricing)、[SDK 配置](https://posthog.com/docs/libraries/js/config)、[Source maps CLI](https://posthog.com/docs/error-tracking/upload-source-maps/cli)、[Cloudflare 代理请求消耗](https://posthog.com/docs/advanced/proxy/cloudflare)、[Pages 日志](https://developers.cloudflare.com/pages/functions/debugging-and-logging/)、[Pages 免费额度](https://developers.cloudflare.com/pages/functions/pricing/)、[Analytics Engine 定价](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)、[保留期和限制](https://developers.cloudflare.com/analytics/analytics-engine/limits/)。
