# G0 迁移与业务基线

`next/staff-platform` 保留 dev 的五主状态及四个半小时时段。dev 迁移链保留原 0001～0009，追加 `0010_staff_platform.sql`；Staff Staging 保留已部署的 0001～0007，追加 `database/staff-migrations/0008_five_statuses.sql`。逻辑目标 schema 版本统一为 `0010`，不要求两个环境的迁移编号相同。

旧整点时段仍作为历史预约展示，不接受新的整点时段预约。新页面与配置使用 `weekday_slot_capacities`，已有日期使用 `booking_day_slots` 快照。两路径的带数据升级、失败回滚和最终结构一致性由 `tests/staff-upgrade.test.mjs` 验证，已部署迁移指纹由 `tests/g0-baseline.test.mjs` 验证。

基线校验包括：

- 新鲜 D1 重放和二次重放无错误；
- 两个校区各四个工作日、四个半小时模板；
- 扫码维修的当前工单、维修码解析、临时登记唯一性和过期结果；
- `tests/g0-baseline.test.mjs`、`tests/scan-code.test.mjs`、`tests/capacity-grid.test.mjs`。

运行 `npm run db:verify` 可以重新执行完整迁移校验。
