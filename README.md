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
- 附件支持 JPG、PNG、WEBP、PDF、UTF-8 TXT，单文件 5 MB；校验 MIME 和文件签名，D1 只保存 R2 object key 与元数据。下载携带安全响应头，CSV 防公式注入。
- D1 与 R2 无跨服务事务：R2 写入后 D1 失败会补偿删除对象；补偿删除失败会记录 object key，保留原请求失败；极端中断仍可能留下不可见孤立对象，运维清理前应比对 D1 元数据。当前业务没有删除预约/附件的公开 API，不增加删除功能。无公开 R2 URL。

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

附件上传 JSON 为 `{studentId, filename, mimeType, data}`，data 为标准 base64；工作人员凭 JWT 可省略 studentId。用户附件 GET 使用 `?studentId=...`。错误为 JSON，常见状态：400 输入错误、401 会话失效、403 权限不足、404 不存在、409 冲突、413 请求体过大、415 类型错误、429 限流。

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

测试覆盖双入口/依赖图、敏感文件不公开、用户 JWT 隔离、加密往返、上海日界线、25 个并发请求仅成功 20 个、最后一名额竞争、跨校区重复、恢复容量检查、多人抢单、状态/RBAC、会话撤销、R2 字节往返与失败补偿、SQL 筛选/排队/统计、分页 CSV 和持久化限流。不执行实际浏览器自动化。

`migrations/0001_initial.sql` 定义 schema、唯一索引和容量触发器；`0002_query_indexes.sql` 添加 SQL 查询所需索引并移除被替代的队列索引。已应用的 migration 不修改，通过后续编号 SQL 演进；应用代码不负责执行迁移。

部署后先确认 `/api/health` 返回 `database: d1`、`attachments: r2`，再使用真实域名做一条预约、附件、接单、查询闭环。云端部署、资源权限、DNS 和证书需在实际 Cloudflare 账号上验证；本地测试不替代这些检查。

D1 备份可用 `npx wrangler d1 export DB --remote --output <安全备份路径>`，恢复参考 D1 Time Travel；R2 对象单独备份，PII 密钥与备份一起纳入恢复方案。[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
