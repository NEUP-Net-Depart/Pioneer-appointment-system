# 工作人员后台教程

直接复用原工作人员后台前端及样式，在原页面的按钮、表单和弹窗上提供聚焦讲解。基线为 `origin/dev` 的 `ff73f51`（2026-11-16）。校区数量由真实身份权限决定；概览日期仅列实际维修日，不单独改造业务页面的布局。

用户入口只有三个身份：**部长、部员、维修事务**，按真实工作任务组织七条连续流程：

- **部长**：考勤与值班核查；预约与设备维修；值班与业务配置。
- **部员**：到岗与完整维修；值班安排与变动。
- **维修事务**：到岗出码与人员协调；接待与设备交接。

详细环节、知识点归属和验收要求见 [WORKFLOWS.md](WORKFLOWS.md)。扫码识别、签到确认、成功结果、设备照片、接收与维修状态分别展示；工单始终保持连续。现场登记后继续接收新建的设备，不借用上一台的资料与照片。小功能在实际使用的环节介绍，同一身份下不重复开课。

## 引导规则

**全程点“下一步”，页面会演示对应操作。** 最后一步为“完成”。引导期间不需要操作高亮区域，不会自动跳到下一步，也不提供“帮我演示”“继续”“跳过”“暂停”等其他推进方式。

每步只显示一句大字提示及整体进度，不显示解释段落。引导重点是容易漏掉的入口、隐藏规则和操作后果；填写原因、填写示例表单和保存等常规操作合并演示。预约概览会演示日期切换、状态直达列表，以及搜索临时放开筛选、清空恢复筛选的规则。

可以随时“退出引导”，直接自由操作原页面。已经演示过的修改保留在当前页面内存中。完成后可以选择其他流程；刷新或重新开始会恢复示例数据。手机端使用同样的完整流程，退出入口与下一步放在同一张引导卡片中。

## 启动与构建

在本目录执行：

```powershell
npm ci
npm run dev
```

打开 <http://127.0.0.1:15170/>。

```powershell
npm run build
npm run preview
```

构建时需要本仓库的 `frontend/staff-react/`、`shared/` 和部分静态资产；构建后的 `dist/` 可以独立部署到静态站点根目录，运行时不需要后端、数据库或正式账号。原系统的生产组件及接口没有改动。

## GitHub Pages 自动部署

在线教程：<https://neup-net-depart.github.io/Pioneer-appointment-system/>。

`.github/workflows/tutorial-pages.yml` 在 `feat/staff-interactive-tutorial` 和 `dev` 的教程、原后台组件、公共资源或依赖发生变化时自动执行，也支持手动运行。流程安装依赖、检查教程、按 Pages 子目录构建、完整验证七条工作流，再上传并部署静态文件；不使用正式后端、数据库或 Cloudflare 密钥。GitHub Pages 的发布来源须为 **GitHub Actions**，`github-pages` 环境只允许这两个分支部署。

使用 `TUTORIAL_BASE_PATH` 可部署到项目子目录，默认为 `/`。Pages Action 从仓库设置读取路径，无需在源页面里硬编码域名。下面在 PowerShell 中验证 GitHub Pages 路径：

```powershell
$env:TUTORIAL_BASE_PATH = '/Pioneer-appointment-system/'
npm run build
npm run test:pages
Remove-Item Env:TUTORIAL_BASE_PATH
```

子目录检查覆盖入口跳转、原版样式与图片、二维码识别、照片上传、志愿模板下载和七条完整流程。检查后如需继续本地根路径预览，再运行一次普通的 `npm run build`。

直接分享链接：

- 部长考勤：`/?profile=head&journey=attendance`
- 部长维修：`/?profile=head&journey=repairs`
- 部长配置：`/?profile=head&journey=configuration`
- 部员到岗与维修：`/?profile=repair&journey=duty-repair`
- 部员班次变动：`/?profile=repair&journey=shift-change`
- 维修事务到岗：`/?profile=affairs&journey=attendance`
- 维修事务接待：`/?profile=affairs&journey=reception`

旧版细分身份及场景的普通教程链接会转到该身份的第一条工作流程。

## 本地示例

全部姓名、学号、设备、图片、签到码和业务记录都是虚构资料。请求与上传由浏览器内存模拟，真实 `/api/` 和跨域请求被拦截，遥测和在线更新关闭。签到使用本地生成的二维码经过原相册入口识别，不申请摄像头权限。原页面的保修、OCR 和文件下载使用本地演示结果，不访问正式业务。

考勤流程中，陆可是已签到的空闲支援人员，陈一帆正在维修两台设备，温言待核实漏签，许星已请假。空闲状态、当前维修量、累计接单、签到历史和志愿时长从对应的工单与签到记录计算。空闲填报初始未选，单周例外覆盖通常安排；接受接替会转移实际班次，排班建议会读取已保存的空闲。

## 验证与维护

```powershell
npm run lint
npm test
npm run build
npm run test:browser
```

首次进行浏览器测试时执行 `npx playwright install chromium`。

`src/journeys.js` 定义工作流、环节及知识点；`src/coach.jsx` 管理身份入口及统一推进；`src/guide.js` 操作原组件并聚焦；`src/simulation/` 提供内存数据和接口适配。`src/courses.js` 中的细粒度步骤及扩展权限数据作为流程素材和内部功能回归，不作为用户教程入口。

测试覆盖七条完整工作流、知识点唯一性、确认前无签到、接收前无照片、先开始再结束、事务权限、新工单独立接收、统一“下一步”规则、手机端弹窗、退出后自由操作，以及底层功能回归。更新 dev 后应核对原组件入口和请求形状并重新执行验证。
