# 签到策略与凭证

签到分为 `attendance_events` 场次、`attendance_tokens` 可替换凭证和 `attendance_records` 参加事实。二维码格式为 `pioneer:attendance:v1:<token>`；服务端只保存 token 摘要，登录会话确定成员身份。刷新凭证保留场次 ID，旧凭证立即失效。

`AttendancePolicy` 必须提供来源解析、资格判断、窗口、去重键、同批业务效果和结果描述。当前 `duty.v1` 的去重键为 `duty:<memberId>:<businessDate>`，`meeting.v1` 的去重键为 `meeting:<memberId>:<eventId>`；QR、可信模拟 NFC 和人工补录最后都进入相同的签到命令。

值班签到会同步 `staff_presence`；会议签到只维护会议出勤事实。补签保存原发生时间、实际录入时间、发生时组织快照和审计原因。
