# 数据库结构与约束

Schema 以 [migrations/](../migrations/) 为准，迁移只追加，运行时不初始化。业务含义见 [业务规则](requirements.md)，执行顺序见 [部署运维](operations.md)。

| 实体 | 职责与约束 |
|---|---|
| `staff_accounts` / `staff_campus_grants` | 身份、角色、启停和校区授权；受保护 root 必须启用且为 superadmin |
| `staff_whitelist` / `whitelist_campus_grants` | 激活资格、预期角色和授权范围 |
| `activation_requests` | 同一学号最多一条待审；通过时原子创建账号与授权，审核结束清除申请密码哈希 |
| `appointments` | 预约、现场登记、协议签名、负责人、状态和维修结果 |
| `active_repairs` | 账号主键、工单唯一外键，触发器约束一人一张进行中工单，覆盖新旧 API |
| `slot_capacities` | 校区与时段联合主键，容量和 revision 持久保存 |
| `credential_recoveries` | 补发凭证的操作人、核验说明和时间 |
| 附件与额度表 | 保存 R2 元数据、容量预留和清理状态；删除对象成功后才释放额度 |

密码使用 scrypt；联系方式使用 AES-256-GCM；学生凭证为 32 字节随机值，D1 仅存 SHA-256。事件时间保存为 UTC ISO，业务日期按上海时区计算。关联写入通过 D1 batch 或触发器保持原子性，并以 revision 或状态条件防止并发覆盖。

## 历史兼容

- 新记录只使用预约 `id`，`repair_number` 为 null；历史主键、维修号、凭证和附件关联不改写，旧维修号仍可查询、展示、导出。
- `signature` 为校验后的归一化笔迹 JSON，与 `agreement_at`、`agreement_version` 保存，旧记录可为空。
- `front_photo_id` / `back_photo_id` 记录签到照片，撤回签到清空；到期后可保留历史引用。签到校验附件的工单、用途、上传人和有效期。
- 附件 `purpose` 为 `general`、`intake_front` 或 `intake_back`，`uploaded_by` 来自当前账号。

## 并发约束

迁移 0006 增加 `source`（booking/onsite）、`registered_by`、`registration_key`，保证临时登记重试幂等；迁移 0007 增加现场登记的 `expired` 结果和单条待签到约束。现场记录使用服务器当天日期及首个时段存储，不计线上容量、排队和未到场。

历史多张进行中工单不自动结束或改派：`active_repairs` 在旧工单间接续占用，全部完成前禁止新签到。签到、结束的相同请求返回原结果，不重复更新 revision 或时间；过期的不同请求返回 409。

预约新增、恢复取消记录或更改日期/校区/时段时，由触发器检查容量；暂停返回 `SLOT_PAUSED`，满额返回 `SLOT_FULL`。容量更新校验 revision，名额查询在同一 batch 读取占用与配置。
