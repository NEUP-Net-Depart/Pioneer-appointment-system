# React 管理端查询

管理端直接使用 TanStack Query 的 `useQuery`、`useInfiniteQuery`、`useMutation` 和 QueryClient API。`query-client.js` 只配置默认请求函数及生命周期策略；传输层 `request` 不处理缓存或失效。

## 会话和查询键

- 身份查询由独立的 QueryClient 管理。账号、人员、授权版本、角色、权限、授权校区或任职变化时，React 重新挂载工作区，并销毁旧 QueryClient。退出登录也会取消查询并清空缓存。
- 工作区查询键为 `[接口路径, 参数对象]`，包含筛选、校区、日期、周次等请求条件。普通查询和无限列表使用不同的接口键或参数，不共用数据结构。
- 查询结果只保存在内存，不使用持久化插件。会话存储只保留已有登录凭据及场景、校区选择，不保存业务查询结果。激活回执作为凭据也仅保留在标签页会话中，旧的长期存储回执直接删除。
- 普通查询新鲜期和轮询周期为 30 秒，无观察者的缓存保留 5 分钟。多页列表采用 2 分钟新鲜期和轮询周期；组织字典为 5 分钟、不轮询。隐藏页面通过 `enabled` 停止自动查询，浏览器隐藏时由 TanStack 的默认焦点策略暂停轮询。
- 网络或服务器错误最多重试一次；客户端错误不重试。403 清空工作区并重新核验身份，避免继续展示受限数据。今日工作无权读取看板时重新读取授权 home，由返回的校区和场景决定后续界面。

## 分页、失效和草稿

- 人员、预约记录和签到历史通过 `useInfiniteQuery` 沿服务端游标增量加载。刷新仅重新读取已展开的页数，沿新游标顺序获取，成功后完整替换；失败保留已有数据。
- 所有查询向请求传递 TanStack 提供的 `signal`。筛选切换、会话销毁和 `cancelQueries` 会取消旧请求，去重、竞态及垃圾回收交给 TanStack。
- 人员集合完整且没有关键词时，直接在该查询结果上过滤校区和状态；未取完整时仍请求服务端筛选。关键词搜索始终由服务端完成。
- 成功写入由业务调用点取消相关旧查询，并精准调用 `invalidateQueries` 或 `setQueryData`。人员修改更新人员、账号及引用人员的工作区数据；排班和考勤更新相应班表、记录、报表和现场数据；维修更新工单、预约列表及统计。
- 签到成功先取消旧 home/board 请求，再把服务端确认记录写入同日期、同校区的 Query 缓存，随后使相关查询失效。不保留独立的签到确认缓存。
- 表单只保留用户草稿及开始编辑时的版本号。后台数据不覆盖草稿，提交不采用后台更新后的版本号。
- 优先显示已有数据，首次加载沿用简洁指示。不使用骨架屏，不展示后台刷新或缓存状态文案。

回归使用 `tests/e2e/records-loading.spec.mjs` 和 `tests/e2e/core-workflow.spec.mjs`，覆盖分页、失败保留、取消竞态、会话隔离及业务写入。

数据容器的向下展开使用视觉遮罩，不以 `clip-path` 裁剪包含按钮的点击区域；动效结束后显式释放动画。人员列表的移动布局与底栏统一采用 767px 断点，详情按钮滚动定位时为固定底栏保留安全距离。`tests/e2e/member-identities.spec.mjs` 通过动效进行中的真实鼠标点击和跨断点命中检查覆盖这些交互。

TanStack 官方参考：[默认行为](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults)、[请求取消](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)、[无限列表](https://tanstack.com/query/latest/docs/framework/react/guides/infinite-queries)。
