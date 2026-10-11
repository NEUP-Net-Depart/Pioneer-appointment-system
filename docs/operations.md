# 部署与运维

项目使用一个 Cloudflare Pages 项目，Pages Functions、D1 和私有 R2 共同提供服务。没有独立的 Cloudflare Worker 项目。

## 环境与绑定

| 环境 | 分支 | D1 | R2 | `MAX_R2_BYTES` |
|---|---|---|---|---:|
| Production | `main` | `pioneer-appointments-production-v2` | `pioneer-attachments-production-v2` | 8589934592 |
| Preview | `dev` | `pioneer-appointments-preview-v2` | `pioneer-attachments-preview-v2` | 536870912 |

绑定名固定为 `DB` 和 `ATTACHMENTS`。旧 D1/R2 资源不属于当前绑定，删除需要单独授权。

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
| 推送 `dev` | Preview | 验证通过后自动迁移、发布和检查 |
| Actions 中选择 `dev`，点击 Run workflow | Preview | 验证通过后迁移、发布和检查 |
| 推送其他分支或 PR | 无远程发布 | 仅验证 |

工作流先运行 `npm run verify`，再在同一发布任务内依次执行 D1 迁移、Pages 发布和 HTTP smoke。迁移失败不会发布，发布失败不会继续检查。同一环境的发布串行执行，不中断正在进行的迁移。

GitHub 仓库 Secrets 需要 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`。Token 需要目标账号的 D1 Edit 和 Cloudflare Pages Edit 权限；现有附件维护任务还使用 R2 权限。Pages 的 `JWT_SECRET`、`PII_ENCRYPTION_KEY` 继续按 Production/Preview 分别保存在 Cloudflare。

GitHub Environments 配置 `production`、`preview`，分别只允许 `main`、`dev` 发布，并配置环境变量 `SITE_URL`：Production 为 `https://pioneer-appointment-system.pages.dev`，Preview 为 `https://dev.pioneer-appointment-system.pages.dev`。Production 和 Preview 不设置额外的必需审批人，以保持推送 `main` 或 `dev` 后自动运行。

在 Cloudflare Pages 项目的 Git 构建设置中关闭 Production 自动部署和 Preview 自动部署，由 Actions 统一发布；保留 Git 关联、Production 分支 `main` 和两套绑定。否则 Pages 的独立自动部署可能抢在数据库迁移完成前上线。

迁移文件只追加、不修改已执行文件。迁移执行时旧版本仍在提供服务，SQL 必须与旧版本兼容；删除字段等破坏性变化应拆成先扩展、再切换应用、最后清理的多次发布。Pages 发布失败后已执行的 D1 迁移保留，重跑工作流会跳过已应用迁移。工作流不初始化或重置 root 账号。

### 本地手动操作

远程命令默认只打印计划。执行时必须使用对应环境的授权参数；不要把 Preview 参数用于 Production。

### Preview

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
