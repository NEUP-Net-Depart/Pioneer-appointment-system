# 身份与组织映射

`members.id` 是服务端生成的稳定 `memberId`。`staff_accounts.account` 继续作为登录标识和历史兼容键，`staff_accounts.member_id` 把账号映射到成员；账号停用不会删除成员或业务历史。迁移 `0007_staff_platform.sql` 为已有账号生成 `member-<account>` 回填值，激活新增账号由 `staff_account_member_sync` 触发器补齐映射。

成员当前资料、账号安全、部门任职和业务角色分开保存：

- `members` 保存姓名、学号、当前主校区和成员状态。
- `member_department_memberships` 使用左闭右开有效区间，允许主归属、兼任和交流任职。
- `member_work_profiles` 表达维修、交流、办公资格；资格不等同于角色授权。
- `member_roles` 保存角色、完整范围和有效期。
- `attendance_records` 保存发生时部门、姓名等快照；转部门后历史事实仍按发生时归属统计。

旧接口的中文校区由边界适配映射至 `campus-nanhu` / `campus-hunnan`。新 API 使用 `memberId` 和字典 ID。
