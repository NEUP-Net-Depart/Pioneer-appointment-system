# Staff Platform 阶段 0 基线记录

- 分支：`next/staff-platform`
- 基线提交：`53b53db`
- 数据库迁移：`0001_initial.sql` ～ `0007_staff_platform.sql`
- 业务时区：`Asia/Shanghai`
- 模块契约：`staff-platform.v1`
- 当前登记模块：identity、organization、authorization、repairs、duty、attendance、rosters、meetings(test)、audit、files

机器可读基线清单见 [`baseline-manifest.json`](baseline-manifest.json)，包含完整基线 SHA、迁移摘要、manifest hash、契约和复测命令。

## 验证入口

```bash
npm run check
npm run audit:architecture
npm run db:verify
npm test
```

发布记录还应附应用 SHA、远端迁移执行结果、Preview 全角色回归和性能基线。当前仓库的自动检查已覆盖迁移重放、外键、模块依赖边界和原维修业务回归。
