# 数据库结构

当前 schema 由 `migrations/` 下按编号执行的迁移共同定义。后续变更只追加递增编号迁移；应用运行时不会迁移数据库或初始化账号。

| 实体 | 职责与约束 |
|---|---|
| `staff_accounts` | 工作人员账号；角色仅 `technician`、`admin`、`superadmin`，状态为 `enabled` 或 `disabled`；`home_campus` 只描述所属校区；受保护 root 必须为启用的 `superadmin` |
| `staff_campus_grants` | 独立的校区授权；所属校区不会自动产生数据访问权；复合主键防止重复授权 |
| `staff_whitelist` | 学号资格、预期角色、可选预期姓名和 `open`/`revoked`/`activated` 状态；不保存密码或登录身份 |
| `whitelist_campus_grants` | 白名单申请允许的校区；申请人不能自行提升角色或扩大授权 |
| `activation_requests` | 自主激活资料、密码哈希、申请回执哈希和审核记录；同一学号最多一条待审申请；拒绝后允许重新申请 |
| `appointments` | 业务编号用于展示；学生访问凭证独立随机生成，数据库只保存 SHA-256 |
| `slot_capacities` | 校区、时段联合主键；持久保存人数和 revision，所有预约日期共用 |
| `credential_recoveries` | 凭证人工补发记录，保存操作人、核验说明和时间，不保存凭证明文 |
| 附件与额度 | R2 保存私有对象，D1 保存元数据和容量预留；失败补偿、过期和删除状态保持原子约束 |

学生预约不创建账号，也不存在 `student` 登录角色。学生凭独立预约访问凭证查询、取消、排队和访问附件；预约编号或学号不能单独读取敏感数据。

账号权限同时受角色、账号状态、校区授权和对象归属约束。停用账号保留历史接单关联；不提供删除账号 API。账号、白名单、激活申请和预约使用 revision 或状态条件防止并发覆盖，校区授权更新与账号 revision 在同一 D1 batch 中提交。

待审激活申请不能登录。管理员必须人工核验身份后审批；通过审核时原子创建正式账号和校区授权。凭证遗失也必须人工核验，补发后旧凭证立即失效。

## 签名、签到照片与预约编号

- `appointments.signature`：经过坐标、点数和笔迹长度校验的归一化手写笔迹 JSON，与 `agreement_at`、`agreement_version` 一起保存；旧记录为空。
- `appointments.id`：新预约为 `reserve{校区代码}{预约日期YYYYMMDD}-{序号}`，南湖 `0`、浑南 `1`。序号至少两位，按校区、预约日期原子递增，两个时段共用，避让数据库中的历史预约序号。历史主键及凭证、附件关联不改写。
- `appointments.repair_number`：仅保存历史维修编号，保留可空唯一列和 `idx_repair_number` 索引；新预约为 `null`，维修结束不写入。API 保留只读 `repairNumber` 字段，历史号可查询、展示和导出；CSV 最后一列为“历史维修编号”。
- `appointments.front_photo_id` / `back_photo_id`：成功签到选用的正反面照片 ID；撤回签到会清空。附件按原有 180 天策略清理后仍可保留 ID 作为历史引用。
- `appointment_attachments.purpose`：`general` / `intake_front` / `intake_back`；`uploaded_by` 由服务器从登录账号写入。签到校验预约归属、照片类型、有效期、用途和上传人，不接受学生附件或其他工作人员的照片代替。

## 预约容量约束

`slot_capacities` 包含 `campus`、`time_slot`、`capacity`、`revision`。CHECK 约束限制现有两校区、两时段，capacity 默认为 10，范围为 0 至 9007199254740991，必须以整数存储。四组配置由迁移初始化，更新时匹配旧 revision 并递增版本。

预约触发器在新增、从已取消恢复或更换日期、校区、时段等重新占用名额时读取目标配置：容量为 0 触发 `SLOT_PAUSED`，已达容量触发 `SLOT_FULL`。普通签到、维修说明更新及结束操作不触发容量检查；只有已取消的预约释放名额。

公开名额查询在同一 D1 batch 中读取占用数和配置，保持一致的读取状态。迁移和发布顺序见 [部署与运维](operations.md)。
