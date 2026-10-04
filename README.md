# 先锋硬件部维修预约系统 · Cloudflare MVP

一个 Cloudflare Pages 项目，同时托管两个独立前端和 `/api/*` Pages Functions。D1 保存业务数据，私有 R2 保存附件。用户免注册预约；工作人员使用应用自身的 JWT/RBAC 登录，不依赖 Cloudflare Access。

## 结构

```text
frontend/user/       用户 HTML、预约、查询、取消
frontend/staff/      工作人员 HTML、登录、维修、统计、账号管理
frontend/assets/     组织 Logo
shared/              公共 UI 工具、导航、附件、API、状态、时间和样式
functions/api/       Pages Functions 路由入口
src/routes/          请求解析、鉴权、输入校验、HTTP 响应
src/services/        预约、排队、附件、账号、统计、导出业务
src/db/              显式注入 D1 的异步 SQL 仓库
src/lib/             JWT、密码、联系方式加密、验证、响应工具
src/context.js       每次请求创建 D1 session、仓库和服务
migrations/          D1 SQL 迁移（schema 的唯一来源）
public/              _routes.json、_headers、404.html
scripts/             构建、初始化、部署和自检脚本
tests/              前端结构及真实 workerd/D1/R2 集成测试
wrangler.jsonc       Pages 项目、D1/R2 binding 和运行时设置
```

`npm run build` 生成唯一的 `dist/`：`index.html` 对应 `/`，`staff/index.html` 对应 `/staff/`，各自仅加载本端功能脚本。公共代码位于 `/shared/`。服务端源码、密钥和工具脚本不复制到公开目录。

页面入口固定为 `/` 和 `/staff/`，查询参数不切换前端。运行时只使用 Cloudflare bindings；schema 变化只通过显式 D1 migration，账号初始化只通过手动 seed 命令。Functions 不执行自动初始化、schema 变更、数据导入或历史数据重加密；账号改密仅由经过鉴权的管理 API 显式处理。

## 本地运行

需要 Node.js 22+，仅用于开发工具、测试和部署。生产请求在 Cloudflare Workers runtime 中执行。

```bash
npm ci
npm run setup:local
npm run dev
```

访问：

- 用户端：`http://127.0.0.1:8788/`
- 工作人员端：`http://127.0.0.1:8788/staff/`
- 健康检查：`http://127.0.0.1:8788/api/health`

`setup:local` 首次生成随机 `.dev.vars`，应用 D1 migration，初始化 `root001`、`root002`。密码保存在该文件的 `ROOT001_PASSWORD` / `ROOT002_PASSWORD`，不输出到日志。重复运行不会覆盖密钥或重置已有账号。

Wrangler 在 `.wrangler/` 中模拟 D1、R2 并保存开发数据；这是 Cloudflare 开发模拟器的数据，不是应用的本地存储实现。`.dev.vars`、`.wrangler/`、`dist/` 均不提交。修改前端源码后重新执行 `npm run build` 或重启 `npm run dev`；Functions 由 Wrangler 监听。

## 首次生产部署

### 1. 创建一个 Pages 项目及绑定资源

```bash
npx wrangler login
npx wrangler pages project create pioneer-appointment-system --production-branch main
npx wrangler d1 create pioneer-appointments
npx wrangler r2 bucket create pioneer-attachments
```

将实际项目名、D1 返回的 `database_id`、数据库名和 R2 桶名写入 `wrangler.jsonc` 顶层。binding 名必须保持 `DB`、`ATTACHMENTS`。保留 R2 私有访问，不开启公开桶域名；附件始终通过鉴权 API 获取。[Pages bindings 文档](https://developers.cloudflare.com/pages/functions/bindings/)

认证与加密使用 Workers 原生支持的 `node:crypto` / `node:buffer` API（不启动独立进程）。本实现保留 scrypt 密码哈希，设置 `nodejs_compat` 和 `limits.cpu_ms=1000`。生产使用可容纳此 CPU 预算的 Workers Paid 计划；不要通过降低哈希成本适配免费 CPU 限额。Pages Functions 使用 Workers 的计费与运行限制。[Functions 计费](https://developers.cloudflare.com/pages/functions/pricing/)、[Pages 运行限制配置](https://developers.cloudflare.com/pages/functions/wrangler-configuration/#limits)

### 2. 配置 Secrets

在该 Pages 项目的 Settings → Variables and Secrets 中，选择 Production，添加 **Secret**：

| 名称 | 要求 | 用途 |
|---|---|---|
| `JWT_SECRET` | 随机字符串，至少 32 字符 | JWT 签名、限流键 HMAC |
| `PII_ENCRYPTION_KEY` | 64 位十六进制随机值 | AES-256-GCM 联系方式加密 |

也可使用 CLI 交互写入生产 Secret：

```bash
npx wrangler pages secret put JWT_SECRET --project-name pioneer-appointment-system
npx wrangler pages secret put PII_ENCRYPTION_KEY --project-name pioneer-appointment-system
```

可在受信任终端生成两个**不同**的随机值，分别妥善保存：

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

不把 Secrets 放进 Wrangler `vars`、Git、前端变量或构建产物。运行时缺失密钥/绑定即拒绝服务，无默认密钥。`PII_ENCRYPTION_KEY` 必须长期备份；直接替换会使已有联系方式无法解密。JWT 密钥替换会使已有会话失效。

CI 部署时另设 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，授予 Pages、D1、R2 所需权限；这两个变量供 Wrangler 使用，不是应用运行时 Secret。

### 3. 迁移并初始化管理员

```bash
npm run db:migrate:remote
```

用本机环境变量提供两个不同的 16–128 位初始密码。PowerShell 示例：

```powershell
$env:ROOT001_PASSWORD = Read-Host 'root001 初始密码' -MaskInput
$env:ROOT002_PASSWORD = Read-Host 'root002 初始密码' -MaskInput
npm run db:seed -- --remote
Remove-Item Env:ROOT001_PASSWORD, Env:ROOT002_PASSWORD
```

其他 shell/CI 使用相同的环境变量名。脚本在本机生成 scrypt 哈希，通过 D1 执行插入；临时 SQL 随后删除。仅插入缺失 root，不覆盖现有密码；不提供公开的初始化 API。生产 root 密码不需要添加到 Pages Secrets。

### 4. 检查并发布

```bash
npm run verify
npm run deploy
```

`deploy` 校验真实 D1 ID → 构建 → 应用远程 migration → 将 `dist/` 和仓库根目录的 `functions/` 发布到同一个 Pages 项目的 `main` 分支。部署脚本不会创建第二个 Pages。请在项目根目录执行；不要只拖拽 `dist/` 上传，否则 Functions 不会一起部署。

采用 Pages Git 集成时，构建命令为 `npm run build`，输出目录为 `dist`，根目录为仓库根；D1 migration、root 初始化、Secrets 仍需单独执行。本仓库的 GitHub Actions 只运行自检，不自动发布。

### 5. 外部 DNS + 自定义子域名

例如使用 `repair.example.edu`，权威 DNS 继续保留在原服务商：

1. 在**同一个 Pages 项目**的 Custom domains 中添加 `repair.example.edu`。
2. 在外部 DNS 服务商新增 `CNAME`：名称 `repair`，目标 `pioneer-appointment-system.pages.dev`（按实际项目域名填写）。
3. 等待 Pages 校验域名并签发 HTTPS 证书，状态变为 Active；若原域名已有 CAA 限制，按 Pages 提示调整。
4. 用户访问 `https://repair.example.edu/`，工作人员访问 `https://repair.example.edu/staff/`，API 为同域 `/api/*`。无需修改代码、跨域配置或 Access。

必须先在 Pages 关联自定义域名，不能只添加 CNAME。这个方案使用**子域名**，不要求将整个 DNS zone 的 nameserver 迁到 Cloudflare，也不依赖根域名 CNAME flattening。[Pages 自定义域名官方说明](https://developers.cloudflare.com/pages/configuration/custom-domains/)

## Preview 环境

Preview 仍属于这一个 Pages 项目，但必须使用独立的测试数据资源：

```bash
npx wrangler d1 create pioneer-appointments-preview
npx wrangler r2 bucket create pioneer-attachments-preview
```

填写 `wrangler.jsonc` 的 `env.preview` 实际 ID/桶名，并在 Pages **Preview** 环境配置另一组 JWT/PII Secrets。初次部署前，设置测试用 root 密码环境变量，再执行：

```bash
npx wrangler d1 migrations apply DB --remote --env preview
npm run db:seed -- --remote --preview
npm run deploy:preview
```

发布脚本使用 `preview` 分支，并拒绝与生产相同的 D1 ID / R2 桶名。生产部署只依赖顶层资源；未配置 Preview 前不要发布非 main 分支。不要把真实预约资料复制到 Preview。

## 业务与安全约束

- 业务日统一由 `shared/time.js` 显式按 `Asia/Shanghai` 计算，包括日期窗口、星期、默认排队日、统计和账号创建日期。事件时间使用 UTC ISO 存储，展示时转换为上海日期，不截断 UTC 日期字符串。预约时间按 `Asia/Shanghai`；今天至第 3 天（含），仅周一至周四，19:00–20:00 / 20:00–21:00。每校区每时段 20 人。
- D1 通过 `env.DB` 显式创建请求级 `first-primary` session，再注入各仓库；无数据库 singleton。查询、计数、分组、排序、重复约束均在 D1 中执行，前端只绘制查询结果。CSV 使用每页 200 条的游标读取并流式输出。
- 编号保留校区 + 日期 + 流水号；单条 D1 INSERT 原子分配编号。唯一索引防止同一学生同日同时段跨校区重复预约；INSERT/UPDATE 触发器防超额，包括管理员恢复取消记录。
- `cancelled`、`no_show` 不占名额，其余状态按原规则占名额。修改容量需要同时更新 `shared/constants.js` 和新增 SQL 触发器迁移。
- 工作人员权限按 `student → technician → admin → superadmin` 递增。基础账号需授权为维修人员后进入工作台；管理者可将基础账号提升为维修人员，只有 root 能授予管理者权限。
- 维修人员仅能接待接单/待审核预约，处理自己的订单，并按状态流转规则修改；管理者可管理全部。D1 revision 条件更新防止并发抢单和写覆盖。
- JWT 有效期 8 小时；每次请求重新校验账号状态、角色和 token_version。退出、改密、停用、角色调整会撤销旧会话；删除账号保留维修历史。
- 联系方式在入库前 AES-256-GCM 加密；密码使用 scrypt。两个 root 受保护，不能通过管理 API 停用、删除或重置。
- 用户查询/取消/附件仍使用“预约编号 + 学号”。用户页请求不携带工作人员 JWT；工作人员会话仅保存在 sessionStorage，预约和账号列表仅保存在内存。
- 限流记录存放 D1，跨实例共享；采用 Cloudflare 提供的 IP 的 HMAC 值，不信任 X-Real-IP。每个 IP 分别计数：登录 20 次/15 分钟；预约查询、附件列表与下载共用查询额度 30 次/分钟；创建预约、修改状态共用写入额度 30 次/分钟；附件上传 15 次/分钟。
- `/api/live/summary` 的公开名额查询不写入 D1 限流表；个人排队查询先检查查询额度，凭证错误时计入查询额度，正常轮询不增加计数。用户预约页与查询页每 30 秒刷新实时信息，标签页隐藏时停止轮询，恢复可见后立即刷新。
- 附件支持 JPG、PNG、WEBP、PDF、UTF-8 TXT，单文件 5 MB；校验 MIME 和文件签名，D1 保存 R2 object key、元数据及容量记录。附件自上传起保留 180 天，访客和工作人员的列表、查询与下载均排除过期附件。下载携带安全响应头，CSV 防公式注入。
- 上传前在 D1 原子预留实际字节数并保存持久化对象记录；生产上限 8 GiB，Preview 上限 512 MiB。D1 与 R2 无跨服务事务：上传或元数据保存失败后补偿删除，确认 R2 删除后才释放额度；补偿失败和请求中断留下的预留会被清理任务重试。过期但尚未删除的对象继续占额度。没有公开删除 API 或公开 R2 URL。

## API

除访客入口外，使用 `Authorization: Bearer <JWT>`，前后端保持同源。

| 方法 | 路径 | 用途/权限 |
|---|---|---|
| GET | `/api/health` | 检查 D1 schema 与 R2 binding |
| POST | `/api/auth/login`、`/api/auth/logout` | 登录 / 撤销会话 |
| GET | `/api/auth/me` | 当前账号 |
| GET / POST | `/api/appointments` | 工作列表（q/campus/date/status SQL 筛选、counts 全量计数，基础账号仅本人）/ 访客创建 |
| GET | `/api/appointments/lookup?appointmentId=...&studentId=...` | 用户查询 |
| PATCH | `/api/appointments/:id/status` | 状态、接单、维修记录、用户取消 |
| GET / POST | `/api/appointments/:id/attachments` | 列表 / 上传 |
| GET | `/api/appointments/:id/attachments/:attachmentId` | 鉴权下载 |
| GET | `/api/live/summary` | date/campus/timeSlot 名额；凭证查询排队 |
| GET | `/api/stats/summary`、`/api/stats/fault-types` | admin+，range=7/30/all，day 可选 |
| GET / POST | `/api/users` | admin+，账号列表 / 新建基础账号 |
| PATCH / DELETE | `/api/users/:account` | 管理低于自身且非保护账号 |
| GET | `/api/export/appointments.csv` | admin+ 导出 |

附件上传 JSON 为 `{studentId, filename, mimeType, data}`，data 为标准 base64；工作人员凭 JWT 可省略 studentId。用户附件 GET 使用 `?studentId=...`。上传、附件列表和预约查询中的附件元数据包含 UTC ISO 格式的 `createdAt`、`expiresAt`，过期下载返回 404。错误为 JSON，常见状态：400 输入错误、401 会话失效、403 权限不足、404 不存在、409 冲突、413 请求体过大、415 类型错误、429 限流、507 附件存储空间已满。

## 附件容量与过期运维

`wrangler.jsonc` 中的非 Secret 变量 `MAX_R2_BYTES` 按实际字节数限额：生产 `8589934592`（8 GiB），Preview `536870912`（512 MiB）。可在对应 Pages 环境覆盖，必须是正整数十进制字符串且不超过 JavaScript 安全整数；非法值拒绝服务。未设置时默认 8 GiB，Preview 应保留自己的变量配置。

R2 Standard 的免费存储按账号共享的 10 GB-month/月计算，不是桶的硬配额；两环境当前上限合计约 9.13 GB。应用计数涵盖这两个桶中的已登记附件、未完成上传和补偿失败对象，不涵盖账号其他桶、此前账期用量或操作费用。不要绕过应用上传对象；存量孤立对象须在启用配额前核对。[R2 定价](https://developers.cloudflare.com/r2/pricing/)

### 已有项目上线顺序

1. 暂停附件上传，备份 D1，并将 R2 `appointments/` 下的 object key、实际大小与历史附件元数据比对。对已确认的历史孤立对象先备份并清理，修正大小不一致的记录。历史存储若已超过上限，应用会拒绝新上传，直到清理后有余量。
2. 对生产和 Preview 分别应用迁移，再部署新代码；沿用原代码的部署窗口必须保持上传暂停，避免旧版本绕过容量记录。
3. 启用下面的生命周期规则和 GitHub Secrets，先 dry-run 查看清理候选，再手动执行清理，核对 `storage_quota.used_bytes` 与 `attachment_storage` 中大小之和一致，最后恢复上传。

```bash
npm run db:migrate:remote
npx wrangler d1 migrations apply DB --remote --env preview
npm run deploy
npm run deploy:preview
```

新增迁移按原 `created_at + 180 天` 回填旧附件，已超过期限的附件上线后立即停止展示和下载。`storage_quota` 初始化包含全部旧附件；`attachment_storage` 同时记录 pending（上传预留）、complete（已保存元数据）、deleting（清理中/等待重试）对象，额度在对象记录删除时由 D1 触发器释放一次。上传补偿先原子标记 deleting 并移除可见元数据，再删除 R2 和释放额度，确保 D1 已提交但响应丢失时的补偿失败也能在下一次清理中重试。不要直接修改计数或删除这些表的记录来腾额度。

### R2 生命周期与每周清理

为两个桶的 `appointments/` 前缀增加 180 天删除规则；先查看已有规则，已有同名规则时核对并更新，保留其他规则：

```bash
npx wrangler r2 bucket lifecycle list pioneer-attachments
npx wrangler r2 bucket lifecycle add pioneer-attachments delete-old-attachments appointments/ --expire-days 180
npx wrangler r2 bucket lifecycle list pioneer-attachments-preview
npx wrangler r2 bucket lifecycle add pioneer-attachments-preview delete-old-attachments appointments/ --expire-days 180
```

生命周期删除有延迟，也不会同步 D1 元数据或计数；到期访问由应用立即拦截，容量必须等对象确认删除后释放。[R2 生命周期](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)

在 GitHub 仓库 Settings → Secrets and variables → Actions 配置 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`；Token 需对应账号的 D1 编辑与 Workers R2 Storage 写入权限。`.github/workflows/cleanup-attachments.yml` 合入默认分支后，每周一北京时间 03:17（周日 19:17 UTC）清理生产和 Preview，同一环境任务串行，失败会显示为 Actions 失败。手动 Run workflow 可选择环境，默认 dry-run；取消 dry-run 才会实际删除。

本地运维终端设置上述两项环境变量后，可使用相同脚本：

```bash
npm run attachments:cleanup -- --dry-run
npm run attachments:cleanup -- --dry-run --preview
npm run attachments:cleanup -- --apply
npm run attachments:cleanup -- --apply --preview
```

不带参数也是 dry-run。脚本每批处理 100 条，删除过期附件和超过 24 小时的未完成预留；先确认桶存在，再删除 R2 对象，随后原子删除元数据与释放额度。生命周期已删除的对象可重复删除。单条失败保留记录和额度，继续处理其他对象，任务最终返回失败；可手动重跑，下一周也会重试。首次清理的历史积压较多时，可分次重跑。公开仓库 60 天无活动时 GitHub 会停用定时工作流，需要重新启用；R2 生命周期仍独立生效。[GitHub 定时工作流](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## 自检与运维

```bash
npm run verify             # CI 同款：lint + 架构审计 + 编译 + 测试 + migration 验证
npm run lint               # ESLint 推荐规则，禁止未使用变量/未定义符号
npm run audit:architecture # 无旧依赖、无死模块、SQL 分层、运行时无迁移副作用
npm run check              # JS 语法、前端边界、Pages Functions 编译
npm test                   # 临时 workerd + D1 + R2，不接触线上或开发数据
npm run db:verify          # Wrangler 对全新隔离状态应用全部 migration、再次应用及外键检查
npm run smoke              # 另开 npm run dev 后，HTTP 检查双入口、依赖、API
npm run smoke -- https://repair.example.edu
```

项目使用 JavaScript，没有 TypeScript 编译任务；语法、ESLint、真实 Workers bundle 与运行时集成测试共同验证。架构审计中的旧关键字只用于拒绝规则，测试中的旧路径只用于断言 404。

测试覆盖双入口/依赖图、敏感文件不公开、用户 JWT 隔离、加密往返、上海日界线、25 个并发请求仅成功 20 个、最后一名额竞争、跨校区重复、恢复容量检查、多人抢单、状态/RBAC、会话撤销、R2 字节往返、并发容量预留与失败补偿、旧附件迁移、过期过滤、清理分页与失败重试、dry-run、SQL 筛选/排队/统计、分页 CSV、分类限流与后台轮询暂停。不执行实际浏览器自动化。

`migrations/0001_initial.sql` 定义 schema、唯一索引和预约容量触发器；`0002_query_indexes.sql` 添加 SQL 查询索引；`0003_attachment_storage.sql` 回填附件过期时间、初始化容量记录及预留/释放触发器。已应用的 migration 不修改，通过后续编号 SQL 演进；应用代码不负责执行迁移。

部署后先确认 `/api/health` 返回 `database: d1`、`attachments: r2`，再使用真实域名做一条预约、附件、接单、查询闭环。云端部署、资源权限、DNS 和证书需在实际 Cloudflare 账号上验证；本地测试不替代这些检查。

D1 备份可用 `npx wrangler d1 export DB --remote --output <安全备份路径>`，恢复参考 D1 Time Travel；R2 对象单独备份，PII 密钥与备份一起纳入恢复方案。[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
