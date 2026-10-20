# 模块与工程约定

本项目采用模块化单体：Pages Functions 负责 HTTP 适配，D1 保存业务事实，私有 R2 保存附件。调用方向为 HTTP → 服务用例 → 模块公开入口 → D1/R2；SQL 只位于 `src/db/`，路由不得绕过服务直接访问数据库。

## 模块边界

| 模块 | 职责 | 公开能力 |
| --- | --- | --- |
| identity | 成员、账号、激活与会话 | 稳定身份、账号映射、当前操作者 |
| organization | 校区、部门和有效任职 | 字典与时点归属 |
| authorization | 权限定义、角色和完整授权 | 条件解释、范围与字段投影 |
| repairs | 预约、维修占用和附件引用 | 核验、接单、完成及工作量 |
| duty / attendance | 场次、凭证、签到与在岗 | 去重、修正、核算及导出 |
| rosters | 收集、填报、班表和申请 | 确定性草稿、发布及修订 |
| audit | 审计和请求回执 | 操作追踪与幂等结果 |
| files | 附件表与 R2 适配 | 私有上传、读取与清理 |

模块由 `src/modules/*/manifest.js` 和 `public.js` 协作，清单声明依赖、权限、导航、契约及 schema 版本。生产入口只采用 `releaseState=ready`；meetings 保留为签到扩展测试夹具，不注册生产入口。[平台契约](../contracts/staff-platform.json)、[模块示例](../contracts/module-manifest.example.json)及 [基线指纹](../contracts/baseline-manifest.json)由自动审计校验。

`src/services/staff-platform/` 按 context、members、roles、workspace、attendance、collections、planning、requests 组织用例，依赖由工厂参数传入；对应仓储位于 `src/db/staff-platform/`，命令条件集中在 commands。入口文件负责组合，模块内部不共享请求状态。

## 事务与幂等

接单、签到、请假、换班和授权变更将相关业务事实、版本断言、必要审计及请求回执置于同一 D1 `batch()`；任一步失败整体回滚。提交时重读当前授权和对象版本，同请求键不同内容拒绝；R2 使用元数据状态和补偿清理。

请假审批与撤回断言 pending、revision 和授权版本。修订以 `origin_assignment_id` 及 `roster_leave_facts` 延续历史关联，不改写原申请或签到。换班接受重验双方资格、范围、请假、时间冲突及负责人覆盖；两个原版本同事务失效并发布后继版本，未变更人员延续 lineage，新接手人员开启新 lineage。

换班批处理首条语句比较校验快照，唯一回执标记约束后续写入；快照变化不留待处理回执，客户端保留 requestId 重试。考勤补录同时断言场次、目标资料、当前岗位及授权，保存历史事实、审计和 SHA-256 请求回执，不改变实时在岗。

## 排班求解

维修求解先满足资格、可参加关系、负责人覆盖、每周次数及锁定安排，再最大化安排人数；按校区等权最小化每日人数差之和，再最小化各校区每日人数相对本校区平均值的平方偏差。稳定成员、校区和班次顺序保证确定性。

带下界流求解默认预算为 8,000,000 次操作，只有搜索完成且独立校验通过才返回 `optimal`；预算耗尽保留可行解或诊断草稿，标记 `feasible` / `needs_review`。人工修改清除旧优化结论，发布重读资格和覆盖事实。办公求解均衡每周次数并限制每人每天一班。算法与规则版本随班表保存，具体实现见 `src/modules/rosters/`。

## 前端约定

React 查询／草稿 hook 与场景组件分开，复用 `workspace-foundation.css`、`WorkspaceSections`、`WorkspaceMoreActions` 和 `WorkspaceLauncher`。页面突出主要操作，低频操作进入更多菜单，重复记录保留摘要与详情入口；筛选、输入和焦点在局部刷新及模块切换时保留。

窄屏按日期组织班表，宽屏显示整周；拖动始终提供按钮替代。弹窗独立滚动并锁住背景，关闭恢复入口焦点，交互目标至少 44px。验证 320、390、768、1440px 下长姓名、多身份及密集班表，检查页面溢出、键盘操作和摄像头释放。

`npm run format:staff` 格式化工作人员源码及编排模块，`verify` 检查格式；发布资源由 Vite/esbuild 压缩。

## 兼容入口与能力边界

`/api/desk/summary` 复用现场 board 的授权投影；`/api/attendance/export.csv` 与 `/api/export/attendance.csv` 使用同一处理器。公开 `/api/live/summary` 保留旧凭证与队列契约：名额使用容量计算，仅携带预约凭证的请求查询队列位置。

当前提供维修摘要、考勤查询及导出；综合维修／考勤／排班统计、独立审计工作区、批量数据删除流程尚未完整提供。旧审计缺少统一范围归属，受限审计授权不能读取全局日志。完整会议业务和真实 NFC 硬件接入不属于现有能力。
