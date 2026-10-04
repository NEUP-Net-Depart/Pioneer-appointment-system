# 部署与运维

[返回 README](../README.md)。以下命令在仓库根目录执行，资源名称按实际账号调整。

> `main` 是生产分支。日常开发和文档修改使用开发分支；向 `main` 推送、合并或执行 `npm run deploy` 前，须明确确认发布内容并获得授权。启用 Pages Git 集成后，推送 `main` 会触发生产构建与发布。

## 首次生产部署

### 1. 准备资源

新环境创建一个 Pages 项目、一个 D1 数据库和一个私有 R2 桶；已有资源可直接使用：

```bash
npx wrangler login
npx wrangler pages project create pioneer-appointment-system --production-branch main
npx wrangler d1 create pioneer-appointments
npx wrangler r2 bucket create pioneer-attachments
```

将实际项目名、D1 名称与 `database_id`、R2 桶名填入 [wrangler.jsonc](../wrangler.jsonc) 顶层，保留绑定名 `DB`、`ATTACHMENTS`。R2 不开启公开域名，附件通过鉴权 API 访问。

scrypt 使用 Workers 原生 `node:crypto`；保留 `nodejs_compat` 和 `limits.cpu_ms=1000`，生产使用可容纳此预算的 Workers Paid 计划。参见 [Pages 绑定](https://developers.cloudflare.com/pages/functions/bindings/) 与 [运行限制](https://developers.cloudflare.com/pages/functions/wrangler-configuration/#limits)。

### 2. 配置密钥

在 Pages → Settings → Variables and Secrets → **Production** 添加 Secret：

| 名称 | 要求与用途 |
|---|---|
| `JWT_SECRET` | 至少 32 字符的随机字符串；JWT 签名和限流键 HMAC |
| `PII_ENCRYPTION_KEY` | 64 位十六进制随机值；AES-256-GCM 联系方式加密 |

也可用 CLI 交互写入：

```bash
npx wrangler pages secret put JWT_SECRET --project-name pioneer-appointment-system
npx wrangler pages secret put PII_ENCRYPTION_KEY --project-name pioneer-appointment-system
```

在受信任终端分别生成两个随机值并妥善保存：

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

密钥不写入 Git、Wrangler `vars` 或前端。缺失密钥或绑定时服务拒绝请求。备份 `PII_ENCRYPTION_KEY`；直接替换会导致历史联系方式无法解密，替换 JWT 密钥会使旧会话失效。

### 3. 迁移、初始化并发布

```bash
npm run db:migrate:remote
```

通过本机环境变量设置两个不同的 16–128 字符初始密码。PowerShell 7 示例：

```powershell
$env:ROOT001_PASSWORD = Read-Host 'root001 初始密码' -MaskInput
$env:ROOT002_PASSWORD = Read-Host 'root002 初始密码' -MaskInput
npm run db:seed -- --remote
Remove-Item Env:ROOT001_PASSWORD, Env:ROOT002_PASSWORD
```

其他 shell 使用同名环境变量。种子脚本在本机生成 scrypt 哈希，仅插入缺失的 `root001`、`root002`，不会重置已有密码；这些密码不放入 Pages Secrets。

```bash
npm run verify
npm run deploy
```

`deploy` 校验 D1 ID、构建、应用远程迁移，再将 `dist/` 和 `functions/` 发布到同一 Pages 项目的 `main` 分支。仅拖拽 `dist/` 上传会遗漏 Functions。

使用 Pages Git 集成时，根目录为仓库根，构建命令 `npm run build`，输出目录 `dist`；迁移和账号初始化需单独执行。GitHub 的 [检查工作流](../.github/workflows/check.yml) 不自动部署。CI 调用 Wrangler 时需配置 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN` 及相应 Pages/D1/R2 权限。

### 4. 域名与验收

外部 DNS 使用子域名时，先在该 Pages 项目的 Custom domains 添加 `repair.example.edu`，再到 DNS 服务商添加 `repair` 的 CNAME，指向实际的 `<项目名>.pages.dev`。等待域名与 HTTPS 状态为 Active；有 CAA 限制时按提示调整，无需迁移整个域名的 nameserver。[自定义域名说明](https://developers.cloudflare.com/pages/configuration/custom-domains/)

上线后确认 `/api/health` 返回 `database: d1`、`attachments: r2`，并用真实域名完成预约、附件上传、工作人员接单和访客查询。用户端 `/`、工作人员端 `/staff/` 与 `/api/*` 保持同源。

## Preview 环境

Preview 使用同一 Pages 项目，配置独立 D1、R2 和另一组 JWT/PII Secrets，不复制真实预约资料。

```bash
npx wrangler d1 create pioneer-appointments-preview
npx wrangler r2 bucket create pioneer-attachments-preview
```

将实际资源填入 `wrangler.jsonc` 的 `env.preview`，在 Pages **Preview** 环境添加密钥。按生产步骤设置测试 root 密码环境变量后执行：

```bash
npx wrangler d1 migrations apply DB --remote --env preview
npm run db:seed -- --remote --preview
npm run deploy:preview
```

发布脚本使用 `preview` 分支，拒绝与生产共用 D1 ID 或 R2 桶名。未配置 Preview 前不要发布非 `main` 分支；生产发布只使用顶层资源。

## 附件容量与清理

`MAX_R2_BYTES` 是 `wrangler.jsonc` 中的字节限额：生产 `8589934592`（8 GiB），Preview `536870912`（512 MiB）。值必须是正整数十进制字符串且不超过 JavaScript 安全整数；未设置时默认 8 GiB。

上传先在 D1 预留容量，确认 R2 对象删除后才释放；过期未清理、上传未完成或补偿失败的对象仍占额度。不要绕过应用上传对象，也不要直接修改 `storage_quota` 或删除 `attachment_storage` 记录腾空间。R2 免费额度按账号共享，应用配额不保证免费；费用见 [R2 定价](https://developers.cloudflare.com/r2/pricing/)。

### 已有附件的项目升级

1. 暂停上传并备份 D1/R2，核对 `appointments/` 下对象与旧附件元数据的 key、大小；备份并清理确认孤立的对象，修正大小差异。
2. 分别执行 `npm run deploy`、`npm run deploy:preview`，完成迁移与代码发布；期间保持上传暂停。迁移按原上传时间回填 180 天期限，已过期附件立即停止展示和下载。
3. 配置下述清理任务，先 dry-run、再实际清理；核对 `storage_quota.used_bytes` 等于 `attachment_storage` 大小之和后恢复上传。超额时会继续拒绝新上传。

### R2 生命周期与每周任务

为两个桶的 `appointments/` 前缀设置 180 天删除规则。先查看已有规则，同名规则应更新并保留其他规则：

```bash
npx wrangler r2 bucket lifecycle list pioneer-attachments
npx wrangler r2 bucket lifecycle add pioneer-attachments delete-old-attachments appointments/ --expire-days 180
npx wrangler r2 bucket lifecycle list pioneer-attachments-preview
npx wrangler r2 bucket lifecycle add pioneer-attachments-preview delete-old-attachments appointments/ --expire-days 180
```

[生命周期删除](https://developers.cloudflare.com/r2/buckets/object-lifecycles/) 有延迟，且不更新 D1；应用到期即拦截访问，清理任务确认对象删除后同步元数据和额度。

在 GitHub → Settings → Secrets and variables → Actions 配置 `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`，Token 需对应账号的 D1 编辑与 Workers R2 Storage 写入权限。[清理工作流](../.github/workflows/cleanup-attachments.yml) 合入默认分支后，每周一北京时间 03:17 清理两个环境；同环境串行，失败显示为 Actions 失败。手动运行可选择环境，默认 dry-run，取消后才删除。

本地设置相同环境变量后可执行：

```bash
npm run attachments:cleanup -- --dry-run
npm run attachments:cleanup -- --apply
```

加 `--preview` 操作 Preview；无参数也是 dry-run。每批处理 100 条，清理过期附件、超过 24 小时的未完成预留及待重试删除。单条失败保留记录和额度，继续处理其他对象并最终返回失败，可安全重跑。公开仓库连续 60 天无活动时，GitHub 可能停用定时工作流，需重新启用；R2 生命周期独立运行。[定时工作流说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## 备份与恢复

```bash
npx wrangler d1 export DB --remote --output <安全备份路径>
```

Preview 导出加 `--env preview`。数据库恢复参考 [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)；R2 对象单独备份，并保管对应环境的 PII 密钥。
