# 身份与组织映射

`members.id` 是稳定的人员标识，排班、签到、维修和审计继续使用该标识。`staff_accounts.member_id` 关联唯一登录账号，停用账号不会删除人员或历史。账号类型不代表组织职位，也不自动生成维修身份。

| 实体 | 职责 |
| --- | --- |
| `members` | 姓名、学号、所属校区、学院专业和状态 |
| `departments` | 固定部门及轻量站点、中心单位；权限按稳定代码判断 |
| `member_department_memberships` | 正式部门与职位，或指向硬件部的交流关系；左闭右开有效期 |
| `effective_member_roles` | 只读视图：组织推导身份与特殊显式授权的并集 |
| `member_roles` | 有校区、有效期和原因的特殊授权，含待核对历史授权 |
| `staff_campus_grants` | 账号业务校区的唯一权威来源，与所属校区独立 |
| `attendance_records` | 发生时的姓名、部门和身份快照，调岗不改写历史 |

同一时刻只有一个正式主部门。晋升或调岗在同一事务中结束原任职并创建新任职，保留历史。新增任职仅支持正式任职与交流；历史 secondary、temporary 等原样保留并标记待核对，不推导新权限。站级和中心级职位在相应组织单位表达。

硬件部正式部员自动使用 technician 模板，副部长、部长另有 repair_lead。设备服务站副站长、站长与中心主席只有管理能力；其他同级职位没有默认维修管理权限。非硬件部交流关系自动使用 exchange 模板，不参加正式维修排班和换班。留任通过特殊授权表达。自动身份不写入 member_roles。

0042 将旧任职标记为职位不明、待核对，保留原授权范围、条件及有效期。旧默认编号且未改动的绑定标记 legacy_default；曾用默认编号但已调整或无法确定的绑定标记 legacy_review；受保护账号保留独立系统身份。迁移不推断真实职位，不重开已结束授权。旧工作资格完整归档到 audit_events，并把其参与区间保留在迁移绑定上，随后删除 member_work_profiles；该区间只用于保留原授权约束，不再独立配置。

人员新增和 CSV 导入共用一个服务。CSV 字段为 studentId、name、homeCampusId、college、major、departmentId、positionCode、exchangeParticipation、authorizedCampuses、configureActivation、effectiveFrom。完全重复关系跳过，真正重叠列为冲突。已有账号校区默认保留，只有显式 replace、相应校区权限和匹配预览才能替换；空字段不会清空授权。

激活前校区保存在 whitelist_campus_grants，批准时原子复制到 staff_campus_grants，并关联原成员。配置和批准均校验当前完整授权，提交时再次检查人员快照、模板版本及审批人会话。普通非维修成员可只建档。受保护账号不能通过普通成员、导入或角色绑定接口修改。
