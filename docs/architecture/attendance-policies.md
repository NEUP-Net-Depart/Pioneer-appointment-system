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

凭证摘要、成员身份、唯一事实及审计由 attendance 服务统一处理。值班去重键为 `duty:<memberId>:<businessDate>`，同步 `staff_presence`；会议测试策略使用 `meeting:<memberId>:<eventId>`，只维护会议出勤事实，不注册生产业务入口。

## 修正与安全

公开签到只接受现有二维码及服务端认可的自行签到流程，不信任客户端自称的 NFC 或手工验证事实。管理补录保存原发生时间、实际录入时间、当时组织快照和审计原因，当前授权、目标场次及资料在同一 D1 batch 中断言。

历史补录和修正不改变实时在岗，批准请假不伪造实际签到。列表、导出与周核算先过滤授权范围，再聚合事实；暂停日期不允许值班签到或补录。业务规则见 [考勤与暂停日期](../requirements.md#考勤与暂停日期)。
