# 数据库结构与约束

Schema 以 [migrations/](../migrations/) 为准，迁移只追加，运行时不初始化。业务规则见 [requirements.md](requirements.md)。

| 实体 | 职责与约束 |
|---|---|
| `staff_accounts` / `staff_campus_grants` | 身份、角色、启停和校区授权；受保护 root 必须启用且为 superadmin |
| `staff_whitelist` / `whitelist_campus_grants` | 激活资格、预期角色和授权范围 |
| `activation_requests` | 同一学号最多一条待审；批准时原子创建账号与授权，审核结束清除密码哈希 |
| `appointments` | 预约、临时登记、协议签名、负责人、五状态和维修结果 |
| `active_repairs` | 账号主键、工单唯一外键，约束一人一张进行中工单 |
| `slot_capacities` | 校区与时段联合主键，容量和 revision 持久保存 |
| `credential_recoveries` | 补发凭证的操作人、核验说明和时间 |
| `appointment_corrections` | 纠错的操作人、原因、修改前后值和时间，与工单修改原子提交 |
| 附件与额度表 | 元数据、容量预留和清理状态；物理删除成功后释放额度 |

密码使用 scrypt，联系方式使用 AES-256-GCM；学生凭证为 32 字节随机值，D1 仅存 SHA-256。业务日期按上海时区计算，事件时间保存为 UTC ISO。关联写入使用 D1 batch 或触发器，revision 防止并发覆盖。

## 工单与附件

- 主状态为 `booked`、`in_progress`、`completed`、`cancelled`、`expired`；仅已完成记录保存维修结果。
- `expires_at` 为有效截止时间，默认当日北京时间 21:30；`completed_at` 保存完成、取消或逾期的处理时间。
- `source` 为 booking/onsite；`registered_by` 与 `registration_key` 保证临时登记幂等，每人最多一条待签到登记。临时登记不计线上容量和排队。
- 预约新增和恢复时校验容量，暂停返回 `SLOT_PAUSED`，满额返回 `SLOT_FULL`。取消释放容量；取消和逾期释放同学号同日同时段唯一占位。
- `signature` 保存归一化笔迹 JSON。`front_photo_id`、`back_photo_id` 保存签到照片引用；恢复为已预约时清空，重新签到须使用恢复后上传的照片。
- 附件用途为 general/intake_front/intake_back；签到校验工单、上传人、用途和有效期。

## 历史数据

保留历史编号、维修号、凭证、签名、附件和时间值；`repair_number` 为历史查询别名，新记录为空。缺失维修结果保留 `legacy_unknown`，历史签名和时间可为空。历史多张进行中工单依次占用 `active_repairs`，全部完成前禁止新签到。
