# 长期独立 Staff Staging 环境

Staff Staging 保留为独立的集成测试环境。next/staff-platform 继续绑定这套资源；PR #58 合入 dev 后，dev 直接部署完整 React 后台，不依赖 Staff Staging 的配置或后续清理。

| 分支 | Pages | 数据与迁移 |
| --- | --- | --- |
| main | 现有 Production | 现有 Production D1/R2 |
| dev | 现有共享 Preview，dev 分支地址 | 仅 dev 自动迁移现有 Preview D1 |
| next/staff-platform | pioneer-staff-staging 的 Production 环境 | 独立 Staff D1/R2，独立迁移历史 |
| feat/staff-* | 仅验证，不发布 | 临时本地 D1/R2 |
| 其他分支 | 现有分支 Preview 发布规则 | 共享 Preview，不自动迁移 |

工作人员地址：<https://pioneer-staff-staging.pages.dev/staff/>；健康检查：/api/health。

| 资源 | 名称 / ID |
| --- | --- |
| Pages，Direct Upload | pioneer-staff-staging，Production branch 为 next/staff-platform |
| D1 | pioneer-appointments-staff-staging / ba8a59f5-c95b-48ab-9c01-f95ffa941e71 |
| 私有 R2 | pioneer-attachments-staff-staging |
| 配额 | MAX_R2_BYTES=536870912（512 MiB） |

wrangler.staff-staging.jsonc 是独立环境的非敏感配置来源；原 Production/Preview 继续使用 wrangler.jsonc。脚本校验三套资源不复用，迁移只追加。不得删除已执行 SQL、复制真实业务数据到测试库或删除云端资源。

## CI 与发布

next/staff-platform 推送自动执行完整验证，再并行执行现有 Preview 快照的只读本地演练与独立 Staff D1 迁移；全部成功后部署 Staff Staging 并运行 Smoke。迁移输出的提交 SHA 必须与发布一致。cloudflare-staff-staging 并发锁覆盖验证、迁移、部署及维护。

dev 推送独立执行验证、现有 Preview 数据演练、Preview D1 迁移、构建部署与 Smoke，整条链由 cloudflare-dev-release 串行保护。部署前不需要手动配置环境开关。合入 dev 不改变 main 现有部署。

Pages 使用 Direct Upload。独立 Staff 配置和本次构建在临时目录完成发布，结束后清理临时目录；本地 Secrets 不进入发布目录。Smoke 核对 React 入口、实际构建资源字节、数据库结构和迁移标记、新工作流 API 鉴权及私有路径。

## 凭证与分支限制

| GitHub Environment | 允许分支 | 凭证用途 |
| --- | --- | --- |
| staff-staging | next/staff-platform | CLOUDFLARE_STAFF_PAGES_API_TOKEN、独立 JWT_SECRET / PII_ENCRYPTION_KEY、MAX_R2_BYTES |
| staff-staging-migrations | next/staff-platform | CLOUDFLARE_STAFF_D1_API_TOKEN；维护使用 CLOUDFLARE_STAFF_MAINTENANCE_API_TOKEN |
| preview-migrations | dev、next/staff-platform | 现有 CLOUDFLARE_PREVIEW_D1_API_TOKEN；next 仅导出并本地演练，远程迁移仍由脚本限制为 dev |

仓库共享 CLOUDFLARE_ACCOUNT_ID。环境不开放给标签或 PR 合并引用，不要求额外人工审批。现有应用密钥保持不变；PII 密钥必须匹配已有加密数据。不能把 Secrets 放入 Wrangler vars、命令参数、日志、PR、截图或构建产物。

分支规则禁止强推和删除，要求 test 检查通过；规则文件为 .github/staff-staging-ruleset.json。后续功能建议通过 PR 集成；迁移同步前核对两条历史，不能覆盖同名已执行文件。

## 本地验证与维护

~~~sh
npm run verify
npm run release:plan -- --staff-staging
npm run preview:field
~~~

本地预览使用一次性测试资源，不连接云端业务库。远程发布不会重新初始化管理员或重设密码；现有人工验收数据需保留。

~~~sh
npm run attachments:cleanup -- --staff-staging --dry-run
npm run appointments:expire -- --staff-staging --dry-run
~~~

维护工作流继续使用独立维护凭证与原并发锁。既有 STAFF_MAINTENANCE_ENABLED 仅控制定时维护，不决定后台版本或工作流。清理写入须遵循原 dry-run / apply 流程；本 PR 不删除任何云端数据资源。
