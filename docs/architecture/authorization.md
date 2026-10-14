# 授权与字段范围

授权判断单位是 `permissionCode + scope + conditions + validity`。`src/modules/authorization/conditions.js` 注册类型化条件，`createAuthorizer()` 对多个完整授权项取并集、对不同范围维度取交集，并返回 `matchedGrantIds`、`reasonCode`、范围解释和 `authVersion`。

列表、详情、搜索、导出和附件下载应使用同一授权结果。页面按钮只能把授权结果作为提示，写入仍由服务端在最新对象版本和授权版本下重新判断。角色、成员角色绑定变更会增加账号 `token_version` / `auth_version`，使旧会话失效。

权限目录以代码 manifest 和 `permission_definitions` 的版本化投影为准。角色是运行期配置，最高管理员可以为已登记权限设置校区、部门、对象和条件范围。联系方式、账号授权、导出和删除权限标记为敏感字段。
