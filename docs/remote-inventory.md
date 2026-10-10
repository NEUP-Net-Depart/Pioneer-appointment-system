# 远程资源只读盘点

日期：2026-10-11（Asia/Shanghai），独立云端 Preview 授权之前的只读快照。此轮盘点使用既有 Cloudflare OAuth，未创建/删除资源、执行迁移、写入业务数据、更新 Secrets/绑定/域名/发布设置或发布本版本。D1 所有 SELECT 结果的 `rows_written=0`、`changed_db=false`。随后获批的 Preview 创建和发布另见 [发布记录](release-record.md)。

## 当前项目

- Pages：`pioneer-appointment-system`，Git 集成启用，生产分支 `main`。
- 自定义域名：`booking.ptroc.cn`、`reserve.neupioneer.team`，状态均为 Active，保留。
- 自动发布：Production 启用；Preview 为 `all`，包括 `*`、无排除分支。推送分支有发布风险，须在获批窗口内处理相应环境的发布控制。
- 操作前两环境绑定与当时的本地 `wrangler.jsonc` D1 ID、R2 桶名一致。
- 两环境的 `JWT_SECRET`、`PII_ENCRYPTION_KEY` 均为 `secret_text`，`MAX_R2_BYTES` 为 `plain_text`。只记录名称和类型，未读取或导出 Secret 值；不能据此证明两个环境密钥不同。

| 检查 | 原 Production | 原 Preview |
|---|---|---|
| D1 ID | f607819a-83a6-4217-8618-5d4fd18e8bac | 4e30f54b-564e-4801-87e0-ea3a7a85d510 |
| 旧 `users` 账号数 | 3 | 2 |
| 预约数 | 0 | 0 |
| 附件元数据 / 存储记录 | 0 / 0 | 0 / 0 |
| storage_quota.used_bytes | 0 | 0 |
| R2 桶 | pioneer-attachments | pioneer-attachments-preview |
| R2 统计 | 0 对象、0 B | 0 对象、0 B |
| 已执行迁移 | 0001_initial.sql、0002_query_indexes.sql、0003_attachment_storage.sql | 同左 |

两个数据库均存在旧 `users` 表，没有新 `staff_accounts`、白名单和申请结构。重写后的初始迁移不能直接用于原库；按方案新建资源。R2 统计不是未来删除时的完整对象清单，处置前须重新盘点并确认全量对象范围。

旧版本的 `https://booking.ptroc.cn/api/health`、`https://reserve.neupioneer.team/api/health` 均返回 HTTP 200，`ok:true`、`database:d1`、`attachments:r2`。这是现有部署基线，本次新版本尚未在云端验收。

## 方法与待确认事项

使用 `wrangler whoami`、`pages project list`、`r2 bucket list/info`，以及 D1 SELECT 表结构/计数/配额/迁移名称；另外通过 Pages 项目与域名 GET API 读取非敏感配置，HTTP GET 检查现有健康端点。未查询学生资料、密码哈希或访问凭证。相关两个旧 Pages 项目使用另一 D1 ID；仍须在删除任何旧资源前核对所有应用的实际引用。

尚需负责人确认原生产 3 个账号是否全为无保留需求的数据；当前计数不能代替该确认。独立云端 Preview 创建及发布、Production 重建及发布、旧资源删除分别待明确授权。新资源创建后填入实际 ID，更新最终发布计划和记录。
