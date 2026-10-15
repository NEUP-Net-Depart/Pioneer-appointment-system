# 部署与运维

## 环境

| 环境 | 分支 | 配置 | 附件配额 |
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

`SCAN_WORKBENCH_ENABLED=false` 可切换到列表工作台，一人一单约束仍生效。扫码依赖 HTTPS、摄像头授权和 [同源策略](../public/_headers)，支持相册及手动编号；手机镜头切换和手电筒需实机检查。
