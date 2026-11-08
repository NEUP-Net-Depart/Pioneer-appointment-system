# 签到策略与凭证

签到由 `attendance_events` 场次、`attendance_tokens` 可替换凭证和 `attendance_records` 成员事实组成。二维码格式为 `pioneer:attendance:v1:<token>`；服务端仅保存 token 摘要，登录会话确定成员身份。刷新凭证保留场次 ID，旧凭证立即失效。

## 策略契约

`AttendancePolicy` 提供以下方法，策略版本随场次和事实保存：

| 方法 | 职责 |
| --- | --- |
| `resolveSource` | 解析业务来源 |
| `checkEligibility` | 判断来源及参加资格 |
| `getDedupeScope` | 生成唯一事实范围 |
| `prepareEffects` | 返回同批业务效果计划 |
| `describeResult` | 描述签到结果 |

凭证摘要、成员身份、唯一事实及审计由 attendance 服务统一处理。值班去重键为 `duty:<memberId>:<businessDate>`，同步 `staff_presence`；会议场次使用 `meeting:<memberId>:<eventId>`，按场次参加名单校验，只维护该场次出勤事实。

## 修正与安全

公开签到只接受现有二维码及服务端认可的自行签到流程，不信任客户端自称的 NFC 或手工验证事实。管理补录保存原发生时间、实际录入时间、当时组织快照和审计原因，当前授权、目标场次及资料在同一 D1 batch 中断言。

历史补录和修正不改变实时在岗，登记请假不伪造实际签到。列表、导出与周核算先过滤授权范围，再聚合事实；暂停日期不允许值班签到或补录。业务规则见 [考勤与暂停日期](../requirements.md#排班与考勤)。

值班和补记直接读取新 duty_assignments 与 roster_leaves；普通维修权限不作为签到资格。管理范围按当前部长本校区、站长/主席全部校区判断。周/月报算法及小时参数不变，默认核算不写签到，主修工单数量和持续时间不参与出勤计算。

## 今日任务与核查

`GET /api/attendance/day?campusId&businessDate` 从有效班次关联请假、签到、在岗及核查结论，按当前访问范围过滤后按成员去重。返回 `items/temporary/summary/people/serverNow` 及每人的可用操作。请假单列且排除应到；临时到场单列；开班前待签到，开班后待核查，无自动迟到或缺勤判断。真实到场优先于未到结论。

`POST /api/attendance/arrivals` 仅接收 `{assignmentId,assignmentRevision,requestId}`。服务端确定今日、实际时间和班次校区，要求18:30–21:30、有效账号、校区范围、班次未请假、非暂停日。班次、目标资料和权限快照在同批写入时复核；签到、在岗、操作者审计与回执一次提交。与二维码共享人员/日期去重键，重试保留首次时间，不重置后来离岗状态。专用个人扫码入口识别工作人员码后直接提交并显示校区与时间；办公排班人员和负责人保留现有自行签到资格。

`PUT /api/attendance/reviews` 接收 `{assignmentId,assignmentRevision,revision,decision,requestId,reason?}`。班次结束后才能提交 `absent` 或撤销为 `cleared`；新记录 `revision:-1`，每次写入或撤销均递增，撤销不删除行。结论绑定当时成员，接替后不转嫁给新成员。`attendance_reviews` 保存当前结论、版本、操作者和时间，审计保存每次前后值；不生成签到或在岗。并发真实签到使核查失败或显示到场。

`POST /api/attendance/corrections` 可省略 `eventId`，提供 `memberId/businessDate/campusId/occurredAt/reason/requestId`，由服务端查找或按需准备值班场次；原 `recordId/eventId/revision` 修正格式继续使用。准备场次不产生签到。实际时间必须在该场次窗口内且不晚于现在，目标有效性、授权、暂停服务与事实版本在提交事务内检查，历史操作不改变实时在岗。

`GET /api/me/volunteer-summary` 只从当前会话获取成员，返回本月、累计时长及 `settings/asOf` 核算依据。与管理月报共用 `calculateVolunteerReport`，包括按周起始日归属月份和负责人每周计入的原有规则。本人范围先在取数时过滤，校区权限再在聚合前应用；默认计入不生成签到。
