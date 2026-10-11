# 部署与运维

项目使用一个 Cloudflare Pages 项目，Pages Functions、D1 和私有 R2 共同提供服务。没有独立的 Cloudflare Worker 项目。

## 环境与绑定

| 环境 | 分支 | D1 | R2 | `MAX_R2_BYTES` |
|---|---|---|---|---:|
| Production | `main` | `pioneer-appointments-production-v2` | `pioneer-attachments-production-v2` | 8589934592 |
| Preview | 所有非 `main` 分支 | `pioneer-appointments-preview-v2` | `pioneer-attachments-preview-v2` | 536870912 |

绑定名固定为 `DB` 和 `ATTACHMENTS`。旧 D1/R2 资源不属于当前绑定，删除需要单独授权。

每个分支有独立地址，代码更新互不覆盖；Preview 数据库、附件和应用密钥共用，任何 Preview 上的数据修改都会被其他 Preview 看到。

| 分支 | 网址 |
|---|---|
| `main` | `https://pioneer-appointment-system.pages.dev` |
| `dev` | `https://dev.pioneer-appointment-system.pages.dev` |
| `feat/nfc-checkin` | `https://feat-nfc-checkin.pioneer-appointment-system.pages.dev` |
| `fix/booking-status` | `https://fix-booking-status.pioneer-appointment-system.pages.dev` |

[Cloudflare Pages 分支别名](https://developers.cloudflare.com/pages/configuration/preview-deployments/#preview-aliases)使用小写分支名，并将非字母数字字符替换为 `-`。同一分支重新发布会更新该别名。选择分支名时避免转换后的别名相同，并确保别名是有效的 DNS 标签。

Pages 配置使用以下构建设置：

- 构建命令：`npm run build`
- 输出目录：`dist`
- 根目录：仓库根目录
- Functions：仓库根目录的 `functions/`
- 兼容性：`nodejs_compat`，`limits.cpu_ms=1000`

## Secrets 与 root

两个 Pages 环境分别配置以下 Secrets：

| Secret | 要求 | 用途 |
|---|---|---|
| `JWT_SECRET` | 至少 32 个字符的随机值 | JWT 签名和限流 HMAC |
| `PII_ENCRYPTION_KEY` | 64 位十六进制随机值 | AES-256-GCM 联系方式加密 |

Preview 和 Production 必须使用不同的密钥。密钥只保存在 Cloudflare Pages Secrets 和受限本地备份中，不写入 Git、Wrangler vars、前端或构建产物。

`root001`、`root002` 是两个受保护的 `superadmin`。初始密码通过本机环境变量 `ROOT001_PASSWORD`、`ROOT002_PASSWORD` 提供，每个密码长度为 16–128 个字符。密码和两个环境的密钥保存在仓库外的受限目录；重新运行 seed 不会覆盖已有密码。

## 本地开发

```bash
npm ci
npx playwright install chromium
npm run setup:local
npm run dev
```

本地地址：

- 用户端：<http://127.0.0.1:8788/>
- 工作人员端：<http://127.0.0.1:8788/staff/>
- 健康检查：`/api/health`

本地 D1/R2 数据由 Wrangler 保存在 `.wrangler/`。本地环境不会连接远程资源。

## 验证

```bash
npm run verify
npm run release:plan -- --preview
npm run release:plan
```

`release:plan` 只读取本地配置、当前提交和迁移哈希，不执行远程操作。发布前工作树必须干净，并核对计划中的分支、D1、R2、配额和迁移。

## 远程迁移、root 初始化和发布

### GitHub Actions 统一发布

[Cloudflare CI and release](../.github/workflows/check.yml) 对所有推送和 PR 运行本地验证，发布行为如下：

| 触发方式 | 目标 | 行为 |
|---|---|---|
| 推送 `main` | Production | 验证通过后自动迁移、发布和检查 |
| 推送 `dev` | `dev` Preview | 验证通过后自动迁移共享测试库、发布和检查 |
| 推送其他分支 | 该分支的 Preview | 验证通过后发布和检查，不迁移 |
| Actions 中选择非 `main` 分支，点击 Run workflow | 该分支的 Preview | 与推送同样处理；仅 `dev` 执行迁移 |
| PR、标签或分支删除 | 无远程发布 | PR 仅验证；标签和删除不发布 |

工作流先运行 `npm run verify`。Production 在同一发布任务内依次执行 D1 迁移、Pages 发布和 HTTP smoke。`dev` 在独立的 `migrate-preview` 任务中迁移，成功后才发布；其他 Preview 跳过这个任务。迁移失败不会发布，发布失败不会继续检查。共享 Preview 的迁移串行执行，同一分支的发布串行执行，其他分支可以分别发布；正在进行的迁移不会被取消。

`CLOUDFLARE_ACCOUNT_ID` 可继续保存在仓库 Secrets 中。全部工作流的 Cloudflare 凭证按 GitHub Environment 分配，Token 的资源范围只选目标 Cloudflare 账号：

| GitHub Environment | 允许分支 | Secret | Cloudflare 权限 |
|---|---|---|---|
| `production` | 仅 `main` | `CLOUDFLARE_API_TOKEN` | D1 Edit、Cloudflare Pages Edit、Workers R2 Storage Edit；用于生产发布和维护 |
| `preview` | 所有仓库内分支 | `CLOUDFLARE_PREVIEW_API_TOKEN` | 仅 Cloudflare Pages Edit |
| `preview-migrations` | 仅 `dev` | `CLOUDFLARE_PREVIEW_D1_API_TOKEN` | 仅 D1 Edit |
| `preview-maintenance` | 仅 `main` | `CLOUDFLARE_PREVIEW_MAINTENANCE_API_TOKEN` | D1 Edit、Workers R2 Storage Edit；用于共享测试库和附件维护 |

生产维护复用 `production` 的原 Token；若重建生产 Token，必须同时保留 R2 读写和对象删除权限。Preview 维护使用新的专用 Token，不给所有功能分支可读取的 Preview 发布 Token 增加 D1/R2 权限，也不扩大仅供 `dev` 迁移的 Token 用途。[Cloudflare API 权限文档](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)将上述写权限称为 D1 Write、Pages Write、Workers R2 Storage Write，控制台可能显示为 Edit；如果控制台支持资源范围，Preview 维护 Token 应只选择 Preview D1/R2。Pages 的 `JWT_SECRET`、`PII_ENCRYPTION_KEY` 继续按 Production/Preview 分别保存在 Cloudflare。

Secret 迁移按以下顺序完成，避免旧工作流失去凭证：

1. 将原来的 `CLOUDFLARE_API_TOKEN` 安全保存到 `production` 的环境 Secrets，并确认其 D1、Pages、R2 权限。GitHub Secret 无法读回，迁移原 Token 需要安全备份；如果 Roll 了 Token，先更新所有仍在使用旧值的 Secret。
2. 为 `preview`、`preview-migrations` 和 `preview-maintenance` 配置表中的专用 Secret 和分支限制。已有的 Preview 发布、迁移 Token 可以继续使用；新增 Preview 维护 Token 不需要 Pages 权限。
3. 先更新 `main` 上的工作流，再同步到当前默认分支 `dev`。两个分支均须包含最新维护工作流，因为定时入口从默认分支触发，再派发到 `main`。
4. 从 `main` 手动运行两个维护工作流，选择 `both` 并保持 `dry_run=true`，确认两个环境的凭证和资源读取成功后，再删除仓库级 `CLOUDFLARE_API_TOKEN`。Cloudflare Token 不应留在仓库 Secrets 中。

`production` 配置环境变量 `SITE_URL=https://pioneer-appointment-system.pages.dev`，自定义生产域名也可继续使用。Preview 地址由实际分支名和 `wrangler.jsonc` 中的项目名生成，不再读取 Preview 的 `SITE_URL`；旧变量可以移除。发布任务把实际网址写入 GitHub Deployment 链接。四个环境不设置额外的必需审批人，以保持自动运行。

`preview` 的 Deployment branches and tags 选择 **No restriction**，由工作流排除 PR、标签、删除和手动 `main` 发布。[GitHub 的分支规则](https://docs.github.com/en/rest/deployments/branch-policies)中 `*` 不会匹配 `/`，仅添加 `*` 会继续挡住 `feat/nfc-checkin` 等分支。其余环境使用 Selected branches and tags，`production`、`preview-maintenance` 只添加类型为 Branch 的 `main`，`preview-migrations` 只添加 Branch 类型的 `dev`。

Cloudflare Pages Edit 是账号级权限，在同一个 Pages 项目内不能把 Token 限定到 Preview；Environment 分支规则和脚本负责选择发布环境。因此具备仓库分支写入权限的人必须可信，环境隔离也依赖正确维护工作流和 Token 权限。

在 Cloudflare Pages 项目的 Git 构建设置中关闭 Production 自动部署和 Preview 自动部署，由 Actions 统一发布；保留 Git 关联、Production 分支 `main` 和两套绑定。否则 Pages 的独立自动部署可能抢在数据库迁移完成前上线。

迁移文件只追加、不修改已执行文件。迁移执行时旧版本仍在提供服务，SQL 必须与旧版本兼容；删除字段等破坏性变化应拆成先扩展、再切换应用、最后清理的多次发布。Pages 发布失败后已执行的 D1 迁移保留，重跑工作流会跳过已应用迁移。工作流不初始化或重置 root 账号。

功能分支需要新表或新字段时，先把兼容性迁移合并到 `dev` 并等待其迁移任务成功，再发布依赖该结构的功能分支。功能分支不会自动升级共享数据库；`dev` 的迁移必须兼容仍在运行的其他 Preview。

### 本地手动操作

远程命令默认只打印计划。执行时必须使用对应环境的授权参数；不要把 Preview 参数用于 Production。

### Preview

先切换到准备发布的非 `main` 分支。`deploy:preview` 读取当前真实分支名，不会把所有发布覆盖到 `dev`。共享测试库的常规迁移从 `dev` 执行。

```bash
npm run db:migrate:remote -- --preview --execute --approve-preview

$env:ROOT001_PASSWORD = Read-Host 'Preview root001 密码' -MaskInput
$env:ROOT002_PASSWORD = Read-Host 'Preview root002 密码' -MaskInput
try {
  npm run db:seed -- --remote --preview --execute --approve-preview
} finally {
  Remove-Item Env:ROOT001_PASSWORD, Env:ROOT002_PASSWORD -ErrorAction SilentlyContinue
}

npm run deploy:preview -- --execute --approve-preview
npm run smoke -- https://dev.pioneer-appointment-system.pages.dev
```

### Production

```bash
npm run db:migrate:remote -- --execute --approve-production

$env:ROOT001_PASSWORD = Read-Host 'Production root001 密码' -MaskInput
$env:ROOT002_PASSWORD = Read-Host 'Production root002 密码' -MaskInput
try {
  npm run db:seed -- --remote --execute --approve-production
} finally {
  Remove-Item Env:ROOT001_PASSWORD, Env:ROOT002_PASSWORD -ErrorAction SilentlyContinue
}

npm run deploy -- --execute --approve-production
npm run smoke -- https://<production-domain>
```

首次使用新数据库时按编号顺序应用 `migrations/` 下的全部迁移。已有数据库应用尚未执行的迁移；`0002_slot_capacity.sql` 将每校区每时段的新预约上限改为 10 人，并允许继续处理原有预约。上线后的结构变化追加新的编号迁移，不修改已应用文件。旧结构数据库不能直接套用当前初始迁移。

迁移和 seed 不由 Pages Functions 自动执行。初始化后可用 [release-checks.sql](release-checks.sql) 做只读计数检查；Production 应只有两个受保护 root、四条校区授权和空业务表。

## 附件维护

附件使用私有 R2，应用先在 D1 预留容量，再上传对象；删除 R2 对象成功后释放额度。附件自上传起保留 180 天，超过 24 小时的未完成上传和失败补偿由清理命令处理。

先 dry-run，再按环境执行：

```bash
npm run attachments:cleanup -- --dry-run
npm run attachments:cleanup -- --dry-run --preview
npm run attachments:cleanup -- --apply
npm run attachments:cleanup -- --apply --preview
```

清理任务每批处理 100 条；单条失败会保留记录并在下次重试。R2 生命周期规则只负责对象删除，不能代替 D1 元数据和额度清理。

## GitHub 定时维护

[Clean expired attachments](../.github/workflows/cleanup-attachments.yml) 每周一北京时间 03:17 清理附件；[End unattended appointments](../.github/workflows/end-no-shows.yml) 每天北京时间 21:35 结束无人到场预约。仓库变量 `ATTACHMENT_MAINTENANCE_ENABLED=true`、`BOOKING_MAINTENANCE_ENABLED=true` 分别启用对应定时任务，未启用时仍可手动 dry-run。

GitHub 的定时任务只从默认分支触发，当前默认分支为 `dev`。定时入口不读取 Cloudflare Token，只用内置 `GITHUB_TOKEN` 和任务级 `actions: write` 权限向同一个工作流的 `main` 分支发送 `workflow_dispatch`，选择 `both`、`dry_run=false`。派发成功不代表维护完成，实际结果查看随后在 `main` 上执行的工作流。无需新增 GitHub PAT，也不改变默认分支或生产环境的分支限制。[GitHub 工作流触发规则](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)允许内置 Token 触发 `workflow_dispatch`。

手动维护必须在 Run workflow 中选择 `main`，可选择 `production`、`preview` 或 `both`；默认 `dry_run=true`，只有主动关闭 dry-run 才会写入或删除。分支和目标验证任务不读取 Cloudflare Secret，不合法的分支在凭证任务开始前失败。任务矩阵只创建选中的环境，生产维护绑定 `production`，Preview 维护绑定 `preview-maintenance`，缺少对应 Token 时失败，不回退到另一种 Token。维护脚本继续按 `--preview` 选择共享 Preview D1/R2，按环境串行执行，不执行数据库迁移。

## 备份与健康检查

D1 导出示例：

```bash
npx wrangler d1 export DB --remote --output <secure-backup-path>
```

R2 对象和 `PII_ENCRYPTION_KEY` 需要单独备份。恢复时必须使用同一环境的加密密钥。

发布后检查：

```bash
npm run smoke -- https://<domain>
```

`/api/health` 应报告 `ok: true`、`database: d1`、`attachments: r2`。再检查用户端、工作人员端、登录、预约、凭证查询和附件访问。

生产发布、Secrets、D1/R2 绑定、域名和旧资源处置均需在目标 Cloudflare 账号中核对；不要删除当前或旧资源来绕过发布问题。
