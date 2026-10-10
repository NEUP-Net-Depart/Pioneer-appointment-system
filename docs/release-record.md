# 发布与重建记录

本文件记录实际授权和执行结果。云端 Preview 和 Production 已分别获批准并完成发布；旧资源删除尚未获批准且未执行。密钥值、密码、真实学生资料和访问凭证明文不得填入。

| 项目 | 记录 |
|---|---|
| 初次发布提交 / 工作区干净 | Preview 2701d07fbf17e7454d2f3d84f098a8edffb68445；Production 38cff2b09356267d936bae50fd84e339e3dd06d8；部署时工作区均干净。运行时代码基于 9ba86da，仅分别补入新环境绑定；后续整理提交名称和文档，并将 Preview 发布分支统一为 dev，未修改应用运行时代码 |
| 初始迁移 SHA-256 | 6f2b0cce7f26f98d82aff4cc2e2c4a213e3b58be436b0950906a53dc14f971dd |
| 本地完整验证 | 已通过：54 项 Node 测试、2 条 Chromium 业务场景，以及 lint、架构、编译和空库迁移检查；依赖审计零漏洞 |
| Pages 项目 / 生产分支 / 域名 | 已只读核验：pioneer-appointment-system / main / booking.ptroc.cn、reserve.neupioneer.team，均保留 |
| 首次云端 Preview 部署 ID / 地址 | c6912ee7-d4e9-413d-8745-baa24f411eb6 / https://c6912ee7.pioneer-appointment-system.pages.dev；当时分支别名 https://preview.pioneer-appointment-system.pages.dev；后续 dev 入口 https://dev.pioneer-appointment-system.pages.dev |
| Preview 桌面 / 手机完整验收 | 2 条 Chromium 业务场景全部通过（1.3 分钟），桌面和 390px 手机截图已检查；21 个资源/模块和 HTTP 健康检查通过 |
| Preview 核验人 / 时间 / 结果 | Codex 自动化及截图核验，2026-10-11 02:00（UTC+8），通过；项目所有者随后明确确认 Preview 验收通过并批准 Production 发布 |
| 原生产 D1 ID / 行数摘要 | f607819a-83a6-4217-8618-5d4fd18e8bac；旧账号 3，预约和附件 0 |
| 原生产 R2 桶 / 对象数量摘要 | pioneer-attachments；统计显示 0 对象、0 B，删除前须再次核验 |
| 数据无保留需求确认人 / 时间 | 项目所有者于 2026-10-11 明确确认原 Production 3 个旧账号无需保留 |
| 新 Preview D1 名称 / ID / R2 桶 | pioneer-appointments-preview-v2 / aa6fc47a-3677-4888-b104-bf6e2eee6a20 / pioneer-attachments-preview-v2；已创建 |
| 新 Production D1 名称 / ID / R2 桶 | pioneer-appointments-production-v2 / dd501f89-b431-462f-b9ec-403c25a27895 / pioneer-attachments-production-v2；已获批创建 |
| 两环境 Secrets 名称 / 类型 / 保管人 | JWT_SECRET / PII_ENCRYPTION_KEY 均为 secret_text；两个环境已分别生成独立随机密钥及 root 密码，仅由本机保管并配置到对应环境，不进入 Git |
| 自动发布 / 清理冻结与恢复安排 | 首次 Preview 通过 CLI 指定 preview 分支发布；后续 Git Preview 来源限定 dev。Production 操作前已关闭 Pages 自动生产发布，旧 GitHub 附件清理工作流 374832670 已禁用；恢复需先经所有者确认同步新代码到 main 并核验新目标 |
| Preview 允许的远程操作 / 批准人 / 时间 | 项目所有者于 2026-10-11 明确批准独立云端 Preview 创建与发布；范围为上述新 D1/R2、Preview 密钥及绑定、root 初始化和基于 9ba86da 补入新 Preview 绑定的版本发布、验收 |
| Production 允许的远程操作 / 批准人 / 时间 | 项目所有者于 2026-10-11 明确确认 Preview 验收通过、旧数据可弃，并批准按方案创建新生产 D1/R2、设置独立密钥和 root、切换生产绑定和发布已验收代码；保留现有 Pages 项目及域名，旧资源删除不在授权中 |
| 独立旧资源删除范围 / 批准人 / 时间 | 未批准，不包含在发布授权中 |
| Production 初始化计数检查 | 发布前及临时验收清理后均通过：2 个 enabled/protected/superadmin root、4 条校区授权；预约、附件、存储、白名单、申请和恢复记录全 0；quota=0；唯一初始迁移，无外键异常 |
| Production 部署 ID / 提交 / 域名健康 | a4f0b5f1-d4c7-4cb6-9d8c-7f953589c4ca / 38cff2b09356267d936bae50fd84e339e3dd06d8；environment=production、branch=main；booking.ptroc.cn、reserve.neupioneer.team 均 Active，完整 HTTP smoke 通过 |
| 线上激活 / 预约 / 附件验收 | 最小临时合成身份及预约验证全部通过，实际 HTTPS API 和浏览器，未模拟响应；全部临时记录和附件已精确清除，真实工作人员名册尚未导入 |
| 错误、停止点及恢复记录 | 首次只读计数通过 --file 导入通道被拒绝（too many terms in compound SELECT），已拆分并改用 --command；首次云端浏览器测试带本地模拟 CF-Connecting-IP 头，Cloudflare 拒绝请求，去掉该模拟头后完整通过；应用运行时代码未修改 |
| 正式开放确认 / 维护任务授权 | 已按项目所有者明确授权完成空库生产上线；Pages 自动生产发布及旧清理任务保持禁用，待仓库 main 同步新版本并核验维护目标后恢复 |

执行记录逐条保存：时间、操作者、操作/命令、环境、精确目标、结果摘要、关联批准记录。实际返回的新资源 ID、最终提交和迁移哈希必须能与发布计划核对。

本地已完成的验证见 `npm run verify`；本地结果不代表云端验收。执行顺序及停止条件见 [重建发布流程](operations.md)。

现有部署的只读检查见[盘点记录](remote-inventory.md)，这些结果不代表本版本已发布或获准删除旧资源。

## 云端 Preview 执行记录

| 时间（UTC） | 操作与精确目标 | 结果 |
|---|---|---|
| 2026-10-10 17:47 | 创建 D1 pioneer-appointments-preview-v2 | 成功；初始无业务表，ID 如上 |
| 2026-10-10 17:50 | 创建 R2 pioneer-attachments-preview-v2 | 成功；Standard 存储类型；验收前 0 对象 / 0 B |
| 2026-10-10 17:51 | 仅更新 Pages 项目 pioneer-appointment-system 的 Preview 密钥 | JWT_SECRET、PII_ENCRYPTION_KEY 为 secret_text；配额 536870912；Production 配置、生产部署、域名和自动部署设置与操作前基线一致 |
| 2026-10-10 | db:migrate:remote --preview --execute --approve-preview | 新 Preview D1 应用唯一 0001_initial.sql 成功 |
| 2026-10-10 | db:seed --remote --preview --execute --approve-preview | 成功创建 2 个 enabled / protected / superadmin root；4 个校区授权；密码仅由本机子进程环境提供 |
| 2026-10-10 | 新 Preview D1 只读初始化检查 | 2 个受保护 root、4 个授权；预约、附件、白名单、申请和恢复记录均 0，quota=0，唯一迁移 0001_initial.sql，无外键异常；所有检查 rows_written=0 |
| 2026-10-10 17:56 | deploy:preview --execute --approve-preview | 部署 c6912ee7-d4e9-413d-8745-baa24f411eb6 成功；environment=preview、branch=preview，实际 DB/R2 为上述新资源，独立 Secrets 类型和 512 MiB 配额正确 |
| 2026-10-10 | 新 R2 公开访问检查 | r2.dev 禁用，无自定义域名；附件仅通过受凭证/权限保护的接口访问 |
| 2026-10-10 18:00 | 两条 Chromium 云端业务场景 | 预约、自动保存、附件上传/补传/下载、私人链接、编号/学号查询拒绝、审核前登录拒绝、白名单批量核验、接单前资料及附件拒绝、接单维修、凭证重签后旧令牌失效、跨校区隔离、角色调整、停用恢复、本人改密、会话撤销、手机取消及禁用存储回退全部通过 |
| 2026-10-10 | 验收后只读检查 | Preview 保留 3 账号（含 2 个受保护 root）、3 预约、2 附件、1 白名单、1 申请、1 恢复记录，quota=34 B；3 个预约凭证均为 64 字符哈希；外键检查无异常，查询写入均 0 |
| 2026-10-10 | Production 边界及健康复核 | 配置（含 Secrets）、自动发布规则、生产部署 ID 和域名与操作前基线一致；原库仍 3 旧账号、0 预约、0 附件，复核查询写入 0；Preview 别名和两个生产域名 /api/health 均 HTTP 200 |

创建 Preview 时的原 Production 基线部署 ID 为 `5f8f0480-8ec3-4ac1-8333-cb28440e1186`；新 Production 部署见下节。

测试资料只保留在独立 Preview，未复制到 Production。初始化前后的计数、测试日志、截图和配置比较摘要已从 `.wrangler/` 与 `output/playwright/` 迁至仓库外的本机受限归档目录，并逐文件核对 SHA-256。R2 桶统计存在更新延迟，附件可用性以实际上传及下载断言为准。

Preview 当前 root 登录资料为归档目录 `credentials/preview-v2-login.txt`；`root001` 密码已随本人改密验收更新，`root002` 保留独立初始密码。两个环境 JWT/PII 密钥均由本机保管，不进入 Git。

## Production 执行记录

| 时间（UTC） | 操作与精确目标 | 结果 |
|---|---|---|
| 2026-10-10 | 创建 D1 pioneer-appointments-production-v2 和 R2 pioneer-attachments-production-v2 | 成功；新 D1 ID 如上；旧资源未删除 |
| 2026-10-10 18:08 | 冻结自动发布和旧附件维护 | Pages 自动生产发布关闭，Preview 规则未改；GitHub 清理工作流 374832670 状态 disabled_manually |
| 2026-10-10 18:08 | 仅设置新 Production 独立 Secrets | JWT_SECRET、PII_ENCRYPTION_KEY 为 secret_text，配额 8589934592；两环境的密钥和 root 密码均不同；Preview 配置及自定义域名与授权前一致 |
| 2026-10-10 | 新生产绑定完整本地验证 | npm run verify 通过：54 项 Node 测试、2 条 Chromium 业务场景和所有 lint、架构、编译、空库迁移检查 |
| 2026-10-10 | db:migrate:remote --execute --approve-production；db:seed --remote --execute --approve-production | 唯一初始迁移和两个独立密码 root 初始化成功；发布前只读计数及外键检查通过；新 R2 0 对象 / 0 B，r2.dev 禁用且无自定义域名 |
| 2026-10-10 18:13 | deploy --execute --approve-production | 部署 a4f0b5f1-d4c7-4cb6-9d8c-7f953589c4ca 成功；项目、main/production、新 DB/R2、8 GiB 配额与计划一致；Preview 配置未改，自定义域名保留且 Active |
| 2026-10-10 | 两个正式域名 HTTP smoke | /、/staff/、21 个资源/模块、/api/health、JSON 错误及旧/私有路径均通过 |
| 2026-10-10 18:17 | 最小线上业务验收 | 两个 root 登录及会话撤销、本人改密与旧会话拒绝、跨环境 JWT 拒绝、白名单/申请/待审登录拒绝/原子审批、预约凭证/排队/PII 解密、真实 R2 上传下载、越权拒绝、维修接单完工、凭证补发及旧凭证失效、浏览器私人链接及自动保存刷新均通过 |
| 2026-10-10 18:17 | 精确清理本次临时验收数据 | 先删除唯一新 R2 对象，再删除对应存储预留（触发器释放配额）、恢复记录、预约、申请、白名单、非保护临时账号及级联授权；最终只读计数全通过；直接远程读取该 R2 键确认对象不存在，桶统计 0 对象 / 0 B |

临时范围在写入前保存在本机审计报告中：标记 `PUBLISH_CHECK_ffe47a83-17ac-4cec-98d7-9dcbde138f47`；合成机主学号 `9999918917382846`、合成部员学号 `9998445171043430`；申请 `1e3cb8b9-8db1-4118-876e-ac27e96cb29f`；预约 `020261012-01`；对象 `pioneer-attachments-production-v2/appointments/020261012-01/89525ad9-4562-411c-81ce-41a892ed474a`。这些均为本次创建且已清理的合成标识，清理未涉及旧资源或其他业务数据。

Production 当前 root 登录资料为归档目录 `credentials/production-v2-login.txt`，已包含 `root001` 线上本人改密后的当前密码。密钥保管文件为 `credentials/cloud-production-v2-secrets.json`；不得公开或提交。完整执行报告和最终只读计数为归档目录 `audit/production-v2-business-check.json` 与 `audit/production-v2-final-counts.json`。归档限制为本机操作者和 SYSTEM 访问，具体路径由操作者在交付时提供。

本机每阶段保留一个提交，统一采用历史 `[refactor]` / `[feat]` 命名；阶段六位于 `dev`。按所有者 2026-10-11 最新要求，整理和清理后只推送 `dev`，`main` 的 rebase 和推送等待另行确认；未创建 PR。提交映射、Git 恢复包、推送与 CI / dev Preview 的复核结果保存在仓库外归档目录，详细恢复安排见 [流程结束状态](operations.md#7-本次发布结束状态)。旧 D1/R2 和现有项目、域名均保留。
