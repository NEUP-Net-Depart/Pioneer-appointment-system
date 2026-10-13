# 部署与运维

本地开发见 [README](../README.md)。环境配置以 [wrangler.jsonc](../wrangler.jsonc) 为准，自动发布由 [check.yml](../.github/workflows/check.yml) 执行。

## Cloudflare 配置

| 环境 | 分支 | D1（DB） | 私有 R2（ATTACHMENTS） | MAX_R2_BYTES |
|---|---|---|---|---:|
| Production | main | pioneer-appointments-production-v2 | pioneer-attachments-production-v2 | 8589934592 |
| Preview | 非 main | pioneer-appointments-preview-v2 | pioneer-attachments-preview-v2 | 536870912 |

生产地址：<https://pioneer-appointment-system.pages.dev>；dev 地址：<https://dev.pioneer-appointment-system.pages.dev>。其他 Preview 地址由分支名生成；各分支代码独立，所有 Preview 共用测试数据、附件与 Secrets。

Pages 根目录为仓库根，构建命令 `npm run build`，输出 `dist`，Functions 位于 `functions/`；保留 `nodejs_compat`、两套绑定和生产分支 `main`。关闭 Pages 自身的自动部署，由 Actions 保证先迁移再发布。

两个 Pages 环境分别设置以下 Secrets，生产、测试使用不同值，密钥不入 Git：

| Secret | 要求 |
|---|---|
| JWT_SECRET | 至少 32 字符的随机值，用于 JWT 和限流 HMAC |
| PII_ENCRYPTION_KEY | 64 位十六进制，用于联系方式加密 |
| SCAN_QR_SECRET | 可选，至少 32 字符；未设置时使用 PII 密钥和独立 HMAC 域签名二维码 |

二维码签名密钥须稳定，变更会使已打印码失效；恢复联系方式须使用原加密密钥。

## 发布与迁移

Actions 先运行 `npm run verify`，再按下表执行；推送会触发发布，操作前确认目标环境和授权，尤其是生产分支 `main`。

| 触发 | 行为 |
|---|---|
| 推送 main | 生产迁移 → 发布 → smoke |
| 推送 dev | 共享 Preview 迁移 → 发布 → smoke |
| 推送其他分支 | 发布该分支 Preview → smoke，不迁移 |
| 手动运行 | 仅非 main 分支可用，迁移规则同上 |
| PR | 仅验证 |

功能依赖新结构时，先将兼容迁移合入 dev 并等待成功，再发布功能分支。迁移只追加、必须兼容仍在运行的旧应用；失败不发布，发布失败不回滚数据库，重跑跳过已执行迁移。

仓库 Secret 设置 `CLOUDFLARE_ACCOUNT_ID`，各 GitHub Environment 配置如下：

| Environment | Branch 限制 | Token Secret | 权限 |
|---|---|---|---|
| production | 仅 main | CLOUDFLARE_API_TOKEN | D1 Edit、Pages Edit、R2 Storage Edit |
| preview | No restriction | CLOUDFLARE_PREVIEW_API_TOKEN | Pages Edit |
| preview-migrations | 仅 dev | CLOUDFLARE_PREVIEW_D1_API_TOKEN | D1 Edit |
| preview-maintenance | 仅 main | CLOUDFLARE_PREVIEW_MAINTENANCE_API_TOKEN | D1 Edit、R2 Storage Edit |

Token 资源范围限定目标账号；维护 Token 不提供给功能分支，R2 权限须支持删除对象。`preview` 不限分支以兼容含 `/` 的名称，其余设精确 Branch 规则，不额外配置必需审批人。Pages Edit 无法在同一项目内仅限 Preview，仓库写入者须可信。`production` 环境变量 `SITE_URL` 设置为生产域名。

## 手动发布与初始化

工作树须干净。远程迁移、seed、发布默认只打印计划，先检查提交、分支和目标资源，再按已获授权执行：

| 步骤 | Preview | Production |
|---|---|---|
| 计划 | `npm run release:plan -- --preview` | `npm run release:plan` |
| 迁移 | `npm run db:migrate:remote -- --preview --execute --approve-preview` | `npm run db:migrate:remote -- --execute --approve-production` |
| 发布 | `npm run deploy:preview -- --execute --approve-preview` | `npm run deploy -- --execute --approve-production` |

Preview 迁移从 dev 执行，发布使用当前真实分支。新库依次应用全部迁移，已有库只执行未应用项。

仅首次初始化需在迁移后、发布前创建 root。安全设置临时环境变量 `ROOT001_PASSWORD`、`ROOT002_PASSWORD`（各 16–128 字符），然后运行 `npm run db:seed -- --remote --preview --execute --approve-preview`；生产移除 `--preview` 并改用 `--approve-production`。完成后清除临时密码变量。seed 重跑不覆盖已有密码，运行时和自动发布不初始化账号。

[release-checks.sql](release-checks.sql) 提供只读检查；仅首次空库初始化预期两个保护 root、四条校区授权和空业务表。发布后运行 `npm run smoke -- https://<domain>`，并检查登录、预约、扫码签到、私人凭证查询和附件访问。

## 扫码配置与回退

- 先应用 `0006_scan_workbench.sql` 再部署；`SCAN_WORKBENCH_ENABLED` 默认 true。将目标环境变量改为 false 并重新部署，刷新或重新登录恢复旧工作台；不反向迁移，一人一单约束继续生效。
- zxing-wasm 脚本、WASM 与许可证由本站 `/vendor/` 提供；保留 `public/_headers` 和 API 的同源摄像头 Permissions-Policy。
- 摄像头需 HTTPS 或本地可信源及浏览器授权；无法使用时可选相册或手动编号。实体 iOS、Android、QQ 浏览器的镜头切换和手电筒须单独验收。

## 维护与备份

| 工作流 | 北京时间 | 启用变量 |
|---|---|---|
| [附件清理](../.github/workflows/cleanup-attachments.yml) | 周一 03:17 | ATTACHMENT_MAINTENANCE_ENABLED=true |
| [未到场处理](../.github/workflows/end-no-shows.yml) | 每日 21:35 | BOOKING_MAINTENANCE_ENABLED=true |

定时入口从默认分支 dev 派发到 main，使用内置 GITHUB_TOKEN，处理两个环境；以 main 上的执行结果为准。手动维护也须选择 main，可选 production/preview/both，默认 dry-run，关闭后才写入或删除。维护不执行迁移。

附件清理覆盖到期文件、超过 24 小时的未完成上传及失败补偿；失败下次重试，R2 生命周期规则不能替代 D1 清理。手动预检：`npm run attachments:cleanup -- --dry-run --preview`；确认后用 `--apply`，生产移除 `--preview`。

D1 备份：`npx wrangler d1 export DB --remote --output <secure-backup-path>`，Preview 增加 `--env preview`。R2 对象和密钥单独备份，备份文件不入 Git。
