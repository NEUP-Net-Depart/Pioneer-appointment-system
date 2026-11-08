# 值班编排与空闲

业务基线为 `docs/requirements.md` v1.2。

`shared/duty.js` 集中维修、办公19:00–21:00和签到18:30–21:30常量，无时段配置页面。成员通过 `GET/PUT /api/me/availability` 保存通常空闲（`weekStart: ""`）或指定周一的例外。沿用 `windows`（`weekday` 1–7、`campusId`、`startAt`、`endAt`）结构，界面只提供整班勾选。旧窗口完整覆盖时映射为勾选，部分覆盖提示重选，读取不修改原行。空数组表示不可用。`useUsual: true` 保存 JSON `null`，保留例外并递增 `revision`；后续修改仍携带该版本。`source/effectiveWindows` 表达实际安排，不生成每周确认记录。

个人空闲填报复用候选任职规则：硬件部主要任职显示维修，办公室主要任职显示办公；只有实际任职支持两类值班的人员才显示类型切换，其他岗位不显示空闲填报。部长的整周编排仍同时展示两类班表。

`GET /api/rosters/campus-week?weekStart&campusId` 返回两类班表、人员、对应空闲、暂停日和 `sourceVersion`。`POST /api/rosters/week/suggestions` 接收周一、校区及需保留的 `assignments`，仅返回草稿、缺口、未安排原因及输入版本，不写班表。默认保留已发布项，前端重新生成时提交全部发布及手动项，排除上次自动建议。算法先对四个非暂停日的负责人位置求最大匹配，再按空闲较少优先、岗位每日人数、校区每日人数及稳定排序安排其余成员；其他校区已有班次占用本周机会。候选按有效实际任职和主要部门选择，账号管理员标签不构成负责人资格。

`PUT /api/rosters/campus-week` 接收 `{weekStart,campusId,sourceVersion,requestId,rosters:[{dutyType,revision,assignments}]}`，维修、办公必须同时提交。版本、目标人员有效性、校区授权、暂停日、其他校区与两类班次的时间冲突均在同一事务守卫中检查。手动重复、未填空闲、跨部门、负责人不足仅警示并进入审计，无每日人数门槛。未变更的行保持 ID、特殊时段、请假和接替历史；主动替换新增固定时段行，旧行归档，取消失效的待确认接替邀请。发布还幂等准备每日共用值班签到场次，不生成签到。事务包含两类班表、场次、审计与回执，失败不留半份发布。

`GET/PUT /api/rosters/week` 继续支持单类型读取和发布，使用同一固定时段校验与事务写入。普通工作人员只读本人班次，管理范围与成员管理一致。

`GET /api/me/roster` 返回本人指定周班次，`upcoming=1` 返回从今日起最近30个非暂停班次，用于今日和下次提醒。`POST /api/rosters/assignments/:id/leave` 直接登记原因，`leave-withdraw` 撤销；均携带班次版本。请假不要求先找到接替者。`cover-candidates` 列出校区内有效工作人员；`cover` 创建接替邀请，`GET /api/rosters/covers` 查询本人邀请，`POST /api/rosters/covers/:id/response` 由接替者确认或拒绝、发起者撤回。旧有效互换一次性迁移为双班次接替，确认原子修改双方班次。

`roster_weeks` 是校区/周/类型的并发版本；`duty_assignments` 保留全部历史 ID，`active` 标记有效班次；`member_availability` 保存通常时间与例外；`roster_leaves` 保存独立请假事实；`roster_covers` 保存邀请与确认。修改、审计、操作回执在同一 D1 batch 中提交。实际签到在 `attendance_records`，维修接单与这些记录互不作为前置。

0048的问卷与旧工作流归档保持不变；0050追加关联班次与成员的 `attendance_reviews`，不改写原班次和签到。核查及直接到场见 [签到策略](attendance-policies.md)。
