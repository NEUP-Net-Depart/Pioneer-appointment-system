# 排班与可用时间

业务基线为 `docs/reviews/core-workflow-redesign-plan.md` v1.2。

成员通过 `GET/PUT /api/me/availability` 保存通常时间（`weekStart: ""`）或指定周一的例外。`windows` 为 `weekday`（1–7）、`campusId`、`startAt`、`endAt` 数组；空数组表示不可用。`useUsual: true` 删除该周例外。响应明确区分 `usual` 与 `exception`；不生成每周确认记录。

`GET/PUT /api/rosters/week` 按 `weekStart/campusId/dutyType` 读取及发布班表。普通工作人员只读本人班次；负责人读取授权校区全表与该校区可用时间，校区边界与成员管理一致。编辑携带 `revision`、`requestId` 和 `assignments`；无问卷、人数或维修资格前置。成员必须有效且具有该校区访问范围，同一人的班次不能时间重叠。发布即生效，修改保留被替换的历史班次及审计。

`GET /api/me/roster` 返回本人当前周班次。`POST /api/rosters/assignments/:id/leave` 直接登记原因，`leave-withdraw` 撤销；均携带班次版本。请假不要求先找到接替者。`cover-candidates` 列出校区内有效工作人员；`cover` 创建接替邀请，`GET /api/rosters/covers` 查询本人邀请，`POST /api/rosters/covers/:id/response` 由接替者确认或拒绝、发起者撤回。旧有效互换一次性迁移为双班次接替，确认原子修改双方班次。

`roster_weeks` 是校区/周/类型的并发版本；`duty_assignments` 保留全部历史 ID，`active` 标记有效班次；`member_availability` 保存通常时间与例外；`roster_leaves` 保存独立请假事实；`roster_covers` 保存邀请与确认。修改、审计、操作回执在同一 D1 batch 中提交。实际签到在 `attendance_records`，维修接单与这些记录互不作为前置。

0048 为追加迁移，不修改既有迁移账本。所有被删除的问卷与工作流字段保存在 `audit_events`，旧待处理记录有明确转换或归档处置；不保留旧接口或运行时双读。
