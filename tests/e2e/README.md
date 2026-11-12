# 浏览器测试

浏览器测试保留用户通过页面完成任务的关键路径：预约与签名、现场接收与维修、跨校区切换、空闲填报与发布、请假与接替、考勤补录、未保存草稿，以及必须在浏览器中验证的照片、OCR 和验证码流程。权限边界、幂等、并发和历史迁移等规则由 `tests/*.test.mjs` 的服务和数据库测试覆盖。

`signature.spec.mjs` 覆盖学生签名的旋转、等比预览、撤销和取消重签，以及现场登记的误触、返回修改、保存与后台回显。它运行于 Chromium 桌面、DPR 3 的 Chromium 触摸环境及 WebKit 手机尺寸；Chromium 触摸通过 CDP 注入原生触摸输入，WebKit 使用原生轻触和合成 Touch 事件连续书写。真实 iOS／Android 内置浏览器与手写笔仍需设备验收。

运行全部用例：

```sh
npm run test:e2e
```

默认使用两个进程并行执行独立用例，桌面和手机覆盖范围不变。筛选场景、串行排查，或检查重复执行：

```sh
npm run test:e2e -- --project=chromium --grep 'requests leave'
npm run test:e2e -- --workers=1
npm run test:e2e -- --grep 'availability produces|requests leave|historical arrival' --repeat-each=2
```

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
