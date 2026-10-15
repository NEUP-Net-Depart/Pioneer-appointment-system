# G0 迁移与业务基线

`next/staff-platform` 的 G0 基线把 PR #35 的扫码维修、现场临时登记和过期结果，与 PR #38 的周一至周四半小时预约模板合并到同一个 `0007_staff_platform.sql`。迁移保留旧的整点时段作为兼容输入；新页面和新配置接口使用 `weekday_slot_capacities`，已有预约使用 `booking_day_slots` 快照，后续修改模板不会改变已产生的日期。

基线校验包括：

- 新鲜 D1 重放和二次重放无错误；
- 两个校区各四个工作日、四个半小时模板；
- 扫码维修的当前工单、维修码解析、临时登记唯一性和过期结果；
- `tests/g0-baseline.test.mjs`、`tests/scan-code.test.mjs`、`tests/capacity-grid.test.mjs`。

运行 `npm run db:verify` 可以重新执行完整迁移校验。
