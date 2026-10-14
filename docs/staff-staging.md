# Staff Staging 配置与运维

通用发布、权限和备份规则见 [部署运维](operations.md)。专用配置以 [wrangler.staff-staging.jsonc](../wrangler.staff-staging.jsonc) 为准。

## 分支与资源

`next/staff-platform` 使用独立 Pages、D1、R2 和应用密钥。功能分支为 `feat/staff-<功能>`，PR base 为 `next/staff-platform`；功能分支仅隔离验证，不发布。

[工作人员端](https://pioneer-staff-staging.pages.dev/staff/)；[健康检查](https://pioneer-staff-staging.pages.dev/api/health)。

| 配置 | 值 |
|---|---|
| Pages | pioneer-staff-staging；Direct Upload，Production branch 为 next/staff-platform |
| D1 | pioneer-appointments-staff-staging |
| 私有 R2 | pioneer-attachments-staff-staging |
| 配额 | MAX_R2_BYTES=536870912（512 MiB），须与 GitHub 环境变量一致 |

[Ruleset](../.github/staff-staging-ruleset.json) 要求线性历史、基于最新集成分支并通过 `test`，禁止删除和强推。迁移编号不得冲突，已执行 SQL 不改写；Staff 数据和密钥不得用于其他环境。

## 环境与执行约束

- `staff-staging` 保存 Pages Token、独立 `JWT_SECRET`、`PII_ENCRYPTION_KEY` 和 `MAX_R2_BYTES`；`staff-staging-migrations` 保存 D1 与维护 Token。权限见 [环境配置](operations.md#自动发布与权限)。
- 发布与维护共用 `cloudflare-staff-staging` 并发组；本地命令须避开正在运行的 CI 或维护。
- 手动操作要求干净的 `next/staff-platform` 工作树。迁移与发布 SHA 必须一致，迁移失败不发布。
- 初始化使用独立测试密码，不导入生产账号；密码要求及临时环境变量见 [初始化说明](operations.md#手动命令)。

## 命令参考

| 用途 | 命令 |
|---|---|
| 查看计划 | `npm run release:plan -- --staff-staging` |
| 迁移 | `npm run db:migrate:remote -- --staff-staging --execute --approve-staff-staging` |
| 首次初始化 | `npm run db:seed -- --remote --staff-staging --execute --approve-staff-staging` |
| 发布 | `npm run deploy:staff-staging -- --execute --approve-staff-staging` |
| 检查 | `npm run smoke -- https://pioneer-staff-staging.pages.dev` |
| 逾期预检 | `npm run appointments:expire -- --staff-staging --dry-run` |
| 附件预检 | `npm run attachments:cleanup -- --staff-staging --dry-run` |
| D1 备份 | `npx wrangler d1 export DB --remote --config wrangler.staff-staging.jsonc --output <受限备份路径>` |

维护执行将 `--dry-run` 改为 `--apply`。GitHub 手动维护选择 `next/staff-platform`；`STAFF_MAINTENANCE_ENABLED=true` 启用每日北京时间 21:35 的维护。

回退须匹配数据库结构，R2 对象和 PII 密钥另行备份。重建或删除资源需单独授权。
