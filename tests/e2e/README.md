# 浏览器测试

默认 CI 只运行 6 项冒烟检查，确认构建后的页面、登录、浏览器交互和后端能够协同完成任务：

- Chromium：学生预约并打开私人结果、工作人员上传照片并完成维修、成员填报时间并发布排班。
- WebKit 手机尺寸：预约、照片接收与维修，以及触摸签名的旋转与确认。

权限、隐私、容量、并发和修订冲突等细节由 Node 服务与数据库测试持续覆盖。其余浏览器回归用于相关模块修改和发布前验收，按需执行；新增用例默认不进入冒烟门禁。

```sh
npm run test:e2e                         # 默认 6 项冒烟
npm run test:e2e:full                    # 全部浏览器回归，含专项诊断
npm run test:e2e:diagnostics             # 只运行 OCR/验证码、图片编码和埋点 SDK 的 27 项诊断
npm run test:e2e:full -- --project=chromium --grep 'invites a replacement'
npm run test:e2e -- --workers=1
```

手动工作流 **Optional test tools** 提供 `browser-full` 和 `browser-diagnostics`。三个入口默认均使用两个进程并行执行。默认冒烟使用 `@smoke`（桌面）和 `@mobile-smoke`（手机）标签筛选现有用例，不复制测试代码；增加标签前应确认该场景能发现已有冒烟及 Node 测试无法发现的主流程故障。

完整回归中，Chromium 执行所有用例，WebKit 重复主流程、签名、照片上传、刷新恢复提交结果和图片/埋点诊断，Chromium DPR 3 触摸环境专门验证签名。真实 iOS／Android 内置浏览器与手写笔仍需设备验收。

CI 的 Playwright 执行上限为 12 分钟，包含构建与初始化的工作流步骤上限为 14 分钟，浏览器任务上限为 18 分钟；单用例上限仍为 60 秒。手势聚合计数测试在连续输入期间暂停模拟时钟，再显式推进聚合窗口，避免慢速运行器将同一组输入拆成多次手势。

`scripts/test-e2e.mjs` 构建一次并初始化虚构人员和本地数据库。`support/fixtures.mjs` 为每个用例复制未运行的初始 D1/R2 状态，在独立端口启动 Worker，结束后移除临时目录。浏览器上下文和 Worker 共用 `WORKFLOW_TIME`；新标签页自动继承时钟。用例之间不共享预约、排班、限流或附件，也不依赖浏览器名称、执行顺序或前一个用例的结果。

新增和修改用例时：

- 使用 `support/fixtures.mjs` 的 `test` 和 `expect`，由 `npm run test:e2e` 启动。
- `loginStaff` 只完成登录。使用 `staffPage` 或 `dutyPage` 显式进入目标页面，重新加载后也需要导航。
- 桌面分组、手机主导航和功能弹窗的差异集中在 `navigationEntry` 中。导航辅助函数不自动丢弃草稿；草稿场景自行处理确认。
- 优先按角色、标签和可见业务内容定位，在目标页面内查询，避免命中保留在 DOM 中的隐藏页面。
- 使用 `onsiteOrder`、`publishDuty` 等真实 API 准备与当前 UI 验证无关的前置数据；只在验证发布界面时通过界面排班。
- 固定日期由共用时钟推导，不按浏览器名分配不同日期或账号。增加浏览器无需修改场景数据。
- 断言用户可见结果和持久化行为。避免针对旧按钮文案的“不存在”断言、重复枚举服务层边界，或把无关角色的权限检查塞进业务长链。

失败截图和 trace 由 Playwright 自动保留在 `output/playwright/`。没有图像基准比较的成功截图不作为自动验收依据。

## 按需状态图

`npm run test:models:e2e` 在同一组完整回归中启用 XState v6 状态图；不增加浏览器项目或冒烟标签。默认 `test:e2e`、`test:e2e:full` 和发布 CI 不启用状态图。手动工作流的 `models-browser` 会启用并归档报告。

现有业务操作与断言分为具名步骤；独立转换表定义必须执行的状态和边，每条边只有在实际操作和结果断言通过后才计入覆盖。每个原有用例仍使用自己的 Worker、D1/R2、浏览器上下文和时钟，步骤之间共享该用例的业务上下文，测试之间不共享。状态图不会在浏览器中额外随机重放流程，失败继续保存现有截图和 trace。

各浏览器项目的状态/转换定义与实际覆盖保存到 `output/model-reports/<运行标识>/model-report.json`；同名流程分别保留。浏览器流程不做随机探索，报告中标记为 `not-supported`。

模型清单、报告字段与 seed/path/replayPath 重放说明见[测试分工](../README.md#按需属性测试与业务状态图)。
