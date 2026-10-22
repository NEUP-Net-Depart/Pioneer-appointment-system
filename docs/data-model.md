# 数据模型

Production/Preview 共用 [migrations/](../migrations/) 中的 schema 迁移。迁移只追加，运行时不建表；业务规则见 [业务规则与权限](requirements.md)。

## 核心实体

| 表 | 职责与约束 |
| --- | --- |
| `staff_accounts` / `staff_campus_grants` | 登录、会话版本和适用校区；保护账号保持启用且为 superadmin |
| `members` / `member_department_memberships` / `member_work_profiles` | 稳定成员、带有效期的多部门任职、维修／交流／办公资格 |
| `roles` / `role_grants` / `member_roles` / `permission_definitions` | 完整授权项、范围、条件与有效期 |
| `staff_whitelist` / `whitelist_campus_grants` / `activation_member_bindings` | 激活邀请及成员授权关联 |
| `activation_requests` | 每学号最多一条待审；批准时原子创建账号与授权，审核后清除密码哈希 |
| `appointments` / `active_repairs` / `repair_intake_records` | 预约、签名、状态、维修占用及设备照片核验；同一成员最多一张进行中工单 |
| `weekday_slot_capacities` / `booking_day_slots` | 每周容量模板及服务日冻结快照，包含并发版本 |
| `booking_settings` / `booking_notices` | 校区放号时间和定时公告，按版本更新并记录审计与请求回执；预约中的 `booking_notices` 保存重要公告确认快照 |
| `booking_requests` | 幂等键、输入摘要、工单引用和加密凭证，与预约原子写入 |
| `service_locations` / `service_location_changes` | 校区日期地点、版本和变更记录；已有线上工单时不可清空或删除地点 |
| `service_day_overrides` / `service_day_receipts` | 校区日期暂停及幂等回执，不删除既有业务事实 |
| `credential_recoveries` / `appointment_corrections` | 凭证补发及纠错的操作人、原因、前后值和时间 |
| `appointment_attachments` / `attachment_storage` / `storage_quota` | 附件元数据、上传预留和额度；物理删除成功后释放额度 |
| `attendance_events` / `attendance_tokens` / `attendance_records` | 场次、可替换凭证及成员签到事实 |
| `staff_presence` / `presence_events` | 当日在岗状态和变更记录 |
| `roster_tasks` / `roster_collection_series` / `roster_staffing_requirements` | 周任务、循环收集及校区日期人数需求 |
| `availability` / `roster_submissions` / `roster_availability_preferences` / `roster_preference_history` | 原始填报、整周提交及偏好时效 |
| `roster_versions` / `duty_assignments` / `duty_roles` / `roster_publication_overrides` | 草稿、发布事实、岗位及例外确认 |
| `leave_requests` / `swap_requests` / `roster_leave_facts` | 请假换班和跨修订的历史关联 |
| `audit_events` / `operation_receipts` / `roster_command_receipts` | 审计、内容摘要及幂等结果 |
| `module_catalog` / `business_rule_versions` / `staff_release_markers` | 模块投影、规则版本及发布就绪标记 |

## 持久化约束

业务日期使用 `Asia/Shanghai`，事件时间保存为 UTC ISO。任职、工作资格和授权使用有效区间；签到保存发生时姓名、部门和身份快照，成员转部门不改写历史。账号与稳定成员的映射见 [身份映射](architecture/identity-mapping.md)。

关联写入使用 D1 batch 或触发器，`revision` 防止并发覆盖；同学号同服务日有效线上预约、一人一张进行中维修由数据库约束。业务事实、必要审计及请求回执共同提交或回滚，R2 上传使用元数据状态和补偿清理。事务协作见 [工程约定](architecture/module-map.md#事务与幂等)。

密码使用 scrypt；联系方式和创建收据中的凭证使用 AES-256-GCM。学生凭证为 32 字节随机值，工单仅存 SHA-256；取回收据时再次验证当前凭证哈希，补发后旧收据失效。

`source` 区分 booking/onsite；`registered_by` 和 `registration_key` 保证现场登记幂等。`signature` 保存归一化笔迹 JSON，`front_photo_id`、`back_photo_id` 引用核验照片，恢复预约后须重新上传。

`location_snapshot`、`location_revision` 在创建事务中读取；详情展示该服务日最新地点并比较快照。缺失配置时使用 [校区默认地点](../shared/constants.js)，显式配置优先。附件用途为 general/student_photo/intake_front/intake_back；已提交及上传中的故障照片共同计入四张限额，核验照片另行校验工单、上传人、用途和有效期。

公开名额在同一 D1 batch 中读取占用数和配置，保持读取一致性。统计使用实际业务事实；原系统未记录的旧授权编辑内容不按当前身份补造。

## 迁移与兼容

迁移历史由 [基线清单](contracts/baseline-manifest.json) 保存完整文件指纹；模块契约 schemaVersion 与迁移文件序号分别管理。发布就绪检查同时校验真实表结构、触发器和迁移标记，不能仅凭版本字符串判断。

| 升级来源 | 正式迁移 | 回归脚本 |
| --- | --- | --- |
| dev 0009 | `migrations/0010_staff_platform.sql` 起 | [dev 升级 SQL](../database/upgrades/dev-0009-to-staff-platform.sql) |
| 已迁移 Preview／历史 Staff Staging | 对应链追加 `0033_staff_business_roles.sql` | 账号冲突检查、历史快照及权限回归 |

`database/staff-migrations/` 保留历史 Staff Staging 的独立迁移账本及追加升级，仅用于历史数据库兼容与隔离验证，不恢复已移除的远程部署环境。两条链均受文件指纹和 `db:verify` 检查。

`database/upgrades/` 是升级测试来源，须与对应正式迁移一致，不能绕过迁移账本直接重复执行；dev 历史夹具及原文指纹位于 `tests/fixtures/dev-migrations/`。`tests/staff-upgrade.test.mjs` 校验主迁移链升级时的历史引用保留、失败回滚和外键完整性。

保留历史编号、`repair_number` 查询别名、凭证、附件、签名和时间；旧联系及设备字段继续读取，缺失结果保留 `legacy_unknown`。历史重复和多张在修不删除，处理完成前禁止新增冲突；旧小时段仅供历史读取。

0033 删除旧管理员兼容角色、登录快照和触发器，撤销旧会话，按原校区补齐既有管理员缺少的 `repair_lead`、`technician` 角色和 `repair` 资格；已有显式范围、条件及有效期优先，过期和未来授权不被重开或提前。成员登录唯一约束在检查无重复后建立，冲突阻断升级；原账号、密码、预约和历史事实保持不变。

迁移、备份及回退步骤见 [部署与运维](operations.md)。
