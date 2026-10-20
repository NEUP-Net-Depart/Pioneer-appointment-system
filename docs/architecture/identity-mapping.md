# 身份与组织映射

`members.id` 是服务端生成的稳定 `memberId`。`staff_accounts.account` 继续作为登录标识和历史兼容键，`staff_accounts.member_id` 把账号映射到成员；账号停用不会删除成员或业务历史。迁移 `0007_staff_platform.sql` 为已有账号生成 `member-<account>` 回填值，激活新增账号由 `staff_account_member_sync` 触发器补齐映射。

成员当前资料、账号安全、部门任职和业务角色分开保存：

- `members` 保存姓名、学号、当前主校区和成员状态。
- `member_department_memberships` 使用左闭右开有效区间，允许主归属、兼任和交流任职。
- `member_work_profiles` 表达维修、交流、办公资格；资格不等同于角色授权。
- `member_roles` 保存角色、完整范围和有效期。
- `attendance_records` 保存发生时部门、姓名等快照；转部门后历史事实仍按发生时归属统计。

旧接口的中文校区由边界适配映射至 `campus-nanhu` / `campus-hunnan`。新 API 使用 `memberId` 和字典 ID。

成员 CSV 导入省略 `authorizedCampuses` 列时，只修改成员资料，不调整任何登录账号的校区。提供该列表示替换所选账号的校区授权，空值表示清空；已有多个账号时必须同时提供 `accountTargets`，用 `|` 分隔账号，或单独填写 `*` 明确选择全部账号。单账号成员可省略 `accountTargets`。预览返回实际目标；不属于该成员的账号、含糊的多账号更新会被拒绝。账号校区调整仅允许最高管理员执行；同一成员的所有会话版本随成员资料更新而失效。

新成员的 `authorizedCampuses` 还用于角色绑定范围和激活邀请；管理员邀请仍须明确填写 `accountRole=admin`、`roleCodes` 和非空校区。历史 `legacy_admin_logins` 与原校区兼容快照不由成员导入改写。
