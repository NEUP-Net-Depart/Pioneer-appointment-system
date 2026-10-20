# 模块边界与公开入口

本项目采用模块化单体：Pages Functions 负责 HTTP 适配，D1 负责业务事实，R2 负责附件。模块之间通过 `src/modules/*/manifest.js` 和 `public.js` 协作；SQL 只位于 `src/db`。`src/services/staff-platform.js` 与 `src/db/staff-platform.js` 负责组合业务模块并保持公开接口。

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

`src/services/staff-platform/` 分为 context、members、roles、workspace、attendance、collections、planning、requests；依赖由工厂参数显式传入。对应仓储位于 `src/db/staff-platform/`，审计和命令条件集中在 commands，跨表修改仍在同一个 D1 batch 中完成。预约纠错的工单更新、纠错历史与全局审计共同提交或回滚。

React 的 FieldApp、Repair、RosterWorkflow 分离查询／草稿 hook 与场景、任务、候选选择和确认组件；组件复用原样式及文案。`npm run format:staff` 格式化工作人员源码和拆分后的编排模块，`verify` 检查格式，发布资源由 Vite/esbuild 压缩。

生产导航和工作台 provider 只采用 `releaseState=ready` 的 manifest。meetings 保留为扩展契约测试夹具，不注册生产入口。

兼容 API 边界：`/api/desk/summary` 复用现场 board 的授权和投影；考勤导出以 `/api/attendance/export.csv` 为当前前端入口，`/api/export/attendance.csv` 由同一处理器提供兼容；公开的 `/api/live/summary` 保留旧凭证与队列响应契约。当前学生端名额查询仍依赖 queueService 的容量计算，只有携带预约凭证的旧 summary 请求执行队列位置查询。这些兼容入口不产生第二套业务实现。
