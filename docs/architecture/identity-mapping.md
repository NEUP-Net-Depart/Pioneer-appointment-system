# 身份与组织映射

`members.id` 是服务端生成的稳定 `memberId`，排班、签到、维修和审计使用它关联人员。`staff_accounts.account` 是登录标识及历史兼容键，`member_id` 映射成员；停用账号不会删除成员或历史。初始映射使用 `member-<account>`，激活新增账号由 `staff_account_member_sync` 触发器补齐。

| 实体 | 职责 |
| --- | --- |
| `members` | 当前姓名、学号、主校区和状态 |
| `member_department_memberships` | 主归属、兼任及交流任职，使用左闭右开有效区间 |
| `member_work_profiles` | 维修、交流和办公资格，不等同于管理授权 |
| `member_roles` | 角色、完整范围、条件和有效期 |
| `attendance_records` | 发生时姓名、部门和身份快照，转部门不重写历史 |

旧接口的中文校区在边界映射至 `campus-nanhu` / `campus-hunnan`，新 API 使用 `memberId` 和字典 ID。

成员 CSV 省略 `authorizedCampuses` 只修改资料，不调整登录账号校区；提供该列表示替换所选账号的校区，空值表示清空。多账号成员必须提供 `accountTargets`，以 `|` 分隔账号，或单独填写 `*` 选择全部；单账号可省略。预览返回实际目标，含糊选择及非本人账号被拒绝。账号校区调整仅限最高管理员，成员更新使其全部会话版本失效。

新成员的 `authorizedCampuses` 同时用于角色范围和激活邀请；管理员邀请须明确填写 `accountRole=admin`、`roleCodes` 和非空校区。历史 `legacy_admin_logins` 兼容权限仅属于原登录及原校区快照；同成员的维修别名、新管理员别名和删除重建账号不能继承，成员导入也不改写快照。显式非兼容角色按成员共享。
