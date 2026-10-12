# 数据库结构

Schema 以 [migrations/](../migrations/) 按编号执行的 SQL 为准，只追加迁移，运行时不初始化。发布顺序见 [部署运维](operations.md)，业务与权限见 [业务规则](requirements.md)。

| 实体 | 职责与主要约束 |
|---|---|
| `staff_accounts` | 工作人员身份、角色、启停状态；保护 root 必须是启用的 superadmin，停用账号保留历史关联 |
| `staff_campus_grants` | 账号与授权校区复合主键；所属校区不自动授予权限 |
| `staff_whitelist` / `whitelist_campus_grants` | 激活资格、预期身份及授权范围，不保存登录身份 |
| `activation_requests` | 激活资料、密码与回执哈希、审核记录；同一学号最多一条待审，通过时原子创建账号与授权并清除申请密码哈希 |
| `appointments` | 预约和现场登记、协议签名、负责人、维修状态与记录；学生访问凭证仅存 SHA-256 |
| `active_repairs` | 账号主键、工单唯一外键，触发器原子维护进行中占用，覆盖新旧 API |
| `slot_capacities` | 校区与时段联合主键，人数与 revision 持久保存，所有预约日期共用 |
| `credential_recoveries` | 人工补发凭证的操作人、核验说明和时间，不存凭证明文 |
| 附件与额度 | R2 存私有对象，D1 保存元数据、容量预留和清理状态，删除对象成功后才释放额度 |

账号、白名单、激活申请及预约通过 revision 或状态条件防止并发覆盖；关联写入使用 D1 batch 或触发器保持原子性。联系方式加密存储；学生没有账号，不存在 student 登录角色。

## 编号、签名和照片

- `appointments.id`：`reserve{校区代码}{YYYYMMDD}-{序号}`；南湖 `0`、浑南 `1`，按校区及预约日期原子递增，两个时段共用并避让历史序号。历史主键、凭证及附件关联不改写。
- `repair_number`：仅保留历史维修编号及唯一索引，新记录为 `null`；API 的 `repairNumber` 只读，仍支持查询、展示和导出。
- `signature`：经坐标、点数与笔迹长度校验的归一化 JSON，与 `agreement_at`、`agreement_version` 一起保存，旧记录可为空。
- `front_photo_id` / `back_photo_id`：签到选用的照片，撤回签到清空；附件到期后可保留 ID 作为历史引用。
- `appointment_attachments.purpose`：`general` / `intake_front` / `intake_back`；`uploaded_by` 从当前账号写入，签到校验工单、用途、上传人及有效期，不能用学生或他人的照片代替。

## 并发与名额约束

迁移 0006 为 `appointments` 增加 `source`（默认 `booking`，现场为 `onsite`）、`registered_by`、`registration_key`。登记人和请求编号的联合唯一索引保证重试只建一条记录。现场登记使用服务器当天日期及第一个时段作为兼容存储值，界面区分来源；不计入线上名额、排队或未到场处理，管理和导出仍可读取。

`active_repairs` 阻止工作人员新增第二张进行中工单。升级前已有多张时，不结束或改派历史记录；每个账号先保留一条占用，完成后转到其余旧工单，全部处理完才允许新签到。签到及完成的同内容重试返回原结果，不重复更新 revision 或时间；不同内容的过期请求返回 409。

`slot_capacities` 限定两校区、两时段，容量默认 10，必须是 0 至 9007199254740991 的整数，更新匹配并递增 revision。预约新增、取消后恢复或更改日期/校区/时段时，触发器检查容量：0 返回 `SLOT_PAUSED`，满额返回 `SLOT_FULL`；只有取消释放名额，普通签到及维修更新不重新占额。公开名额查询在同一 D1 batch 中读取占用与配置。
