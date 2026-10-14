# Staff Staging 配置与运维

## 分支与资源

`next/staff-platform` 使用独立的 Pages、D1、R2 和应用密钥，与 Production/Preview 隔离。

| 分支 | CI | Pages | 迁移与数据 |
|---|---|---|---|
| `main` | 自动 | Production | Production D1/R2 |
| `dev` | 自动 | 共享 Preview | 仅 dev 自动迁移 Preview D1 |
| `next/staff-platform` | 自动 | `pioneer-staff-staging` 的 Production 环境 | 独立 Staff D1/R2 |
| `feat/staff-*` | 自动，PR 验证 | 不发布 | 每次验证创建临时本地 D1/R2，随机应用密钥 |
| 其他分支 | 自动 | 各分支 Preview 地址 | 共享 Preview，不自动迁移 |

Staff Staging 地址：<https://pioneer-staff-staging.pages.dev>；工作人员端 `/staff/`；健康检查 `/api/health`。

| 资源 | 名称/ID |
|---|---|
| Pages，Direct Upload | `pioneer-staff-staging`，Production branch 为 `next/staff-platform` |
| D1 | `pioneer-appointments-staff-staging` / `ba8a59f5-c95b-48ab-9c01-f95ffa941e71` |
| 私有 R2 | `pioneer-attachments-staff-staging`，公共访问关闭 |
| 配额 | `MAX_R2_BYTES=536870912`（512 MiB） |

Production/Preview 配置见 [wrangler.jsonc](../wrangler.jsonc)，Staff 配置以 [wrangler.staff-staging.jsonc](../wrangler.staff-staging.jsonc) 为准。脚本校验三套资源没有复用；调整配额时须同步 GitHub 环境变量，发布前会核对两者。

Staff 发布脚本将专用配置、构建产物和 Functions 放入随机临时目录，生成标准的 `wrangler.jsonc` 后部署，完成或失败后删除目录。Production/Preview 从仓库目录部署；D1 命令通过 `--config` 读取专用配置。

## PR 与同步

Staff 功能分支从 `next/staff-platform` 创建，命名为 `feat/staff-<功能>`，PR 的 base 选择集成分支。[Ruleset](../.github/staff-staging-ruleset.json) 禁止删除和强推，要求线性历史、基于最新集成分支并通过 `test` 检查，无绕过角色。规则不强制 PR 或审核，建议通过 PR 审核并使用 squash 或 rebase 合并。

跨分支公共修复使用独立 PR，以 `cherry-pick -x` 同步并记录来源。同步前检查迁移历史：迁移只追加、编号不冲突，同名已执行 SQL 的内容必须一致。

## Secrets 与权限

| GitHub Environment | 允许分支 | Secret/变量 | 权限或用途 |
|---|---|---|---|
| `staff-staging` | 仅 Branch `next/staff-platform` | `CLOUDFLARE_STAFF_PAGES_API_TOKEN` | 仅 Cloudflare Pages Edit |
| 同上 | 同上 | `JWT_SECRET`、`PII_ENCRYPTION_KEY` | 独立 JWT 签名与 PII 加密，部署前安全注入 Pages Secrets |
| 同上 | 同上 | 变量 `MAX_R2_BYTES` | 与专用 Wrangler 文件一致 |
| `staff-staging-migrations` | 仅 Branch `next/staff-platform` | `CLOUDFLARE_STAFF_D1_API_TOKEN` | 仅 D1 Edit |
| 同上 | 同上 | `CLOUDFLARE_STAFF_MAINTENANCE_API_TOKEN` | D1 Edit + Workers R2 Storage Edit，独立维护 Token |

账号 ID 使用仓库的 `CLOUDFLARE_ACCOUNT_ID`，发布、迁移和维护各用独立 Token。GitHub 环境仅允许 `next/staff-platform` 分支；PR 验证任务不引用发布环境。

Token 资源范围限定目标 Cloudflare 账号。Pages/D1/R2 权限按账号授予，发布目标由 GitHub 环境策略和脚本校验限制；具有账号级 Token 的维护者须可信。Staff 工作流不使用生产 Token、OAuth 或 Token 管理权限。权限范围见 [API 权限说明](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)。

应用密钥用密码学随机数生成，保存在 Pages Secrets、`staff-staging` 环境 Secrets 和仓库外受限备份。管理员初始密码通过安全渠道保存和交付，不进入 Git 或 CI。

PII 密钥与对应数据库备份一起保存；已有加密数据时不能随意换密钥。JWT 更换会使已有会话失效。Secrets 不放入 Wrangler vars、命令参数、日志、PR 或构建产物。

## 发布、初始化与维护

推送集成分支依次执行验证、迁移、发布和 HTTP smoke；迁移失败即停止发布，迁移输出 SHA 必须与发布 SHA 一致。发布与维护共用 `cloudflare-staff-staging` 并发组，串行执行且不取消运行中的任务。本地命令不受该锁保护，执行前须确认没有 CI 或维护任务运行；[并发规则](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)。

Pages 使用 Direct Upload；该项目的 Production 环境用于 Staff 测试。本地与 CI 使用 Node 22，浏览器验证使用随机临时 D1/R2。

手动操作先在干净的 `next/staff-platform` 工作树核对计划。管理员账号初始化是独立操作，发布不会重设账号：

```powershell
npm run release:plan -- --staff-staging
npm run db:migrate:remote -- --staff-staging --execute --approve-staff-staging
$env:ROOT001_PASSWORD = Read-Host 'Staff root001 初始密码' -MaskInput
$env:ROOT002_PASSWORD = Read-Host 'Staff root002 初始密码' -MaskInput
try {
  npm run db:seed -- --remote --staff-staging --execute --approve-staff-staging
} finally {
  Remove-Item Env:ROOT001_PASSWORD,Env:ROOT002_PASSWORD -ErrorAction SilentlyContinue
}
npm run deploy:staff-staging -- --execute --approve-staff-staging
npm run smoke -- https://pioneer-staff-staging.pages.dev
```

重复迁移由 `d1_migrations` 账本跳过已执行文件；重复 seed 不覆盖 root 密码。手工初始化管理员使用新测试密码，不导入生产账号或业务记录。

附件保留 180 天，采用容量预留并清理超过 24 小时的未完成上传；预约过期处理见 [业务规则](requirements.md)。维护命令：

```bash
npm run attachments:cleanup -- --staff-staging --dry-run
npm run appointments:end-no-shows -- --staff-staging --dry-run
```

确认候选后将 `--dry-run` 改为 `--apply`。GitHub 手动维护选择 `next/staff-platform`，默认 dry-run。仓库变量 `STAFF_MAINTENANCE_ENABLED=true` 启用每日北京时间 21:35 的定时维护，由默认分支 dev 派发到集成分支，使用独立维护 Token。

## 备份、重建与故障恢复

迁移前导出 Staff D1 到受限目录：

```bash
npx wrangler d1 export DB --remote --config wrangler.staff-staging.jsonc --output <受限备份路径>
```

R2 对象和 PII 密钥分别备份。发布失败后已应用迁移会保留，修复后重跑相同工作流；数据库结构变化采用先扩展再切换，不改已执行 SQL。Smoke 失败时核对实际部署 SHA、两项绑定及 Secrets，保留数据库，回滚到兼容迁移后的 Pages 部署，或提交修复 PR。

全量重建不属于自动发布：先停止 Staff 发布和维护并备份 D1/R2/密钥，核对目标资源和数据影响，取得单独授权；新建隔离 D1 后更新专用配置的 ID，迁移、初始化管理员、重新部署和检查。删除/重置旧 D1/R2 必须另外授权。不要把生产或 Preview 数据库替换为 Staff 数据库。

## 跨环境集成

跨环境合并前运行 `npm run verify`，检查迁移兼容性、发布路由和回滚备份，确认 JWT、D1 和 R2 隔离。Staff 测试数据不得复制到共享 Preview 或生产环境。
