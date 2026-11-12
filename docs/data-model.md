# 数据模型

业务基线见 [v1.2](requirements.md)。运行时不建表，迁移只追加。正式链为 `migrations/`；历史 Staff 数据库独立账本位于 `database/staff-migrations/`，两条链均包含签名格式转换迁移 0053。

| 数据 | 用途 |
| --- | --- |
| staff_accounts / members / member_department_memberships | 登录、稳定人员、带时间的真实任职 |
| staff_campus_grants / staff_access_campuses | 配置校区及任职产生的全校范围 |
| roles / role_grants / member_roles | 剩余系统配置权限，不含独立维修资格包 |
| staff_whitelist / whitelist_campus_grants / activation_requests | 登录邀请和账号激活核验 |
| appointments | 预约及工单、接收事实、当前主修、结果、待传经办人、直接返修关系 |
| repair_intake_records / appointment_corrections / credential_recoveries | 原始核验、修改及凭证补发历史 |
| weekday_slot_capacities / booking_day_slots / booking_requests | 线上容量模板、实际日期容量、创建幂等回执 |
| booking_settings / booking_notices / service_locations / service_location_changes | 放号、公告与确认版本、地点快照和变更 |
| service_day_overrides / service_day_receipts | 暂停服务及幂等操作，不删除原记录 |
| appointment_attachments / attachment_storage / storage_quota | 原照片引用、R2 对象、上传预留及额度 |
| roster_weeks / duty_assignments | 周/校区/类型班表版本、保留全部 ID 的有效与历史班次 |
| member_availability | 通常时间（空周键）和指定周例外 |
| roster_leaves / roster_covers | 请假事实与接替确认历史 |
| attendance_events / attendance_tokens / attendance_records | 场次、现场凭证、实际到岗事实 |
| attendance_reviews | 关联班次及当时成员的未到/撤销结论、版本、原因、操作者与操作时间；完整变更历史保存在审计 |
| staff_presence / presence_events | 考勤在岗记录，与维修操作解耦 |
| audit_events / operation_receipts | 操作前后值、访问审计、请求回执 |

预约主状态 booked / in_progress / completed / cancelled / expired。新服务结果 repaired / partially_repaired / unrepaired / not_needed；历史未修复保留 legacy_unrepaired，原未分类保留 legacy_unknown，不补造更具体的结果。parent_appointment_id 和 link_kind 表达原故障续修或复发，与本次结果独立。

数据库触发器继续控制线上容量、同人同日有效线上预约、附件关联与关键状态转换。现场登记不占容量，没有 active_repairs、单人维修占用或待接手约束。received_at/received_by 记录实际接收；photo_deferred_by 追踪人工补传，经手和维修责任分别记录。

联系方式与创建回执中的私人凭证加密保存，学生凭证仅存哈希。访问单张工单联系方式留审计，不在列表或审计中重复明文存储。学生端采用明确的公开字段投影，关联历史沿用同一投影。

## 历史迁移

| 迁移 | 一次性转换与保留 |
| --- | --- |
| 0044 | 未接收预约延长至预约日次日零点，保存旧有效期审计；不恢复终态 |
| 0045 | 完整归档队列、预分派、占用事实；待分派回到待接单，保留已接收事实；在修主修、照片和原 ID 保留；旧未修复结果明确标为历史未细分 |
| 0046 | 归档全部返修申请；已排期工单关联原单，待处理明确归档为未安排，拒绝记录归档；删除申请表 |
| 0047 | 归档并删除独立工作权限包与资格推导视图，保留人员、真实任职、签到和系统授权 |
| 0048 | 完整归档旧排班原始行，保留所有班次 ID；原发布班次有效，其余作为历史；转换通常时间、明确周例外、直接请假和有效待确认互换 |
| 0049 | 逐单归档旧登记类型并删列；归档撤销废弃条件授权，清理权限元数据及旧队列索引 |
| 0050 | 追加班次核查结论表和 duty-workflow-0050 就绪标记，不修改既有班次、签到、请假或接替历史 |
| 0053 | 将归一化签名数组一次性转换为带画布尺寸的签名文档，保留笔画与点的顺序；运行时仅接收、展示文档格式 |

旧迁移文件与账本不得修改。旧库若尚未执行 0042，先满足其不可变的人员确认前提，再依次执行后续迁移；这不是运行时业务审批。历史编号和凭证继续定位原记录，已存在照片对象不删除，原签到和审计不重算。迁移文件校验和保存在 `database/migration-checksums.json`，追加迁移时同步登记。

签名存于 `appointments.signature`，唯一格式为 `{version:2,width,height,strokes}` 的 JSON；坐标单位是逻辑画布的 CSS 像素，不包含屏幕 DPR。前后端共用尺寸、点数和轨迹校验。学生端与现场端共用 `shared/signature-pad.js`，采用固定笔宽的平滑曲线，回显按同一规则等比缩放。旧数组没有记录原始画布比例，0053 采用原历史详情视图的 560×200 坐标空间转换，无法恢复当时的书写区域比例。发布前执行迁移，已打开的旧页面需刷新后再签名。

验证涵盖两条链的带数据转换、原记录字段比较、外键完整性，以及真实本地 D1 的全新应用和账本重复应用。迁移与备份步骤见 [运维](operations.md)。
