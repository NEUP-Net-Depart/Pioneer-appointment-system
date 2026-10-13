# 长期集成开发环境

## 分支与资源

`next/staff-platform` 从 `dev` 的 `894bff3` 建立，仅追加基础设施改造。`main` 和 `dev` 的资源、凭证和业务规则继续使用原配置。

| 分支 | CI | Pages | 迁移与数据 |
|---|---|---|---|
| `main` | 自动 | 现有 Production | 现有 Production D1/R2 |
| `dev` | 自动 | 现有共享 Preview | 仅 dev 自动迁移 Preview D1 |
| `next/staff-platform` | 自动 | `pioneer-staff-staging` 的 Production 环境 | 独立 Staff D1/R2 |
| `feat/staff-*` | 自动，PR 验证 | 不发布 | 每次验证创建临时本地 D1/R2，随机应用密钥 |
| 其他分支 | 保持原有行为 | 各分支 Preview 地址 | 共享 Preview，不自动迁移 |

Staff Staging 地址：<https://pioneer-staff-staging.pages.dev>；工作人员端 `/staff/`；健康检查 `/api/health`。

| 资源 | 名称/ID |
|---|---|
| Pages，Direct Upload | `pioneer-staff-staging`，Production branch 为 `next/staff-platform` |
| D1 | `pioneer-appointments-staff-staging` / `ba8a59f5-c95b-48ab-9c01-f95ffa941e71` |
| 私有 R2 | `pioneer-attachments-staff-staging`，公共访问关闭 |
| 配额 | `MAX_R2_BYTES=536870912`（512 MiB） |

`wrangler.jsonc` 继续管理现有 Production/Preview；`wrangler.staff-staging.jsonc` 是 Staff 非敏感运行配置的唯一来源，包括 DB、ATTACHMENTS、迁移目录、配额、兼容日期、`nodejs_compat` 和 CPU 限制。脚本校验三套资源没有复用。控制台不要另行修改这些字段；改配额时须同步 GitHub 环境变量，发布前脚本会核对两者。

## PR 与同步

新功能从 `next/staff-platform` 创建 `feat/staff-<功能>`，PR 的 base 选择 `next/staff-platform`。Ruleset 配置见 `.github/staff-staging-ruleset.json`：禁止删除和强推，要求线性历史、1 人审核、最新推送审核、讨论解决及 GitHub Actions 的 `test` 检查通过，要求 PR 基于最新集成分支；无绕过角色。合并使用 squash 或 rebase。

建分支时未合并的 PR：[扫码 #35](https://github.com/NEUP-Net-Depart/Pioneer-appointment-system/pull/35)、[半小时预约时段 #38](https://github.com/NEUP-Net-Depart/Pioneer-appointment-system/pull/38)，base 均为 `dev`，保持独立。等待它们合入 dev 后，再按需同步兼容修复与迁移；本次不引入这些业务功能。

公共修复分别提交 PR，不直接把整个长期重构合入 dev。示例：

```bash
git fetch origin
git switch -c feat/staff-sync-fix origin/next/staff-platform
git cherry-pick -x <dev修复提交>
git push -u origin feat/staff-sync-fix
gh pr create --base next/staff-platform
```

反向同步：从 `origin/dev` 创建 `fix/<名称>`，`cherry-pick -x <staff修复提交>`，向 `dev` 提交 PR。迁移只追加、编号不冲突；已在另一环境执行的同名 SQL 必须内容一致。同步前检查双方迁移历史，不能自动覆盖旧迁移或复制真实数据。

基础设施回同步 dev 时使用独立基础设施 PR；它只补齐第三目标路由和 Staff 维护定时入口。最终业务项目验收后才创建 `next/staff-platform → dev` 的集成 PR。

## Secrets 与权限

| GitHub Environment | 允许分支 | Secret/变量 | 权限或用途 |
|---|---|---|---|
| `staff-staging` | 仅 Branch `next/staff-platform` | `CLOUDFLARE_STAFF_PAGES_API_TOKEN` | 仅 Cloudflare Pages Edit |
| 同上 | 同上 | `JWT_SECRET`、`PII_ENCRYPTION_KEY` | 独立 JWT 签名与 PII 加密，部署前安全注入 Pages Secrets |
| 同上 | 同上 | 变量 `MAX_R2_BYTES` | 与专用 Wrangler 文件一致 |
| `staff-staging-migrations` | 仅 Branch `next/staff-platform` | `CLOUDFLARE_STAFF_D1_API_TOKEN` | 仅 D1 Edit |
| 同上 | 同上 | `CLOUDFLARE_STAFF_MAINTENANCE_API_TOKEN` | D1 Edit + Workers R2 Storage Edit，独立维护 Token |

复用仓库的 `CLOUDFLARE_ACCOUNT_ID`，不复用旧 Token。环境分支策略只允许该 Branch，不允许标签、其他分支及 PR 合并 ref；PR job 不引用任何发布环境。环境无需额外人工审批，PR 审核控制代码准入。

Token 仅选择账号 `da39faf3d75d38114637ca7bc9a4052a`，使用三个独立 Token。Cloudflare 的 Pages/D1/R2 权限通常按账号授予，不能将账号级 Pages Edit 声称为单项目权限；[API 权限说明](https://developers.cloudflare.com/fundamentals/api/reference/permissions/)。GitHub 环境和脚本限制提供发布路由保护，具有账号级 Token 的维护者仍必须可信。不得为了自动化把 OAuth、生产 Token 或 Token 管理权限放入 Actions。

初始应用密钥用密码学随机数生成，仅保存在 Pages Secret、`staff-staging` 环境 Secrets 和本机受限备份 `C:\Users\Administrator\.codex\secrets\pioneer-staff-staging.json`；Windows ACL 仅当前用户与 SYSTEM 可访问。该备份同时含两个测试管理员初始密码，不进入 Git 或 CI。管理员密码不保存在 GitHub；交给测试负责人时使用安全渠道。

PII 密钥与对应数据库备份一起保存；已有加密数据时不能随意换密钥。JWT 更换会使已有会话失效。Secrets 不放入 Wrangler vars、命令参数、日志、PR 或构建产物。

## 发布、初始化与维护

推送集成分支后：`npm run verify → staff-staging-migrations → staff-staging → HTTP smoke`。迁移失败即停止发布；发布要求迁移输出的 SHA 与当前 SHA 相同。工作流级 `cloudflare-staff-staging` 并发组串行保护整条链路，维护工作流使用同一组，不取消运行中的任务。GitHub 并发队列不保证保留所有中间推送，查看最新成功提交即可；[并发与部署](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)。本地命令不会获得 GitHub 并发锁，须确认没有 CI/维护运行时再执行。

Pages 使用 Direct Upload，不启用第二条 Git 自动构建路径。Production 在该项目中表示 Pages 分支分类，仅用于测试，不是业务生产。继续沿用 Node 22、原构建、原迁移账本、原测试与 Smoke；PR 的浏览器验证使用随机临时 D1/R2，绝不读取远程共享数据。

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

附件继续执行原有容量预留、180 天保留与超过 24 小时未完成上传清理机制；无人到场预约继续使用原规则。维护命令：

```bash
npm run attachments:cleanup -- --staff-staging --dry-run
npm run appointments:end-no-shows -- --staff-staging --dry-run
```

查看候选后可将 `--dry-run` 改为 `--apply`。GitHub 的 `Staff Staging maintenance` 手动运行选择集成分支，默认 dry-run。独立维护 Token 配置并验证后，设置仓库变量 `STAFF_MAINTENANCE_ENABLED=true`；基础设施 PR 合入默认分支 dev 后，每天北京时间 21:35 从 dev 派发到 next。现有生产/Preview 维护任务保持原逻辑。

## 备份、重建与故障恢复

迁移前导出 Staff D1 到受限目录：

```bash
npx wrangler d1 export DB --remote --config wrangler.staff-staging.jsonc --output <受限备份路径>
```

R2 对象和 PII 密钥分别备份。发布失败后已应用迁移会保留，修复后重跑相同工作流；数据库结构变化采用先扩展再切换，不改已执行 SQL。Smoke 失败时核对实际部署 SHA、两项绑定及 Secrets，保留数据库，回滚到兼容迁移后的 Pages 部署，或提交修复 PR。

全量重建不属于自动发布：先停止 Staff 发布和维护并备份 D1/R2/密钥，核对目标资源和数据影响，取得单独授权；新建隔离 D1 后更新专用配置的 ID，迁移、初始化管理员、重新部署和检查。删除/重置旧 D1/R2 必须另外授权。不要把生产或 Preview 数据库替换为 Staff 数据库。

## 最终集成验收

向 dev 提交最终集成 PR 前：完整 `npm run verify`、新库全迁移与重复迁移验证、Staff 最新 SHA 部署和 Smoke 成功；测试登录、预约、附件权限及清理；确认 Staff JWT 无法访问 dev/main、数据库和 R2 ID 各不相同；审核双方迁移兼容性与回滚备份；检查 dev/main 仍选原资源。最终 PR 保留审核和 CI，迁移不克隆 Staff 测试数据到共享 Preview。验收后是否保留或销毁 Staff 资源另行决定。
