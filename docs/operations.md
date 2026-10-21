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

密钥保存于相应 Pages 环境。不得写入 Git、Wrangler vars、前端、日志或构建产物。私人凭证补发不使维修码失效；保留既有签名密钥，兼容历史测试环境的 JWT 签名维修码。

`root001`、`root002` 是受保护的 `superadmin`。首次 seed 从本机环境变量读取 `ROOT001_PASSWORD`、`ROOT002_PASSWORD`，各 16–128 字符；完成后清除。密码和密钥备份保存在仓库外的受限目录。seed 不覆盖已有密码，发布不初始化账号。

本地启动见 [README](../README.md#本地运行)。`.dev.vars` 与 `.wrangler/` 仅供本地使用；`preview:local` 和 `preview:field` 使用一次性隔离 D1/R2，终端输出访问地址，代码更新后须重启。`preview:field` 的账号以本地夹具及终端输出为准，部署环境不会自动创建这些账号。

## CI 与权限

[发布工作流](../.github/workflows/check.yml) 对推送与 PR 执行 `npm run verify`：

| 触发 | 目标与顺序 |
| --- | --- |
| 推送 `main` | 验证 → Production D1 迁移 → 发布 → HTTP smoke |
| 推送 `dev` | 验证 → Preview 快照本地演练 → 共享 Preview D1 迁移 → 发布 → smoke |
| 推送其他分支 | 验证 → 分支 Preview 发布 → smoke，不迁移 |
| 手动 CI | 仅非 `main` 分支，遵循对应分支规则 |
| PR、标签、分支删除 | PR 仅验证；标签和删除不发布 |

迁移或演练失败停止发布。dev 整条链由 `cloudflare-dev-release` 串行保护。共享 Preview 演练和迁移使用 `cloudflare-preview-migrations` 锁；本地远程操作避开正在执行的 CI。

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

迁移前备份数据库、附件和密钥，执行 [只读数据检查](release-checks.sql)。迁移只追加，已执行 SQL 不改写；不兼容升级须停写维护。回退使用兼容当前 schema 的应用，否则成对恢复应用和数据库，并核对备份后的新增工单及附件。迁移目录及历史兼容见 [数据模型](data-model.md#迁移与兼容)。

## 维护与备份

| 定时任务 | 北京时间 | 启用变量 |
| --- | --- | --- |
| Production/Preview 附件清理 | 周一 03:17 | `ATTACHMENT_MAINTENANCE_ENABLED=true` |
| Production/Preview 预约逾期 | 每日 21:35 | `BOOKING_MAINTENANCE_ENABLED=true` |

[维护工作流](../.github/workflows/)的定时入口从默认分支派发，在 `main` 执行。手动运行默认 dry-run；启用的定时任务使用 apply。维护不迁移 schema，附件清理覆盖到期文件、超过 24 小时的未完成上传和失败补偿，物理删除成功后才释放额度。

```bash
npm run appointments:expire -- --preview --dry-run
npm run attachments:cleanup -- --preview --dry-run
```

执行时将 `--dry-run` 改为 `--apply`；生产移除 `--preview`。

D1 备份使用 `npx wrangler d1 export DB --remote --output <受限备份路径>`；Preview 加 `--env preview`。R2 和密钥另行备份，均不入 Git；重建或删除远程资源须单独授权。

## 验证范围

预约配置中的“放号时间”“校区公告”和“暂停日期”分别维护，复用 `settings.manage` 及校区授权。暂停日期支持选择本周及下周的周一至周四，一次操作原子保存全部所选日期；暂停说明直接投影为系统公告，恢复或日期结束后停止展示，不另存一份公告。原单日暂停接口及已有暂停记录继续生效。`0033_booking_settings.sql` 仅追加校区规则、公告和重要公告确认快照，保留历史预约、私人凭证、附件与容量快照。升级后默认北京时间 10:00 放号，公告默认空白。修改放号时间只影响新预约窗口，不取消已创建的预约。

公告仅在预约首页展示；管理端可选择页面或弹窗形式，必读公告在进入下一步前验证阅读确认。`0034_notice_display_mode.sql` 为旧公告默认保留页面展示及原确认版本，不改变预约历史。

CI 沿用现有迁移演练、D1 迁移及发布链；`tests/booking-settings.test.mjs` 验证有数据旧库升级，接口回归验证校区权限、请求重试和公告版本竞争。功能分支不迁移共享 Preview 数据库；含新迁移的版本仍须按原发布流程先迁移目标数据库，再发布并通过 health/smoke，不能仅替换静态页面。

`npm run verify` 覆盖格式、lint、类型、架构／平台审计、语法与 Functions 构建、Node 测试、主迁移链、通用浏览器和工作人员浏览器。测试使用隔离数据；本地通过不代表远程迁移或发布成功。线上 smoke 校验 React 入口、资源字节、真实结构及迁移标记、API 鉴权与私有路径。

设备检查须覆盖 HTTPS、摄像头授权、相册识别、手动编号、iOS／内置浏览器、镜头切换和手电筒；自动浏览器测试不能替代实机。使用测试成员和预约验证岗位范围，客户端越权请求仍须被服务端拒绝。
