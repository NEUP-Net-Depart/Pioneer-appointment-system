# 数据库结构

当前 schema 由 `migrations/` 下按编号执行的迁移共同定义；`0001_initial.sql` 创建初始结构，`0002_slot_capacity.sql` 将每校区每时段的预约上限调整为 10 人。后续线上变更使用递增编号迁移。应用运行时不会迁移数据库或初始化账号。

| 实体 | 职责与约束 |
|---|---|
| `staff_accounts` | 工作人员账号；角色仅 `technician`、`admin`、`superadmin`，状态为 `enabled` 或 `disabled`；`home_campus` 只描述所属校区；受保护 root 必须为启用的 `superadmin` |
| `staff_campus_grants` | 独立的校区授权；所属校区不会自动产生数据访问权；复合主键防止重复授权 |
| `staff_whitelist` | 学号资格、预期角色、可选预期姓名和 `open`/`revoked`/`activated` 状态；不保存密码或登录身份 |
| `whitelist_campus_grants` | 白名单申请允许的校区；申请人不能自行提升角色或扩大授权 |
| `activation_requests` | 自主激活资料、密码哈希、申请回执哈希和审核记录；同一学号最多一条待审申请；拒绝后允许重新申请 |
| `appointments` | 业务编号用于展示；学生访问凭证独立随机生成，数据库只保存 SHA-256 |
| `credential_recoveries` | 凭证人工补发记录，保存操作人、核验说明和时间，不保存凭证明文 |
| 附件与额度 | R2 保存私有对象，D1 保存元数据和容量预留；失败补偿、过期和删除状态保持原子约束 |

学生预约不创建账号，也不存在 `student` 登录角色。学生凭独立预约访问凭证查询、取消、排队和访问附件；预约编号或学号不能单独读取敏感数据。

账号权限同时受角色、账号状态、校区授权和对象归属约束。停用账号保留历史接单关联；不提供删除账号 API。账号、白名单、激活申请和预约使用 revision 或状态条件防止并发覆盖，校区授权更新与账号 revision 在同一 D1 batch 中提交。

待审激活申请不能登录。管理员必须人工核验身份后审批；通过审核时原子创建正式账号和校区授权。凭证遗失也必须人工核验，补发后旧凭证立即失效。

## 签名、签到照片与独立编号（0004）

- `appointments.signature`：经过坐标、点数和笔迹长度校验的归一化手写笔迹 JSON，与 `agreement_at`、`agreement_version` 一起保存；旧记录为空。
- `appointments.id`：新预约使用 `reverse` 前缀，校区 + 上海提交日期 + 当日校区序号。旧 ID 保留，继续承担附件和访问凭证关联。
- `appointments.repair_number`：可空且唯一，首次完成有效维修结果时生成。日期取实际完成时的上海日期，序号单独查询维修单序列，与预约序列无关。编号分配和状态变更在同一带 revision 条件的 D1 UPDATE 内提交，并发安全；取消、未到场不生成。
- `appointments.front_photo_id` / `back_photo_id`：成功签到选用的正反面照片 ID；撤回签到会清空。附件按原有 180 天策略清理后仍可保留 ID 作为历史引用。
- `appointment_attachments.purpose`：`general` / `intake_front` / `intake_back`；`uploaded_by` 由服务器从登录账号写入。签到校验预约归属、照片类型、有效期、用途和上传人，不接受学生附件或其他工作人员的照片代替。

新迁移以增列和唯一索引方式升级，不修改历史记录、附件和凭证。部署新版 API 前须先应用 0004 迁移。
