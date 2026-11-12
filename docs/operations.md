# 部署与运维

## 环境与绑定

| 环境 | 分支 | D1 | 私有 R2 | 配额 |
| --- | --- | --- | --- | --- |
| Production | `main` | `pioneer-appointments-production-v2` | `pioneer-attachments-production-v2` | 8 GiB |
| 共享 Preview | `dev` 及普通功能分支 | `pioneer-appointments-preview-v2` | `pioneer-attachments-preview-v2` | 512 MiB |

Production/Preview 使用 [wrangler.jsonc](../wrangler.jsonc)。绑定名固定为 `DB`、`ATTACHMENTS`，配额由 `MAX_R2_BYTES` 指定。Production 与 Preview 不复用数据或密钥；普通 Preview 分支共用测试库、附件和应用密钥。

入口：[生产](https://pioneer-appointment-system.pages.dev)、[dev](https://dev.pioneer-appointment-system.pages.dev)。其他分支地址由发布计划生成；[Pages 分支别名](https://developers.cloudflare.com/pages/configuration/preview-deployments/#preview-aliases)转换时须避免重名。

Pages 通过 Actions Direct Upload 发布，关闭自动 Git 构建。构建命令 `npm run build`，输出 `dist`，Functions 位于 `functions/`，保留 `nodejs_compat` 和 `limits.cpu_ms=1000`。项目生产分支为 `main`。工作人员统一运行 React，版本由部署代码决定。

## Secrets 与初始化

| 应用 Secret | 要求 |
| --- | --- |
| `JWT_SECRET` | 至少 32 字符随机值，各环境独立 |
| `PII_ENCRYPTION_KEY` | 64 位十六进制，须匹配已有联系方式数据 |
| `SCAN_QR_SECRET` | 可选，至少 32 字符；缺省使用 PII 密钥及独立 HMAC 域，变更会使已打印维修码失效 |

密钥保存于相应 Pages 环境。不得写入 Git、Wrangler vars、前端、日志或构建产物。私人凭证补发不使维修码失效；保留既有签名密钥，历史维修码的校验仍用于访问原工单。

`root001`、`root002` 是受保护的 `superadmin`。首次 seed 从本机环境变量读取 `ROOT001_PASSWORD`、`ROOT002_PASSWORD`，各 16–128 字符；完成后清除。密码和密钥备份保存在仓库外的受限目录。seed 不覆盖已有密码，发布不初始化账号。

本地启动见 [README](../README.md#本地运行)。`.dev.vars` 与 `.wrangler/` 仅供本地使用；`preview:local` 使用一次性隔离 D1/R2，终端输出访问地址，代码更新后须重启。本地预览的账号以本地夹具及终端输出为准，部署环境不会自动创建这些账号。

## CI 与权限

[发布工作流](../.github/workflows/check.yml) 在开发阶段执行与 `npm run verify` 等价的完整检查。`checks` 与 `browser` 并行运行，`test` 汇总并要求两者成功；浏览器任务覆盖 Chromium 桌面与 WebKit 手机尺寸。生产发布复用 dev 阶段的验证：

| 触发 | 目标与顺序 |
| --- | --- |
| 推送 `main` | Production D1 迁移 → 发布 → HTTP smoke，不重复运行完整验证 |
| 推送 `dev` | 验证 → Preview 快照本地演练 → 共享 Preview D1 迁移 → 发布 → smoke |
| 推送其他分支 | 验证 → 检查 dev schema 版本 → 分支 Preview 发布 → smoke；版本不匹配时暂缓发布，不迁移 |
| 手动 CI | 仅非 `main` 分支，遵循对应分支规则 |
| 本仓库 `dev` → `main` PR | 跳过验证，不迁移、不发布；合并后由 `main` 推送发布 |
| 其他 PR | 仅完整验证，不迁移、不发布；fork 中的同名 `dev` 分支也需验证 |
| 标签、分支删除 | 不发布 |

合并 `dev` → `main` 前，应确认对应 dev 提交的完整验证和 Preview 验收已通过。工作流通过 Job 条件跳过重复验证，保留 `test` 检查项，避免过滤整个工作流后必需检查一直等待。普通分支的推送和 PR 仍分别验证，测试内容保持不变。

迁移或演练失败停止发布。0033 升级自动迁移业务角色并检查一人多账号冲突，无冲突时无需补权或切换开关；冲突时停止，不合并身份。dev 整条链由 `cloudflare-dev-release` 串行保护。共享 Preview 演练和迁移使用 `cloudflare-preview-migrations` 锁；本地远程操作避开正在执行的 CI。

Preview 演练仅将现有 D1 快照导出至临时本地数据库，应用待执行迁移，核验原数据及实际账号权限；不修改远程 Preview，不上传快照为 CI 工件。本地 Secrets 不进入发布目录。

仓库配置 `CLOUDFLARE_ACCOUNT_ID`，各 GitHub Environment 配置：

| Environment | 允许分支 | Secret 与 Cloudflare 权限 |
| --- | --- | --- |
| `production` | `main` | `CLOUDFLARE_API_TOKEN`：D1 Edit、Pages Edit、R2 Storage Edit；变量 `SITE_URL` 为生产域名 |
| `preview` | 普通 Preview 分支 | `CLOUDFLARE_PREVIEW_API_TOKEN`：Pages Edit |
| `preview-migrations` | `dev` | `CLOUDFLARE_PREVIEW_D1_API_TOKEN`：D1 Edit，用于快照演练和远程迁移 |
| `preview-maintenance` | `main` | `CLOUDFLARE_PREVIEW_MAINTENANCE_API_TOKEN`：D1 Edit、R2 Storage Edit |

Token 限定目标账号，维护 Token 不提供给功能分支，R2 权限须支持删除。Pages Edit 无法仅限同项目 Preview。

## 手动发布与回退

远程操作须明确授权且工作树干净，默认仅打印计划。以下为 Preview 操作；生产移除 `--preview` 并改用 `--approve-production`。Preview 迁移从 `dev` 执行。

```bash
npm run release:plan -- --preview
npm run db:migrate:remote -- --preview --execute --approve-preview
npm run deploy -- --preview --execute --approve-preview
npm run smoke -- https://<domain>
```

首次初始化使用 `npm run db:seed -- --remote --preview --execute --approve-preview`。发布计划只读取配置、提交及迁移哈希；核对目标分支、D1、R2、配额与提交后再执行。

迁移前备份数据库、附件和密钥，执行 [只读数据检查](release-checks.sql)。迁移只追加，已执行 SQL 不改写；不兼容升级须停写维护。回退使用兼容当前 schema 的应用，否则成对恢复应用和数据库，并核对备份后的新增工单及附件。迁移目录及历史转换见 [数据模型](data-model.md#历史迁移)。

## 维护与备份

| 定时任务 | 北京时间 | 启用变量 |
| --- | --- | --- |
| Production/Preview 附件清理 | 周一 03:17 | `ATTACHMENT_MAINTENANCE_ENABLED=true` |
| Production/Preview 预约逾期 | 每日 00:05 | `BOOKING_MAINTENANCE_ENABLED=true` |

[维护工作流](../.github/workflows/)的定时入口从默认分支派发，在 `main` 执行。手动运行默认 dry-run；启用的定时任务使用 apply。维护不迁移 schema，附件清理覆盖到期文件、超过 24 小时的未完成上传和失败补偿，物理删除成功后才释放额度。

```bash
npm run appointments:expire -- --preview --dry-run
npm run attachments:cleanup -- --preview --dry-run
```

执行时将 `--dry-run` 改为 `--apply`；生产移除 `--preview`。

D1 备份使用 `npx wrangler d1 export DB --remote --output <受限备份路径>`；Preview 加 `--env preview`。R2 和密钥另行备份，均不入 Git；重建或删除远程资源须单独授权。

## 0042 私有人员迁移

Git 仅保存通用 SQL、工具及虚构测试数据。真实姓名、学号、核对决定、数据库快照及生成的 SQL 存放在本机仓库外的受限目录，不放入 GitHub Secret、CI 工件或日志。完整快照包含密码哈希等私密数据，须单独备份；不得用生产快照填充共享 Preview。

先只读查询目标 `d1_migrations`。0042 原文件不再修改；后续变化必须追加迁移。Production 旧链与 Preview 0041 的待执行迁移不同，两者分别准备输入、演练和执行。

私有 JSON 格式为 `{"version":1,"environment":"production","members":[...]}`。每项填写 `memberId` 或 `studentId`、准确 `name`、`decision`（`migrate` 或明确确认的 `revoke`）及 `reason`。`migrate` 项须有以下至少一项：

- `post`：`departmentCode`、`positionCode`、`effectiveFrom`、`effectiveTo`。
- `exchange`：`effectiveFrom`、`effectiveTo`。
- `authorizations`：特殊授权数组，各项含 `roleCode`、`scope.campusIds`、`effectiveFrom`、`effectiveTo`、`reason`。

日期为 `YYYY-MM-DD`，结束日不含当天，可用 `null` 表示长期。部门代码为 `hardware/network/office/art/publicity`，职位为 `member/head/deputy_head`；站代码为 `device_station/network_station/affairs_station`，职位为 `director/deputy_director`；`center` 使用 `president/vice_president`。特殊授权只填写经核对的角色、原账号校区及有效期。受保护系统账号不列入输入；未核对人员不能默认填 `revoke`。

以下 Production 命令仅在本机执行，所有私有路径必须位于任何 Git 仓库之外。先导出快照并演练，不改远程数据：

```powershell
npx wrangler d1 export DB --remote --config wrangler.jsonc --output C:/Pioneer-private/production.sql
node scripts/rehearse-preview.mjs --snapshot C:/Pioneer-private/production.sql --input C:/Pioneer-private/production-decisions.json
node scripts/prepare-staff-cutover.mjs --input C:/Pioneer-private/production-decisions.json
```

准备工具逐人校验身份、完整性、职位、日期、校区及授权模板，并在本地验证转换。输出只有汇总；真实输入文件和生成 SQL 均拒绝写入仓库内。核对无误、提交干净且明确授权后，从本机暂存目标环境的决定：

```powershell
node scripts/prepare-staff-cutover.mjs --input C:/Pioneer-private/production-decisions.json --execute --approve-production
```

暂存只写入一次性输入表，不改变有效权限。决定绑定环境、数据库、迁移文件哈希及准备时的人员授权状态，可以提前准备并跨日上线；人员或权限变化须重新准备。CI 直接在目标 D1 内核对映射完整性、目标和版本，只接收就绪标志与汇总数量，不导出 Production 或 Preview 快照。本机准备时完成完整迁移演练；0041 结构已就绪时 CI 还会预检源状态，生产旧链由先行历史迁移补齐结构，0042 始终在同一事务内重查源状态及全部授权边界。

先单独准备 Preview：输入的 `environment` 为 `preview`，准备命令加 `--preview`，执行确认改为 `--approve-preview`，快照导出加 `--env preview`。经批准合入 dev 后，原 CI 在库内预检并迁移共享 Preview，再发布代码。生产映射可提前独立暂存；Preview 验收后在停写维护窗口经批准合入 main，由原生产 CI 迁移并发布；未准备、漏人或校验失败均停止发布。

需要手动迁移时，经单独授权从本机运行 `npm run db:migrate:remote -- --execute --approve-production`；Preview 加 `--preview` 并改为 `--approve-preview`。失败时 0042 的全部变更回滚，较早已成功的迁移保留账本，重试从未完成处继续。成功后删除输入表，核对依据保留在原数据库审计中。核验账号与历史数据、离任撤权、特殊留任、重复导入及校区隔离后恢复服务。

删除临时表不会清除 D1 Time Travel 与离线备份，备份和恢复权限仍须受限。已有真实人员数据的 Preview 也须独立核对 Access 保护、分支别名及自定义域名，避免通过其他部署入口绕开访问控制。

## v1.2 破坏性升级与验证

升级到 v1.2 时，必须在停写窗口依次执行 0044–0049，再发布对应应用；值班简化版本还要求追加0050。功能分支不迁移共享 Preview；没有新 schema 时发布仍被就绪检查阻止。不能将旧应用直接回退到新 schema；需要恢复时先核对维护窗口后的新增数据，使用成对备份或追加修复迁移。

迁移前保存数据库、附件和密钥，记录预约、附件、签到、人员、审计与旧排班行数。先在仓库外的私有本地副本执行 `rehearse-preview.mjs`，保留只含汇总的验证结果。0042 若尚未执行，沿用上一节的一次性人员确认前提；0047 随后删除旧维修工作权限包，不为新系统配置维修资格。

迁移后检查 [release-checks.sql](release-checks.sql)、外键、`duty-workflow-0050` 就绪标记及核查表结构、归档处置数量，以及在修主修和照片引用。已排期返修关联原单，未安排申请明确归档；全部旧排班 ID 保留，只有原已发布班次生效。0050不回填签到或核查结论，不批量改写特殊时段。不会删除历史预约、维修、照片、签到、人员或审计，也不根据新流程补造历史结果。

`npm run verify` 执行格式、lint、类型、架构与迁移指纹审计、语法与 Functions 构建、Node 测试、两条本地 D1 迁移链和浏览器验证。每个浏览器用例独立使用一次性 D1/R2 与虚构人员，覆盖预约签名、原图接收与维修、校区切换、通常时间与发布、直接请假、接替确认和考勤补录；权限、结果与隐私等规则另有服务层测试。用例分工和筛选、并行运行方法见[浏览器测试说明](../tests/e2e/README.md)。CI 要求这些检查全部通过。

现场照片等待 30 秒后显示跳过按钮，不取消正在进行的上传。经办人跳过后可继续接收或维修，照片完成上传后自动关联原工单；关闭工单弹窗不会中断任务。刷新、关闭网页或手机系统挂起可能中断上传，原图仍应保留，失败时由经办人重试补传。已成功上传的照片在当前页面会被复用。已有附件保留既有生命周期。附件维护先 dry-run，再按计划执行物理清理；数据库升级不执行附件清理。

所有照片均经过压缩流程，长边不超过 1920 px、上传副本不超过 600 KiB；已足够小的原图若比重新编码更小可保留，避免反而增大。上线前用现场设备照片确认标签和损伤细节可辨识。上传使用二进制请求体，文件名用 URI 编码放在 `X-Attachment-Filename`，用途放在 `X-Attachment-Purpose`，类型为真实图片 MIME。服务端按实际读取字节限长并校验文件头，同时保留旧 JSON/Base64 输入兼容缓存中的旧页面。进度条表示实际发送进度，发送结束后等待服务端保存确认才显示完成。

### 上传连接协议

静态资源通过 `public/_headers`、API 通过共用响应头返回 `Alt-Svc: clear`，使浏览器缓存的替代服务通告失效。Pages 的 `_headers` 不作用于 Functions，修改时应同时维护这两个位置。[Pages 响应头](https://developers.cloudflare.com/pages/configuration/headers/)

这项缓解不等于关闭 HTTP/3。现场域名 `reserve.neupioneer.team` 使用 DNSPod，CNAME 到 Pages；Pages 的 DNS HTTPS 记录仍可能通告 `h3`。发布后检查静态页面和 API 的最终响应头，并在 IPv4、IPv4＋IPv6 无代理环境确认实际上传协议与耗时；不要仅凭代码中的响应头判断已经回退至 HTTP/2。若需要硬性禁用，应使用可控制协议的上传入口。[Pages 外部 DNS 设置](https://developers.cloudflare.com/pages/configuration/custom-domains/#zone-settings) · [HTTPS 记录与 Alt-Svc](https://www.rfc-editor.org/rfc/rfc9460.html#section-9.3)

上线前还需在手机上验证 HTTPS、相册/摄像头权限、扫码和私有附件读取。
