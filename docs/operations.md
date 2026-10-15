# 部署与运维

配置见 [wrangler.jsonc](../wrangler.jsonc)，CI 见 [check.yml](../.github/workflows/check.yml)，Staff 专用操作见 [staff-staging.md](staff-staging.md)。

## 环境与配置

| 环境 | 分支 | D1（DB） | 私有 R2（ATTACHMENTS） | MAX_R2_BYTES |
|---|---|---|---|---:|
| Production | main | pioneer-appointments-production-v2 | pioneer-attachments-production-v2 | 8589934592 |
| Preview | dev 和普通功能分支 | pioneer-appointments-preview-v2 | pioneer-attachments-preview-v2 | 536870912 |
| Staff Staging | next/staff-platform | pioneer-appointments-staff-staging | pioneer-attachments-staff-staging | 536870912 |

[生产地址](https://pioneer-appointment-system.pages.dev)；[dev 地址](https://dev.pioneer-appointment-system.pages.dev)。普通 Preview 分支共用测试 D1/R2 和 Secrets。

Production/Preview 的 Pages 生产分支为 main。Pages 使用 Actions 发布：根目录为仓库根，构建命令 `npm run build`，输出 `dist`，Functions 位于 `functions/`；保留 `nodejs_compat`，关闭 Pages 自身的自动部署。

各环境使用独立 Secrets，密钥不入 Git：

| Secret | 要求 |
|---|---|
| JWT_SECRET | 至少 32 字符随机值，用于 JWT 和限流 HMAC |
| PII_ENCRYPTION_KEY | 64 位十六进制，用于联系方式加密 |
| SCAN_QR_SECRET | 可选，至少 32 字符；缺省使用 PII 密钥及独立 HMAC 域 |

二维码密钥变更会使已打印码失效；已有联系方式数据须保留对应 PII 密钥。

## 自动发布与权限

CI 运行 `npm run verify`；发布分支的推送须已有授权。

| 分支或触发 | 行为 |
|---|---|
| main | Production 迁移、发布、smoke |
| dev | 共享 Preview 迁移、发布、smoke |
| next/staff-platform | Staff Staging 迁移、发布、smoke |
| feat/staff-*、PR | 仅隔离验证 |
| 其他分支 | 分支 Preview 发布、smoke，不迁移 |
| 手动 CI | 仅非 main，遵循对应分支规则 |

仓库 Secret：`CLOUDFLARE_ACCOUNT_ID`。GitHub Environment 配置：

| Environment | 分支限制 | Token Secret | 权限 |
|---|---|---|---|
| production | main | CLOUDFLARE_API_TOKEN | D1 Edit、Pages Edit、R2 Storage Edit |
| preview | 不限 | CLOUDFLARE_PREVIEW_API_TOKEN | Pages Edit |
| preview-migrations | dev | CLOUDFLARE_PREVIEW_D1_API_TOKEN | D1 Edit |
| preview-maintenance | main | CLOUDFLARE_PREVIEW_MAINTENANCE_API_TOKEN | D1 Edit、R2 Storage Edit |
| staff-staging | next/staff-platform | CLOUDFLARE_STAFF_PAGES_API_TOKEN | Pages Edit |
| staff-staging-migrations | next/staff-platform | CLOUDFLARE_STAFF_D1_API_TOKEN / CLOUDFLARE_STAFF_MAINTENANCE_API_TOKEN | D1 Edit / D1 Edit、R2 Storage Edit |

Token 限定目标账号；维护 Token 不提供给功能分支，R2 权限须支持删除对象。Pages Edit 无法仅限同项目 Preview；`production` 的 `SITE_URL` 设置为生产域名。

## 手动命令

远程操作要求干净工作树和明确授权，默认仅打印计划；Preview 迁移使用 dev。

| 用途 | Preview | Production |
|---|---|---|
| 查看计划 | `npm run release:plan -- --preview` | `npm run release:plan` |
| 迁移 | `npm run db:migrate:remote -- --preview --execute --approve-preview` | `npm run db:migrate:remote -- --execute --approve-production` |
| 发布 | `npm run deploy:preview -- --execute --approve-preview` | `npm run deploy -- --execute --approve-production` |

首次初始化使用 `npm run db:seed -- --remote --preview --execute --approve-preview`；生产移除 `--preview` 并改用 `--approve-production`。`ROOT001_PASSWORD`、`ROOT002_PASSWORD` 各 16–128 字符，以临时环境变量提供并在使用后清除；seed 不覆盖已有密码，发布不初始化账号。

检查使用 [release-checks.sql](release-checks.sql) 和 `npm run smoke -- https://<domain>`。

应用、数据库和维护脚本须匹配；不兼容的升级须暂停写入和维护。回退仅使用兼容当前结构的应用版本，否则须成对恢复应用与数据库备份。迁移只追加，已执行 SQL 不改写。

## 预约模型迁移（0010）

升级前备份 D1、R2 和密钥，并检查历史重复与外键：

```sql
SELECT student_id,date,COUNT(*) FROM appointments
WHERE source='booking' AND status IN ('booked','in_progress','completed')
GROUP BY student_id,date HAVING COUNT(*)>1;
PRAGMA foreign_key_check;
```

迁移 `0010_student_booking.sql` 保留历史重复，由触发器阻止新增同日冲突。暂停新预约后应用迁移并发布配套前后端；管理员在「个人设置 → 服务日维修地点」配置校区和具体日期的真实地点，再开放预约。未配置地点时不能新约，地点变更由管理员人工通知受影响学生。功能分支不会自动迁移共享 Preview 数据库，验证新接口前须先使环境 schema 匹配。

优先发布兼容 0010 的修复版本。若回退旧应用，暂停写入和维护，保管升级后的数据，成对恢复应用与数据库；另行核对备份后的工单、照片和凭证，不能用旧库直接清理新 R2 对象。保留新列、收据和审计。恢复旧 `idx_active_student_slot` 前须检查所有有效工单的 `(student_id,date,time_slot)` 重复，现场登记可能不满足原索引，不能删除历史工单解决冲突。

## 扫码配置

`SCAN_WORKBENCH_ENABLED` 默认为 true；设为 false 并部署可使用列表工作台，一人一单约束仍生效。zxing-wasm 由本站 `/vendor/` 提供，保留 `public/_headers` 的同源摄像头策略。摄像头需要 HTTPS 和授权，支持相册、手动编号及后置镜头偏好；手机、QQ 浏览器的镜头切换和手电筒需实机验收。

## 维护与备份

| 工作流 | 北京时间 | 启用变量 |
|---|---|---|
| [附件清理](../.github/workflows/cleanup-attachments.yml) | 周一 03:17 | ATTACHMENT_MAINTENANCE_ENABLED=true |
| [预约逾期处理](../.github/workflows/expire-appointments.yml) | 每日 21:35 | BOOKING_MAINTENANCE_ENABLED=true |

Production/Preview 维护使用 main 脚本，目标可选 production/preview/both，默认 dry-run，不执行迁移。预约逾期规则见 [业务规则](requirements.md)；附件清理覆盖到期文件、超过 24 小时的未完成上传及失败补偿。

预检：`npm run appointments:expire -- --dry-run --preview`、`npm run attachments:cleanup -- --dry-run --preview`；执行改为 `--apply`，生产移除 `--preview`。

D1 备份：`npx wrangler d1 export DB --remote --output <受限备份路径>`，Preview 增加 `--env preview`。R2 对象和密钥单独备份，备份文件不入 Git。
