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

首次使用新数据库时只应用 `migrations/0001_initial.sql`。上线后的结构变化追加新的编号迁移，不修改已应用文件。旧结构数据库不能直接套用当前初始迁移。

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
