# AttendancePolicy 公开契约

策略实现必须导出 `resolveSource`、`checkEligibility`、`getDedupeScope`、`prepareEffects` 和 `describeResult`。策略只能返回业务效果计划，凭证哈希、成员身份、唯一事实和审计由 attendance 服务统一处理。策略版本写入场次和事实，确保旧记录可解释。
