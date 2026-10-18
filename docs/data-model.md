# 数据模型

Schema 以 [migrations/](../migrations/) 为准，迁移只追加，运行时不建表。业务规则见 [业务规则与权限](requirements.md)。

| 表 | 职责与约束 |
|---|---|
| `staff_accounts` / `staff_campus_grants` | 账号、角色、启停及校区授权；保护账号保持启用且为 superadmin |
| `staff_whitelist` / `whitelist_campus_grants` | 激活资格、预期角色和授权范围 |
| `activation_requests` | 每学号最多一条待审；批准时原子创建账号与授权，审核后清除密码哈希 |
| `appointments` | 预约、现场登记、签名、状态、维修结果和负责人 |
| `active_repairs` | 账号主键、工单唯一外键，约束一人一张维修中工单 |
| `weekday_slot_capacities` / `booking_day_slots` | 每周容量模板及服务日冻结快照，包含并发版本 |
| `booking_requests` | 幂等键、输入摘要、工单引用和加密凭证，与预约原子写入 |
| `service_locations` / `service_location_changes` | 校区＋日期的完整地点名称、版本和审计；已有线上工单时不可清空或删除地点 |
| `credential_recoveries` / `appointment_corrections` | 凭证补发及纠错的操作人、原因、前后值和时间 |
| `appointment_attachments` / `attachment_storage` / `storage_quota` | 附件元数据、上传预留和存储额度；物理删除成功后释放额度 |

## 持久化约束

业务日期按上海时区计算，事件时间保存为 UTC ISO。关联写入使用 D1 batch 或触发器，`revision` 防止并发覆盖；同学号同服务日的有效线上预约由触发器原子限制。

密码使用 scrypt；联系方式和创建收据中的凭证使用 AES-256-GCM。学生凭证为 32 字节随机值，工单仅存 SHA-256；取回收据时再次验证当前凭证哈希，补发后旧收据失效。

`source` 区分 booking/onsite；`registered_by` 和 `registration_key` 保证现场登记幂等。`signature` 保存归一化笔迹 JSON，`front_photo_id`、`back_photo_id` 引用签到照片，恢复预约后须重新上传。

`location_snapshot`、`location_revision` 在创建事务中读取；详情展示该服务日最新地点并比较快照。新预约缺失配置时使用 [校区默认地点](../shared/constants.js)，管理员保存的完整地址优先。

附件用途为 general/student_photo/intake_front/intake_back。已提交及上传中的故障照片一起计入四张限额；签到照片不占此限额，校验工单、上传人、用途和有效期。

## 兼容与检查

保留历史编号、`repair_number` 查询别名、凭证、附件、签名和时间；旧联系及设备字段继续读取，缺失维修结果保留 `legacy_unknown`。历史重复和多张维修中工单不删除，处理完成前禁止新增冲突工单；旧小时段仅供历史读取。

公开名额查询在同一 D1 batch 中读取占用数和配置，保持一致的读取状态。迁移和发布顺序见 [部署与运维](operations.md)。

## 工作人员平台（0007）

`members` 是稳定人员主键；`staff_accounts.member_id` 只表示登录映射。`departments`、`campuses`、`locations` 是可扩展字典，`member_department_memberships` 保存带生效区间的多部门任职，`member_work_profiles` 保存维修 / 交流 / 办公工作资格。角色、完整授权项和模块投影分别位于 `roles`、`role_grants`、`member_roles`、`permission_definitions` 和 `module_catalog`。

`attendance_events`、`attendance_tokens`、`attendance_records` 三表分别保存场次、可替换凭证和成员事实；`staff_presence` 与 `presence_events` 保存当日在岗变化。`roster_tasks`、`availability`、`roster_versions`、`duty_assignments` 和 `duty_roles` 保存排班输入、规则 / 算法版本和发布事实。请假与换班使用 `leave_requests`、`swap_requests`，`audit_events` 与 `operation_receipts` 和业务写入一起记录审计及幂等回执。

`repair_intake_records` 独立保存确认接单时的操作者、成员映射、设备正反面照片和核验时间；预约状态与维修占用由 `appointments` / `active_repairs` 维护，现场登记的 `registered_by` / `registration_key` 保留入口和重复请求关联。

历史签到保存发生时部门和身份快照；成员转部门或资料更正不会重写历史事实。业务日期按 `Asia/Shanghai` 保存，事件时点使用 UTC ISO 字符串。`active_repairs.member_id` 兼容旧账号占用并保证同一成员只有一张进行中维修。
