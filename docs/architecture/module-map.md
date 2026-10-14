# 模块边界与公开入口

本项目采用模块化单体：Pages Functions 负责 HTTP 适配，D1 负责业务事实，R2 负责附件。模块之间通过 `src/modules/*/manifest.js` 和 `public.js` 协作；SQL 只位于 `src/db`，跨模块事务由 `src/services/staff-platform.js` 编排。

| 模块 | 权威表 / 责任 | 公开能力 |
| --- | --- | --- |
| identity | `members`、`staff_accounts`、激活与会话 | 成员身份、账号映射、当前操作者 |
| organization | `campuses`、`departments`、任职关系 | 字典与时点归属 |
| authorization | `permission_definitions`、`roles`、`role_grants`、`member_roles` | 完整授权、条件解释、字段范围 |
| repairs | `appointments`、`active_repairs`、附件引用 | 预约、接单、完成、维修工作量 |
| duty / attendance | `attendance_events`、`attendance_tokens`、`attendance_records`、在岗表 | 签到场次、凭证、去重和在岗状态 |
| rosters | `roster_tasks`、`availability`、`roster_versions`、`duty_assignments` | 填报、确定性草稿、发布、申请 |
| audit | `audit_events`、`operation_receipts` | 操作追踪和请求重放 |
| files | 既有附件表与 R2 适配 | 私有附件上传、读取、清理 |
| meetings（测试） | 由会议模块自有迁移扩展 | 复用 attendance policy 的会议场次 |

HTTP → 服务用例 → 模块公开入口 → D1/R2 适配。新模块必须提供 manifest、权限定义、导航、版本和测试；不得从路由直接访问 D1。
