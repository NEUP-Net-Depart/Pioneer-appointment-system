# 全站分析与错误排查（Pages / Free）

本系统保留 Cloudflare Pages。Web Analytics 提供访问量、来源及 Core Web Vitals；Analytics Engine 保存经过白名单处理的交互、请求和错误摘要；Pages Functions 提供实时日志。没有新 Worker、通知服务、数据库迁移或遥测数据库。现有业务审计和业务统计不变。

## 启用与关闭

Production 默认启用自有遥测，Preview 默认关闭。首次发布前在 Cloudflare 账户确认可用的 Analytics Engine 功能；绑定随 Pages 配置发布，首次写入自动创建数据集。绑定名 `ANALYTICS`，Production 数据集 `pioneer_telemetry_production`，Preview 数据集 `pioneer_telemetry_preview`。本地不连接远程数据集。

Web Analytics 在 Cloudflare 的 Web Analytics 页面添加站点，选择手动 JS 接入，将公开站点 token 配为对应 GitHub Environment 的变量 `CF_WEB_ANALYTICS_TOKEN`。不要把 Cloudflare API token 当作站点 token。关闭 Pages 自动注入；应用也会检查已有 beacon，避免重复加载。浏览器只接收该公开 token、环境、提交版本及采集开关。`spa:false` 避免将虚拟页面重复计为完整页面浏览，虚拟页面使用自有 `page.view` 事件。CSP 只增加 Cloudflare beacon 的接收来源。

下列 GitHub Environment 变量在既有发布流程中同时作用于构建和 Pages 配置。空值沿用仓库默认值；修改后重新发布并刷新浏览器。普通功能分支仍不迁移共享 Preview。构建脚本使用目标环境，不能仅修改根配置而误启用所有 Preview。

| 变量 | Production 默认 | Preview 默认 | 用途 |
| --- | --- | --- | --- |
| `TELEMETRY_ENABLED` | `true` | `false` | 总开关，关闭后不写分析点和自有日志 |
| `TELEMETRY_INTERACTIONS` | `true` | `true` | 关闭 `ui.*` 交互，保留页面、业务结果和错误 |
| `TELEMETRY_SAMPLE_RATE` | `1` | `1` | 常规请求及浏览器事件组保留比例，0–1；错误和拒绝请求优先保留 |
| `TELEMETRY_POLL_SAMPLE_RATE` | `0.01` | `0.01` | 成功的后台 GET 刷新保留比例，0–1 |
| `OBSERVABILITY_LOGS` | `true` | `true` | 输出已保留事件的结构化实时日志 |
| `CF_WEB_ANALYTICS_TOKEN` | 空 | 空 | 公开站点 token，未配置时不加载 beacon |

`TELEMETRY_ENVIRONMENT`、`TELEMETRY_RELEASE` 由发布流程设置；浏览器不能指定服务端环境或提交版本。需要本地调试时，构建使用 `TELEMETRY_ENABLED=true npm run build`，并在本地 `.dev.vars` 中设置 `TELEMETRY_ENABLED=true`、`OBSERVABILITY_LOGS=true`；不配置远程 Analytics Engine。关闭本地调试后重新以默认参数构建。

紧急关闭：将对应发布环境的 `TELEMETRY_ENABLED` 改为 `false` 后按现有流程重新发布。只修改控制台运行时变量不能更新已下载的前端配置；旧页面可能继续发出有限上报，服务端会丢弃。需要保留诊断而节省容量时，先关闭交互或调低普通事件采样率。

## 记录内容与覆盖

所有自有原生控件使用固定 `data-track`，HTML 模板和动态创建控件也有显式标识。标识描述代码位置，不包含文本、用户输入、业务记录编号或人员身份。新控件必须补标识，然后运行 `npm run telemetry:catalog`；`npm run telemetry:check` 检查原生控件、共享 JSX 控件、ARIA 交互角色与路由目录。已经存在的控件 ID 不重排，API 路由 ID 按固定模式生成，插入其他路由不会改变它。

`Select`、日期/时间选择器、校区选择、帮助提示和刷新按钮在每个调用位置传入固定 `data-track`。共享组件只通过 `controlPart` 派生目录中预定义的部件标识；Portal 弹层也携带所属字段标识，不从选项值、标签或日期生成 ID。自定义选择回调显式记录一次 `ui.change`；点击、选择结果与弹层开闭是不同事件。列表弹层及帮助提示（含键盘聚焦、悬停、Escape 关闭）使用 `ui.toggle`。时间数字的连续滚轮/键盘调整在 250 ms 无操作后记一次，拖动在结束时记一次，队列再按原规则合并；不记录每帧移动或具体时间值。

组合新增任职的空选择拒绝在前端记录 `flow.result/rejected`，成功仍按一次 HTTP 请求计量。一次请求可新增多项任职，不能把请求数当作新增任职条数。

| 事件 | 含义 |
| --- | --- |
| `page.view` | 学生页面、工作人员页面与工作场景切换 |
| `ui.click/change/submit/invalid/toggle/dialog` | 点击（含原生键盘激活）、字段改变、表单提交、原生校验拒绝、折叠及弹窗开闭；不记录值 |
| `flow.step/result` | 预约步骤、私人链接导入、照片压缩、扫码/OCR、验证码集成及前端收到的接口结果 |
| `api.request` | 服务端请求完成，含路由、状态、耗时及依赖汇总 |
| `client.error` | 运行异常、Promise 拒绝、React 边界、模块/资源/网络失败及超时 |

覆盖登录、预约、维修、附件、保修、排班、考勤、人员、权限、配置、导入和导出接口。普通后台刷新使用 `X-Telemetry-Poll: 1`。学生端定时器显式传递该标记；React Query 将已有数据且最近三秒没有交互的刷新视为后台刷新，初次加载和交互后的请求保留。这个分类是客户端提示，不是鉴权信息。

点击、HTTP 请求、前端收到结果是不同阶段，不可相加当作业务成功总数。API 重试、幂等回放也计为请求尝试；漏斗是阶段次数估算，不能据此宣称独立用户转化率。真实业务数量继续查询现有业务统计。

验证码子站只通过已验证 origin、frame source 和 nonce 的桥接消息传回 `start/ok/error/cancelled`。不接收第三方内部 DOM、验证码、proof、challenge、nonce 或序列号。子站保持纯静态，不增加 API 或 D1/R2 绑定。

异常只保留已知类型/错误代码及至多六个经过白名单检查的代码位置；不保存原始异常消息、请求体、响应体、Authorization、查询参数、URL fragment、设备序号、文件名、SQL 参数或业务记录 ID。无法安全识别的堆栈位置丢弃。服务端 source maps 随部署上传，前端 source maps 不公开部署。

每个 API 响应有 `X-Request-ID`，JSON 错误体也带同一 ID；前端抛出的 HTTP 错误带 `requestId`。仅复用格式正确的 UUID 请求头。业务请求体里的幂等 `requestId` 不受影响。错误合并组保存第一个请求 ID，表示一个定位样本，而不是组内每次错误的完整链路。

## 配额和丢弃行为

截至 2026-11-12，官方公布 Workers/Pages Functions 共享 100,000 次请求/日；Analytics Engine 含 100,000 条写入/日、10,000 次查询/日。静态资源不会触发本项目 Functions。Workers Free 每次调用 CPU 上限为 10 ms，仓库已有 `limits.cpu_ms` 设置不会提高免费套餐的实际上限。Analytics Engine 定价页目前注明尚未开始收费，本实现仍按公布的免费额度规划。

- 浏览器将相同维度的交互合并为次数，每 30 秒发送一批，最多 20 组、16 KiB；队列最多 100 组，错误优先于业务结果、页面和普通交互。
- 每个浏览器/来源按 UTC 日最多发送 120 批普通事件及 20 批错误。只在 localStorage 保存当天批次数，不保存事件、会话 ID 或用户 ID；存储不可用时退回页面内存。多标签页计数存在竞争，不是事务计数。
- 隐藏页面或离开时尽力发送；一次只发送一批，剩余事件可能丢失。离线时清空，发送失败不重试，不保留离线积压。
- 采集端按 CF-Connecting-IP 在单实例内限制每分钟 6 批普通事件，另留 2 批错误；内存最多 2048 个键。IP 仅用于临时限流，不写日志或分析数据。实例重启、分流、键淘汰都会重置部分限制。
- 一个业务请求最多一个分析点，依赖调用合并到该点；健康检查和采集请求自身不产生请求统计。错误、4xx 拒绝和依赖失败不受普通采样率影响。
- 缺少绑定、写入异常、超限、队列溢出和关闭采集均允许丢数据，不延迟或改变业务结果。写入为尽力而为；平台异步写入失败可能无法反馈给应用。

这些是浏览器和实例级保护，不是账户级全局硬上限，也不保证抵御恶意流量。即使拒绝上报，其 HTTP 请求仍消耗 Functions 次数。Production、Preview 和其他项目共享账户额度；不能用本实例计数推断账户剩余额度。

估算：每天新增 Functions 调用约为“实际发送批次数”；Analytics Engine 写入约为“保留的 API 请求数 + 接收并保留的事件组数”。例如 20,000 个主动请求、30,000 个成功轮询及 5,000 个事件组，在默认轮询比例下约写 25,300 点。批量发送仅减少 HTTP 次数，每个事件组仍是一条写入。

上线初期通过 Cloudflare 账户用量页面核对实际消耗，建议为业务和其他项目留出至少 30% 余量。接近 70,000 次 Functions 请求/日或本项目 50,000 个分析点/日时，关闭普通交互或调低采样率；这些是运维参考阈值，不是自动全局熔断。`volume` 查询是平台抽样后的写入量估算，不能作为精确计费账本。

## 查询与排错

Web Analytics 查看访问和性能；Workers & Pages → 当前 Pages 项目 → Metrics 查看 Functions 用量及平台错误。选定部署 → Functions 查看实时日志，或使用：

```bash
npx wrangler pages deployment tail --project-name pioneer-appointment-system
npm run telemetry:query -- --query errors --hours 24 --print
npm run telemetry:query -- --query latency --hours 24
npm run telemetry:query -- --query interactions --preview --hours 24
```

查询脚本从环境读取 `CLOUDFLARE_ACCOUNT_ID` 和 `CLOUDFLARE_ANALYTICS_API_TOKEN`，后者只需 Account Analytics Read，不进入浏览器、Pages vars 或仓库。每次调用只发一条预定义 SELECT；`--print` 完全离线。支持 `errors/latency/funnel/interactions/dependencies/volume`，默认 24 小时，最长 2160 小时。SQL 模板见 [queries.sql](queries.sql)，可以用于 Cloudflare SQL API 或已有查询工具；不新增应用内看板或自动轮询查询。

按路由、错误代码、服务端/前端提交版本及请求 ID 交叉定位。路由及控件字典见 [telemetry-catalog.js](../../shared/telemetry-catalog.js)。样本检索不保证能找到每条记录；Analytics Engine 会自动抽样，数据保留三个月，无法恢复完整事件顺序。

Pages 日志仅在打开流时可见，不持久保存。本方案没有 Workers Logs、Workers Issues 或分布式 trace 存储。CPU 超限、进程终止、首屏脚本完全无法启动等故障可能来不及进入应用采集，须结合平台错误指标和实时日志。原生平台日志可能包含请求元数据，其格式和采集范围不受应用的自有字段白名单控制。

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

`npm run verify` 包括目录覆盖、脱敏/限流/日期切换、无绑定和故障隔离、原生 D1 批处理及下载流、浏览器真实事件等测试。浏览器测试拦截采集请求，不连接 Cloudflare 或上传测试数据。Preview 人工验收时启用该环境开关，核对 CSP 无拒绝、beacon 仅一份、错误摘要和请求 ID 可查询，然后恢复默认关闭。保修验证仍须使用实际浏览器验证可信 origin/nonce 消息边界。

官方依据：[Pages 日志限制](https://developers.cloudflare.com/pages/functions/debugging-and-logging/)、[Pages 免费额度](https://developers.cloudflare.com/pages/functions/pricing/)、[Workers CPU 限制](https://developers.cloudflare.com/workers/platform/pricing/)、[Analytics Engine 定价](https://developers.cloudflare.com/analytics/analytics-engine/pricing/)、[保留期和限制](https://developers.cloudflare.com/analytics/analytics-engine/limits/)、[抽样权重](https://developers.cloudflare.com/analytics/analytics-engine/sampling/)、[Web Analytics 接入](https://developers.cloudflare.com/web-analytics/get-started/)。发布前核对官方政策是否变化。
