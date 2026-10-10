# 破坏性重建与发布流程

当前版本只支持空数据库应用 `0001_initial.sql`。独立云端 Preview 和 Production 的创建、配置和发布均于 2026-10-11 获得项目所有者明确批准并完成，实际进展见 [发布记录](release-record.md)。现有 Pages 项目及域名保留，两个环境采用独立新 D1/R2；旧资源未删除，其删除仍须另行明确批准。

后续代码按 `dev` → Preview、`main` → Production 管理。先整理本地提交及临时文件，推送 `dev` 并通过 CI 与 Preview 验收；项目所有者确认后才 rebase 到 `main` 并推送。Wrangler 的环境名仍为 `preview`，与 Git 分支 `dev` 分别表示配置环境和发布来源。

## 1. 审批与审计边界

先完成本地验证，再获批搭建独立云端 Preview。Preview 人工验收通过后，取得 Production 重建和发布授权。授权记录必须明确环境、代码提交、资源名称/ID、操作范围、数据去留、执行人和验收地址；批准 Preview 不代表批准 Production，批准新资源上线也不代表批准删除旧资源。

记录模板见 [发布记录](release-record.md)。本地 `release:plan` 输出当前提交、工作区状态、目标绑定及迁移 SHA-256，不连接 Cloudflare、不读取或展示密钥。计划里的 ID 来自本地配置，不证明远程资源的存在或数据已核验。

```bash
npm ci
npx playwright install chromium
npm run verify
npm run release:plan -- --preview
npm run release:plan
```

`npm run deploy`、`deploy:preview`、`db:migrate:remote` 和 `db:seed -- --remote` 默认只打印计划。执行须同时提供 `--execute` 和目标环境对应的 `--approve-preview` / `--approve-production`，并使用干净的已审查提交。参数只是防误操作措施，不代替人的明确授权。发布不再隐式执行迁移或初始化账号。

### 重建前配置基线（2026-10-11 已只读核验；以下为历史状态）

| 项目 | Production | Preview |
|---|---|---|
| Pages 项目 | pioneer-appointment-system（保留） | 同一项目（保留） |
| 发布分支 | main | preview |
| 现有自定义域名 | booking.ptroc.cn、reserve.neupioneer.team（均保留） | 验收使用实际 Preview 地址 |
| D1 名称 | pioneer-appointments | pioneer-appointments-preview |
| D1 ID | f607819a-83a6-4217-8618-5d4fd18e8bac | 4e30f54b-564e-4801-87e0-ea3a7a85d510 |
| 私有 R2 | pioneer-attachments | pioneer-attachments-preview |
| 配额 | 8 GiB | 512 MiB |
| Secret | Production 的 JWT/PII 密钥 | 旧 Preview JWT/PII 密钥；独立性未验证 |

[只读盘点记录](remote-inventory.md)：重建前原生产有 3 个旧账号、无预约及附件，两只 R2 桶均报告零对象；两个环境是旧结构，包含 0001/0002/0003 迁移记录。两个自定义域名 Active，旧版本健康检查正常。盘点时自动生产发布启用，Preview 自动发布规则为 all。后续所有者已确认旧账号无保留需求，当前冻结状态见第 7 节。

不要将重写后的同名初始迁移直接应用到旧数据库：迁移记录可能认为文件已执行，旧表结构也不兼容。推荐分别新建 `pioneer-appointments-preview-v2` / `pioneer-attachments-preview-v2` 和 `pioneer-appointments-production-v2` / `pioneer-attachments-production-v2`，名称需在操作清单中批准；创建后记录实际 ID，更新绑定并冻结最终发布提交。

## 2. 只读盘点与冻结安排

由有权限的操作者核对账号、现有 Pages 项目、Production 分支、所有自定义域名、最新部署、D1/R2 绑定及两个环境的 Secrets 名称和类型。只记录 Secret 是否存在，不导出其值。核对当前自动发布和清理任务，确认原生产数据是否全部为可弃测试数据，记录数据库表/行数、R2 对象数量及用途，由资源负责人明确确认无保留需求。

以下是只读检查示例，需记录命令及结果摘要；业务数据正文不放进公开日志：

```bash
npx wrangler whoami
npx wrangler pages deployment list --project-name pioneer-appointment-system
npx wrangler d1 execute DB --remote --command "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name"
npx wrangler d1 execute DB --remote --env preview --command "SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name"
npx wrangler r2 bucket list
```

R2 对象数量及完整键清单由 Dashboard 或受控 S3 工具检查；所有前缀均要核对。只读盘点不能被当成删除授权。若仍有需要保留的数据，先停止重建执行并由负责人决定归档方式；本版本没有旧数据兼容层。

获批的操作窗口内暂停 Pages 自动发布、部署 Hook 和旧环境的附件清理。Pages Git 集成可能对推送分支自动发布；不要在冻结完成前推送发布提交。检查工作流只做验证。暂停远程设置本身也要包含在批准范围内。[Pages 分支发布控制](https://developers.cloudflare.com/pages/configuration/branch-build-controls/)

## 3. 独立云端 Preview

以下命令只在明确批准 Preview 创建、配置、迁移和发布后执行。

1. 新建空资源，并保存命令结果中的 D1 ID：

```bash
npx wrangler d1 create pioneer-appointments-preview-v2
npx wrangler r2 bucket create pioneer-attachments-preview-v2
```

2. 将新 ID、名称、桶名写入 `wrangler.jsonc` 的 `env.preview`，保留 `DB` / `ATTACHMENTS` 绑定名和 512 MiB 配额。Production 绑定此时保持原值；校验两环境完全隔离，R2 不启用公开访问。

3. 在现有 Pages 项目的 **Preview** 环境配置 Secret：`JWT_SECRET` 至少 32 字符随机值，`PII_ENCRYPTION_KEY` 为 64 位十六进制随机值。保留 `nodejs_compat`、兼容日期和 `limits.cpu_ms=1000`，检查实际套餐允许该 CPU 预算。通过 Dashboard 明确选择环境，避免把 Preview 密钥写入 Production。[Pages 配置](https://developers.cloudflare.com/pages/functions/wrangler-configuration/)、[绑定与 Secrets](https://developers.cloudflare.com/pages/functions/bindings/)

4. 在受信任终端生成并保管随机 Secret，密钥不写进 Git、Wrangler vars、命令行参数或前端。两个环境使用各自独立的 JWT/PII 密钥；PII 密钥须安全备份。

5. 将最终绑定纳入已审查提交，重新生成 Preview 计划，记录提交和迁移哈希。先通过远程 SQL 检查新数据库无业务表、R2 为空，再依次迁移、初始化两个受保护 root、发布：

```bash
npm run db:migrate:remote -- --preview --execute --approve-preview
```

PowerShell 7 设置仅用于本机初始化的两个不同的 16–128 位随机密码；不要复用 Production 密码：

```powershell
$env:ROOT001_PASSWORD = Read-Host 'Preview root001 初始密码' -MaskInput
$env:ROOT002_PASSWORD = Read-Host 'Preview root002 初始密码' -MaskInput
try {
  npm run db:seed -- --remote --preview --execute --approve-preview
} finally {
  Remove-Item Env:ROOT001_PASSWORD, Env:ROOT002_PASSWORD -ErrorAction SilentlyContinue
}
```

```bash
npm run deploy:preview -- --execute --approve-preview
npm run smoke -- https://<实际-preview-地址>
```

种子脚本在本机生成 scrypt 哈希，仅创建缺失的 `root001` / `root002` 和两个校区授权；不覆盖已有密码。这些初始密码不需要作为 Pages Secret。账号初始化不是公开 API。

6. 在实际 HTTPS Preview 地址按 [验收表](preview-acceptance.md) 完整操作：学生预约/附件/私人链接/取消、部员申请与批量核验、维修接单前后的访问边界、跨校区拒绝、账号停用恢复、角色授权、个人改密和会话撤销、凭证补发后旧链接失效。记录桌面/手机结果、提交、部署 ID、地址、执行人和时间。单独确认公网链路与 CPU 预算；本地测试通过不能代替此项。

7. 只有上述验收全部通过，才提出 Production 执行申请。Preview 测试资料留在 Preview，不导出到 Production。

## 4. Production 全新启动

前置条件：Preview 验收记录已签认；负责人已确认旧生产数据无保留需求；Production 的资源创建、配置变更、初始化和发布范围已获明确批准。保持 Pages 项目、域名及现有 DNS，使用新 D1/R2；此流程不删除旧资源。

1. 创建批准清单中的空生产资源：

```bash
npx wrangler d1 create pioneer-appointments-production-v2
npx wrangler r2 bucket create pioneer-attachments-production-v2
```

2. 记录新 D1 ID，更新 `wrangler.jsonc` 顶层 `DB` / `ATTACHMENTS` 绑定及名称，保持 8 GiB 配额；Preview 仍指向其独立资源。在 Pages **Production** 配置全新的 JWT/PII Secrets，记录名称、类型和保管人；初始化 root 使用新的本机密码。不要复制 Preview 密钥、数据、附件或账号。

3. 冻结最终提交，运行 `npm run verify` 并输出 Production 计划，对照批准范围核验目标。批准的新资源实际 ID 必须与创建结果对应；范围发生变化时重新审查。确认无自动发布抢先执行。

4. 依次执行（需要已获得的 Production 授权）：

```bash
npm run db:migrate:remote -- --execute --approve-production
```

用上一节 PowerShell 方式设置 **Production** 两个初始密码，然后执行：

```bash
npm run db:seed -- --remote --execute --approve-production
```

初始化检查须满足：正式账号恰为两个 enabled/protected superadmin；两个 root 各有南湖、浑南授权；预约、附件、白名单、激活申请和凭证补发记录均为零；`storage_quota.used_bytes=0`；R2 对象为零；唯一业务迁移为 `0001_initial.sql`。保存只含计数的结果。[D1 迁移说明](https://developers.cloudflare.com/d1/reference/migrations/)

使用[只读检查 SQL](release-checks.sql)留存结果；R2 对象数量另行核对。Preview 检查命令加 `--env preview`：

```powershell
$releaseCheckSql = Get-Content -Raw docs/release-checks.sql
npx wrangler d1 execute DB --remote --command $releaseCheckSql
```

计数和外键查询使用 `--command` 返回每条查询的结果。`--file` 属于批量导入通道，不能用于保存这些查询结果。

5. 发布到现有 Pages 项目的生产分支：

```bash
npm run deploy -- --execute --approve-production
npm run smoke -- https://<现有生产域名>
```

核对发布返回的项目名、Production 环境、提交与部署 ID。保留 Custom domains，检查域名与 HTTPS 为 Active；用户端 `/`、工作人员端 `/staff/`、API 保持同源。发布工具上传静态资源及 Functions，不采用只拖拽 dist 的方式。

6. `/api/health` 必须返回 `ok:true`、`database:d1`、`attachments:r2`。检查私有源码和旧页面地址返回 404；root 能登录、本人改密后旧会话失效；白名单仅导入真实部员名单。

7. 正式工作人员必须经真实身份核验后激活。生产发布验收可在已授权的线上全流程验证范围内创建最小临时合成记录，先持久化唯一验收标记、账号、预约及附件 ID，随后仅清理这些记录和对象，不能扩大到其他数据或旧资源。不要运行自动测试种子或复制 Preview 数据到 Production。清理后再次检查只有两个受保护 root、无测试账号、预约、附件及残留容量，才能完成空库上线验收。

## 5. 失败处理与旧资源处置

任一步失败即停止后续步骤，记录命令、目标和错误，不自动删除资源或继续发布。迁移失败检查 D1 事务结果；root 初始化可重复执行但不改已有密码。生产发布前失败时，现有 Pages 发布仍保留；新资源可修复后继续。

若切换后健康检查失败，在开放业务前恢复旧发布及其完整绑定/Secrets，或保持关闭并修复新环境，记录恢复方案。不能把旧代码直接绑定新结构。开始接收真实数据后，不得通过回退空库或旧测试库丢弃新业务记录；先停止新增写入并处理故障。

旧 D1/R2 的删除独立审批：列出精确旧 ID、桶名、对象范围、无保留需求确认、执行时间及操作者。核对它们已从 Production/Preview 和所有其他应用解绑；审批前不删除。R2 先核对全量对象清单并按获批范围清空，再删除桶；D1 删除只针对清单中的旧 ID。Pages 项目、域名、新资源均不在删除清单中。删除完成保留脱敏审计结果，不设置自动清库任务。

## 6. 上线后的附件维护

应用上传先在 D1 原子预留容量，R2 对象删除成功后释放。不要直接删额度或元数据腾空间。附件上传后保留 180 天，过期即拒绝访问；清理任务处理过期对象、超过 24 小时的未完成上传及待重试删除，每批 100 条，失败保留记录和容量并返回失败。

获批后，为新桶的 `appointments/` 前缀配置 180 天生命周期，先查看已有规则，保留其他规则。生命周期不更新 D1，仍须运行元数据和容量同步清理。[R2 生命周期](https://developers.cloudflare.com/r2/buckets/object-lifecycles/)

```bash
npm run attachments:cleanup -- --dry-run
npm run attachments:cleanup -- --dry-run --preview
```

检查候选后才执行 `--apply`。GitHub 的 [清理工作流](../.github/workflows/cleanup-attachments.yml) 手动运行默认 dry-run；定时任务默认关闭，待新环境验收及维护授权后由操作者设置仓库变量 `ATTACHMENT_MAINTENANCE_ENABLED=true`。配置必要的 Cloudflare Actions 凭证；首次实际清理前核验 D1/R2 目标和候选摘要。默认分支合入和设置该变量都不在本次已执行范围内。

正式业务启动后新增迁移，不再重写初始迁移。备份 D1、私有附件及对应环境的 PII 密钥；备份与恢复另行按实际数据制定，不使用 Preview 作为生产备份。

## 7. 本次发布结束状态

两个正式域名已切换到新 Production，独立 Preview 保留用于演示和后续验收。Production 线上激活、预约、附件、权限、私人链接和 root 改密已验证，临时资料已精确清理，最终状态为 2 个受保护 root、4 条校区授权、所有业务表空、容量占用 0。

初次云端 Preview 和 Production 采用 Wrangler 直接发布。随后按项目所有者要求，将六个阶段各保留一个符合历史命名的提交，统一 Preview 来源为 `dev`；Pages 自动 Preview 仅允许 `dev`。本次代码同步只推送 `dev`，`main` 的 rebase 和推送等待所有者另行确认。

GitHub `main` 尚未同步该版本，Pages 自动生产发布和旧附件清理工作流保持禁用。恢复前应将已验收的新代码及新绑定同步到 `main`，通过 CI，并核对清理目标与 dry-run；不应直接恢复旧版本任务。实际部署及凭据保管安排见 [发布记录](release-record.md)。当前密码、环境密钥、校验过的验收证据和提交整理前的 Git 备份已迁出仓库，临时构建及测试文件可安全清理。
