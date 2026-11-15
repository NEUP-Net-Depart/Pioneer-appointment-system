# 浏览器测试

默认 CI 只运行 6 项冒烟检查，确认构建后的页面、登录、浏览器交互和后端能够协同完成任务：

- Chromium：学生预约并打开私人结果、工作人员上传照片并完成维修、成员填报时间并发布排班。
- WebKit 手机尺寸：预约、照片接收与维修，以及触摸签名的旋转与确认。

权限、隐私、容量、并发和修订冲突等细节由 Node 服务与数据库测试持续覆盖。其余浏览器回归用于相关模块修改和发布前验收，按需执行；新增用例默认不进入冒烟门禁。

```sh
npm run test:e2e                         # 默认 6 项冒烟
npm run test:e2e:full                    # 全部 94 项，含专项诊断
npm run test:e2e:diagnostics             # 只运行 OCR/验证码、图片编码和埋点 SDK 的 27 项诊断
npm run test:e2e:full -- --project=chromium --grep 'requests leave'
npm run test:e2e -- --workers=1
```

手动工作流 **Optional test tools** 提供 `browser-full` 和 `browser-diagnostics`。三个入口默认均使用两个进程并行执行。默认冒烟使用 `@smoke`（桌面）和 `@mobile-smoke`（手机）标签筛选现有用例，不复制测试代码；增加标签前应确认该场景能发现已有冒烟及 Node 测试无法发现的主流程故障。

完整回归中，Chromium 执行所有用例，WebKit 重复主流程、签名、照片上传和图片/埋点诊断，Chromium DPR 3 触摸环境专门验证签名。真实 iOS／Android 内置浏览器与手写笔仍需设备验收。

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
