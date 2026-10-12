# 部署与运维

本地启动和验证入口见 [README](../README.md)。配置以 [wrangler.jsonc](../wrangler.jsonc) 和 [.github/workflows/](../.github/workflows/) 为准。

## Cloudflare 环境

| 环境 | 分支 | D1（绑定 `DB`） | 私有 R2（绑定 `ATTACHMENTS`） | `MAX_R2_BYTES` |
|---|---|---|---|---:|
| Production | `main` | `pioneer-appointments-production-v2` | `pioneer-attachments-production-v2` | 8589934592 |
| Preview | 所有非 `main` 分支 | `pioneer-appointments-preview-v2` | `pioneer-attachments-preview-v2` | 536870912 |

生产地址为 <https://pioneer-appointment-system.pages.dev>，测试主分支为 <https://dev.pioneer-appointment-system.pages.dev>。其他 Preview 地址按分支名转小写、非字母数字替换为 `-` 生成，避免别名冲突。各分支代码独立，但所有 Preview 共用数据、附件和 Pages Secrets。

Pages 构建命令为 `npm run build`，输出 `dist`，根目录为仓库根目录，Functions 位于 `functions/`；启用 `nodejs_compat`，`limits.cpu_ms=1000`。关闭 Pages 自身的 Production/Preview 自动部署，由 Actions 统一发布，保留 Git 关联、生产分支 `main` 和两套绑定，避免应用抢在迁移前上线。

## 密钥与功能开关

两个 Pages 环境分别设置 Secrets，生产和测试必须使用不同值，不写入 Git、Wrangler vars 或构建产物：

| Secret | 要求与用途 |
|---|---|
| `JWT_SECRET` | 至少 32 字符的随机值，用于 JWT 与限流 HMAC |
| `PII_ENCRYPTION_KEY` | 64 位十六进制随机值，用于联系方式 AES-256-GCM 加密 |
| `SCAN_QR_SECRET` | 可选，至少 32 字符的稳定随机值；未设置时用 `PII_ENCRYPTION_KEY` 配合独立 HMAC 域签名二维码 |

改变实际二维码签名密钥会使已打印二维码失效；学生凭证和工作人员密码变更不影响二维码。密钥应单独安全备份，恢复联系方式必须使用原环境的加密密钥。

扫码上线前先应用 `0006_scan_workbench.sql`，再发布应用。`wrangler.jsonc` 两个环境默认 `SCAN_WORKBENCH_ENABLED=true`；回退时将目标环境此变量改为 `false` 并重新部署，刷新或重新登录即恢复旧工作台。无需反向迁移，历史数据保留，单人单工单约束继续对旧 API 生效。

扫码库 zxing-wasm 的脚本、WASM 和许可证随构建托管于 `/vendor/`。摄像头需要 HTTPS 和浏览器授权；`public/_headers` 与 API 响应的 Permissions-Policy 允许同源摄像头。手机实机的手电筒、镜头切换兼容性需单独验收，失败时使用图片或编号查询。

## GitHub Actions 发布

[发布工作流](../.github/workflows/check.yml) 先执行 `npm run verify`：

| 触发 | 行为 |
|---|---|
| 推送 `main` | 生产迁移 → 发布 → HTTP smoke |
| 推送 `dev` | 迁移共享 Preview D1 → 发布该分支 → smoke |
| 推送其他分支 | 发布该分支 Preview → smoke，不迁移 |
| 手动选择非 `main` 分支运行 | 同推送规则，仅 `dev` 迁移 |
| PR / 标签 / 分支删除 | PR 仅验证；标签和删除不发布 |

功能分支依赖新结构时，先将兼容迁移合入 `dev` 并等待成功，再发布功能分支。共享库迁移串行执行，不取消正在运行的迁移；同一分支发布串行执行。迁移失败不发布，发布失败不继续 smoke。

`CLOUDFLARE_ACCOUNT_ID` 可存于仓库 Secrets；Cloudflare Token 存在以下 GitHub Environments，资源范围限定目标账号：

| Environment | 分支限制 | Secret | 权限 |
|---|---|---|---|
| `production` | 仅 `main` | `CLOUDFLARE_API_TOKEN` | D1 Edit、Pages Edit、R2 Storage Edit |
| `preview` | No restriction | `CLOUDFLARE_PREVIEW_API_TOKEN` | 仅 Pages Edit |
| `preview-migrations` | 仅 `dev` | `CLOUDFLARE_PREVIEW_D1_API_TOKEN` | 仅 D1 Edit |
| `preview-maintenance` | 仅 `main` | `CLOUDFLARE_PREVIEW_MAINTENANCE_API_TOKEN` | D1 Edit、R2 Storage Edit |

`preview` 用 No restriction 兼容含 `/` 的分支，由工作流排除不允许的触发；其余环境使用 Selected branches and tags 的精确 Branch 规则。四个环境不配置额外必需审批人。Pages Edit 在单个项目内不能只限 Preview，仓库分支写入者必须可信；Preview 维护 Token 不向功能分支开放。Production Token 须保留 R2 对象删除权限。

`production` 设置环境变量 `SITE_URL=https://pioneer-appointment-system.pages.dev`（或自定义域名）；Preview URL 自动生成。调整凭证时先配置环境 Secrets 和分支规则，同步 `main` 与默认分支上的工作流，手动 dry-run 验证后再移除旧仓库 Token；不要提前撤销仍在使用的值。

## 迁移与手动发布

迁移只追加，不修改已执行文件。迁移期间旧应用仍在运行，SQL 必须兼容旧版本；破坏性修改分阶段发布。Pages 发布失败不会撤销已应用迁移，重跑跳过已执行文件。Functions 和发布工作流均不初始化或重置 root。

发布前工作树须干净，先检查计划中的提交、分支、D1/R2、配额和迁移：

```bash
npm run release:plan -- --preview
npm run release:plan
```

远程迁移、seed 和发布命令默认只打印计划。获得对应环境的发布授权后执行以下命令；Preview 常规迁移从 `dev` 执行，`deploy:preview` 发布当前真实分支：

| 步骤 | Preview | Production |
|---|---|---|
| 迁移 | `npm run db:migrate:remote -- --preview --execute --approve-preview` | `npm run db:migrate:remote -- --execute --approve-production` |
| 发布 | `npm run deploy:preview -- --execute --approve-preview` | `npm run deploy -- --execute --approve-production` |
| 检查 | `npm run smoke -- https://<branch-alias>.pioneer-appointment-system.pages.dev` | `npm run smoke -- https://pioneer-appointment-system.pages.dev` |

首次初始化在迁移后、发布前创建 root。以下为 PowerShell 的 Preview 示例；生产需移除 `--preview` 并将授权参数改为 `--approve-production`：

```powershell
$env:ROOT001_PASSWORD = Read-Host 'root001 密码（16–128 字符）' -MaskInput
$env:ROOT002_PASSWORD = Read-Host 'root002 密码（16–128 字符）' -MaskInput
try {
  npm run db:seed -- --remote --preview --execute --approve-preview
} finally {
  Remove-Item Env:ROOT001_PASSWORD, Env:ROOT002_PASSWORD -ErrorAction SilentlyContinue
}
```

重跑 seed 不覆盖已有密码。新库按编号应用全部迁移；已有库只应用未执行的迁移，不直接重套初始结构。可用 [release-checks.sql](release-checks.sql) 做只读检查；仅首次空库初始化应有两个受保护 root、四条校区授权及空业务表。

## 维护与备份

附件自上传起保留 180 天；清理同时处理超过 24 小时的未完成上传和失败补偿。D1 先预留容量，成功删除 R2 对象后释放额度；每批 100 条，失败记录下次重试。R2 生命周期规则不能代替数据库清理。

```bash
npm run attachments:cleanup -- --dry-run --preview
npm run attachments:cleanup -- --apply --preview
```

以上针对 Preview，生产移除 `--preview`；先 dry-run，再执行。定时任务如下（北京时间）：

| 工作流 | 时间 | 启用所需仓库变量 |
|---|---|---|
| [附件清理](../.github/workflows/cleanup-attachments.yml) | 周一 03:17 | `ATTACHMENT_MAINTENANCE_ENABLED=true` |
| [无人到场处理](../.github/workflows/end-no-shows.yml) | 每日 21:35 | `BOOKING_MAINTENANCE_ENABLED=true` |

定时入口从仓库默认分支触发（当前约定为 `dev`），用内置 `GITHUB_TOKEN` 与 `actions: write` 派发到 `main`，执行 `both`、`dry_run=false`；无需 PAT，结果以随后在 `main` 上运行的任务为准。手动维护必须选择 `main`，目标可选 `production`、`preview`、`both`，默认 dry-run；关闭后才写入或删除。维护按目标使用专用 Token，不回退到其他凭证，也不执行迁移。

D1 备份：`npx wrangler d1 export DB --remote --output <secure-backup-path>`；Preview 增加 `--env preview`。R2 对象和密钥须单独备份。发布后 `/api/health` 应返回 `ok: true`、`database: d1`、`attachments: r2`，再检查登录、预约、扫码签到、凭证查询及附件访问。旧资源不属于当前绑定，处置需单独确认。
