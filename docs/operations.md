# 部署与运维

现有 Production/Preview 使用同一个 Cloudflare Pages 项目，Pages Functions、D1 和私有 R2 共同提供服务。长期集成分支使用独立的 [Staff Staging](staff-staging.md)，其配置、凭证和操作见专用文档。

## 环境与绑定

| 环境 | 分支 | D1 | R2 | `MAX_R2_BYTES` |
|---|---|---|---|---:|
| Production | `main` | `pioneer-appointments-production-v2` | `pioneer-attachments-production-v2` | 8589934592 |
| Preview | dev 和其他普通分支 | `pioneer-appointments-preview-v2` | `pioneer-attachments-preview-v2` | 536870912 |
| Staff Staging | `next/staff-platform` | `pioneer-appointments-staff-staging` | `pioneer-attachments-staff-staging` | 536870912 |

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
| 推送 `next/staff-platform` | 独立 Staff Staging | 独立 D1 迁移成功后发布和检查 |
| 推送 `feat/staff-*` | 无远程发布 | 隔离本地 D1/R2 验证 |
| 推送其他分支 | 该分支的 Preview | 验证通过后发布和检查，不迁移 |
| Actions 中选择非 `main` 分支，点击 Run workflow | 该分支的 Preview | 与推送同样处理；仅 `dev` 执行迁移 |
| PR、标签或分支删除 | 无远程发布 | PR 仅验证；标签和删除不发布 |

工作流先运行 `npm run verify`。Production 在同一发布任务内依次执行 D1 迁移、Pages 发布和 HTTP smoke。`dev` 在独立的 `migrate-preview` 任务中迁移，成功后才发布；其他 Preview 跳过这个任务。迁移失败不会发布，发布失败不会继续检查。共享 Preview 的迁移串行执行，同一分支的发布串行执行，其他分支可以分别发布；正在进行的迁移不会被取消。

`CLOUDFLARE_ACCOUNT_ID` 可继续保存在仓库 Secrets 中。全部工作流的 Cloudflare 凭证按 GitHub Environment 分配，Token 的资源范围只选目标 Cloudflare 账号：

| GitHub Environment | 允许分支 | Secret | Cloudflare 权限 |
|---|---|---|---|
| Production | `main` | [wrangler.jsonc](../wrangler.jsonc) | 8 GiB |
| Preview | `dev` 及普通功能分支 | 同文件的 `env.preview` | 512 MiB |
| Staff Staging | `next/staff-platform` | [wrangler.staff-staging.jsonc](../wrangler.staff-staging.jsonc) | 512 MiB |

[生产](https://pioneer-appointment-system.pages.dev)、[dev](https://dev.pioneer-appointment-system.pages.dev)、[Staff Staging](https://pioneer-staff-staging.pages.dev/staff/)。各环境独立 D1、私有 R2 和密钥，普通 Preview 分支共用测试资源；具体资源名称以配置文件为准。

Pages 使用 Actions 发布，关闭 Pages 自动部署。构建命令 `npm run build`，输出 `dist`，Functions 位于 `functions/`，保留 `nodejs_compat`。主项目生产分支为 `main`；Staff 项目使用 Direct Upload，生产分支为 `next/staff-platform`。

| 应用 Secret | 要求 |
|---|---|
| `JWT_SECRET` | 至少 32 字符随机值 |
| `PII_ENCRYPTION_KEY` | 64 位十六进制，须与现有联系方式数据匹配 |
| `SCAN_QR_SECRET` | 可选，至少 32 字符；缺省使用 PII 密钥及独立 HMAC 域，变更会使已打印二维码失效 |

## CI 与权限

[CI](../.github/workflows/check.yml) 先运行 `npm run verify`。`main`、`dev`、`next/staff-platform` 在各自环境迁移数据库、发布并执行 smoke；普通功能分支仅发布 Preview，不迁移；PR 和 `feat/staff-*` 仅隔离验证。手动 CI 限非 `main` 分支，遵循同样规则。

仓库设置 `CLOUDFLARE_ACCOUNT_ID`，GitHub Environment 按下表配置 Token：

| Environment | 分支限制 | Secret 与权限 |
|---|---|---|
| `production` | main | `CLOUDFLARE_API_TOKEN`：D1 Edit、Pages Edit、R2 Storage Edit |
| `preview` | 不限 | `CLOUDFLARE_PREVIEW_API_TOKEN`：Pages Edit |
| `preview-migrations` | dev | `CLOUDFLARE_PREVIEW_D1_API_TOKEN`：D1 Edit |
| `preview-maintenance` | main | `CLOUDFLARE_PREVIEW_MAINTENANCE_API_TOKEN`：D1 Edit、R2 Storage Edit |
| `staff-staging` | next/staff-platform | `CLOUDFLARE_STAFF_PAGES_API_TOKEN`：Pages Edit |
| `staff-staging-migrations` | next/staff-platform | `CLOUDFLARE_STAFF_D1_API_TOKEN`：D1 Edit；`CLOUDFLARE_STAFF_MAINTENANCE_API_TOKEN`：D1 Edit、R2 Storage Edit |

Token 限定目标账号，维护 Token 不提供给功能分支，R2 权限须支持删除。Pages Edit 无法仅限同项目 Preview；`production` 的 `SITE_URL` 设置为生产域名。

Staff Staging 的应用密钥和 `MAX_R2_BYTES` 存于 `staff-staging` 环境，配额须与配置文件一致。功能分支使用 `feat/staff-*`，PR base 为 `next/staff-platform`，遵守 [Ruleset](../.github/staff-staging-ruleset.json) 的线性历史、最新基线和 `test` 检查。发布与维护共用 `cloudflare-staff-staging` 锁，迁移和发布 SHA 必须一致；本地操作避开正在执行的 CI。初始化使用独立测试密码。

## 发布与初始化

远程操作要求明确授权和干净工作树，默认仅打印计划。以下为 Preview 命令；生产省略 `--preview` 并改用 `--approve-production`，Staff Staging 换为 `--staff-staging` 和 `--approve-staff-staging`。Preview 迁移从 `dev` 执行，Staff 操作从 `next/staff-platform` 执行。

```bash
npm run release:plan -- --preview
npm run db:migrate:remote -- --preview --execute --approve-preview
npm run deploy -- --preview --execute --approve-preview
npm run smoke -- https://<domain>
```

首次初始化：`npm run db:seed -- --remote --preview --execute --approve-preview`。临时提供 `ROOT001_PASSWORD`、`ROOT002_PASSWORD`（各 16–128 字符），完成后清除；seed 不覆盖已有密码，发布不初始化账号。

迁移前备份数据库、附件和密钥，执行 [只读数据检查](release-checks.sql)。迁移只追加，已执行 SQL 不改写；不兼容升级须暂停写入和维护。回退使用兼容当前 schema 的应用，否则成对恢复应用与数据库，并核对备份后的新增工单和附件。

## 维护与备份

| 任务 | 北京时间 | 启用变量 |
|---|---|---|
| Production/Preview 附件清理 | 周一 03:17 | `ATTACHMENT_MAINTENANCE_ENABLED=true` |
| Production/Preview 预约逾期 | 每日 21:35 | `BOOKING_MAINTENANCE_ENABLED=true` |
| Staff Staging 维护 | 每日 21:35 | `STAFF_MAINTENANCE_ENABLED=true` |

工作流位于 [.github/workflows/](../.github/workflows/)。Production/Preview 使用 `main` 脚本，目标为 production/preview/both；Staff 手动维护选择 `next/staff-platform`。默认 dry-run，不执行迁移；附件清理覆盖到期文件、超过 24 小时的未完成上传及失败补偿。

```bash
npm run appointments:expire -- --preview --dry-run
npm run attachments:cleanup -- --preview --dry-run
```

执行时将 `--dry-run` 改为 `--apply`；生产移除 `--preview`，Staff 换为 `--staff-staging`。

D1 备份：`npx wrangler d1 export DB --remote --output <受限备份路径>`；Preview 加 `--env preview`，Staff 加 `--config wrangler.staff-staging.jsonc`。R2 和密钥单独备份，备份与密钥不入 Git。重建或删除远程资源须单独授权。

## 扫码配置

工作人员端统一运行 React 工作区，一人一单约束始终生效。扫码依赖 HTTPS、摄像头授权和 [同源策略](../public/_headers)，支持相册及手动编号；手机镜头切换和手电筒需实机检查。
