# 序列号查询：自动、人工验证码与 OCR 备用流程

## 当前能力

- **联想中国**：扫描或手动输入后，由后台查询原厂并在本页显示服务明细。用户已反馈实机成功。
- **Acer 中国**：本页显示原厂图片验证码，人工填写后保留同一原厂会话提交查询。已验证原厂图片取得及模拟回包流程；仍待真实设备／人工答案的正向结果验证。
- **华为中国**：后台按原厂实际返回的类型取得图片或滑块挑战。图片由人填写；滑块通过独立来源的官方组件由人完成，后台继续核验并查询。已实际显示原厂滑块；仍待真实设备／人工操作的完整正向结果验证。
- **ASUS、MSI 等当前未接通品牌**：手机拍照／相册 OCR 或条码识别后，核对可编辑序号，点击「复制序列号并前往官网」，ASUS 可自动填入原厂序号栏；这条路径不声称自动取回原厂结果。ASUS 的网站绑定 reCAPTCHA 与 MSI 当前环境的 HTTP 403 尚未解决。
- **HP、Dell、MSI、Apple**：统一提供消费者自查步骤，复制 SN 后跳转固定原厂页面；不用申请 API。Dell 指向可输入 Service Tag 的支持首页，而非营销／续保介绍页。
- **小米**：指向小米商城「选择申请方式」的消费者售后页，由机主登录后选择订单或填写申请单；App 路径为「我的 → 退换/售后 → 输入 IMEI/SN」。该渠道不能冒称免登录的笔电保修表。
- **机械革命**：清楚标为小程序渠道，先复制 SN，再到微信搜索官方「机械革命服务」，绑定设备后查询保修。官网链接提供原厂说明／二维码；网页本身不是 SN 查询表。
- 小米与机械革命提供「只复制序列号，按上方步骤操作」，可保留本页步骤，不强制导航。所有品牌先显示具体消费者渠道与操作方式，不以 API 授权提示挡住复制跳转。

## OCR 与扫描

ZXing 支持 QRCode、DataMatrix、Code128、Code39、Code93、PDF417。Tesseract.js 7 与英文模型自托管，只有用户选择照片后才加载。支持 Android 相机拍照输入与相册照片；图片和 OCR 原文仅在浏览器内存中处理，不上传原厂、预约后台或第三方 OCR 服务。

OCR 优先识别明确的 S/N／SN／Serial／Service Tag 标签，多候选由人选择，不猜测 O/0、I/1。单一候选可填入可编辑序号框，复制跳转仍需用户点击。图片最大 12 MB／4000 万像素，识别前缩小长边至 2200px，识别超时 60 秒；取消、隐藏、关闭后取消任务并终止 Worker。不是验证码自动识别功能。

原厂链接固定在 shared/warranty.js。ASUS 以 sn、联想以 selname 参数带入序号（按官网脚本确认，并实测 ASUS 输入框成功带入）；其他品牌不猜测不生效的参数。带入链接会在原厂网址／浏览历史中包含序号，UI 会明确提示；不携带学生身份、预约编号或登录令牌。复制成功后同页跳转，既有工单草稿依原流程保留。剪贴簿拒绝时选中序号并提示人工复制，用户明确点击后再前往；不会假称已复制。机械革命等小程序型服务仍需按官网指引操作。

## 接口与人工会话

- `GET /api/warranty/providers` 返回模式和接通／配置状态。
- `POST /api/warranty/challenge`：JSON 最多 2 KiB，为指定品牌与序号取得原厂人工挑战。
- `POST /api/warranty/query`：JSON 最多 24 KiB，接受短期加密会话及人工答案／proof。

以上都要求维修人员登录，challenge 和 query 共用每 IP 每分钟 10 次限额，外连 12 秒超时。固定原厂地址，禁止跟随转址，不接受用户传入 Cookie、上游 URL 或请求头。人工会话用现有 AES-GCM 密钥加密，绑定用途、品牌、工作人员账号、序号和 3 分钟有效期；只在弹窗内存中存放，不写数据库、URL 或 sessionStorage。原厂验证码仍由原厂判断是否可重复使用，应用端不声称提供分布式一次性消费。

Acer 保留 ASP.NET Cookie、VIEWSTATE 与 EVENTVALIDATION，显示同一会话原厂图片。提交的验证码只来自人的输入。仅白名单提取保修表格项目为纯文本，不返回整个原厂 HTML、机主姓名或联系方式。当前保留原厂明细并返回整机状态 unknown，待实机格式确认后再考虑自动回填。

华为通过正常匿名 CSRF 初始化、query 和 register／picture 流程取得官方挑战，保留原厂选择的验证类型。滑块 proof 必须与服务端原始 challenge／hcg／hct 配套；客户端无法改成图片验证来降级。查询结果只提取设备型号及已获取的权益项目，不推断整机状态。

## 独立验证来源

华为官方元件需要 Cookie，使用跨来源 iframe（allow-scripts、allow-same-origin），让元件运行在独立站点。预约页面校验消息 origin、iframe Window、随机 nonce，拒绝其他窗口或旧会话的 proof。iframe 不接收序号、后台令牌或加密的原厂会话。

独立站点位于 warranty-verifier/；部署及配置见该目录 README。构建／后端都需 WARRANTY_CAPTCHA_ORIGIN。预约系统与验证站点不能同源。本地 preview:field 自动启动独立端口并配置对应 CSP。未进行远程部署或权限调整。

## 原厂来源与解释

- 联想：https://consumerservice.lenovo.com.cn/deviceGuarantee.html ，官网 deviceGuarantee.js 使用 `/api/drive/{serial}/drivewarrantyinfo`。
- Acer：https://support.acer.com.cn/AcerSite/Views/ASP/WarrantyQuery.aspx?sheet=acer ，图片 `/AcerSite/tools/verify_code.ashx`。
- 华为：https://consumer.huawei.com/cn/support/warranty-query/ ，官网 support-public／warranty-candle 脚本及所引用的官方人工验证 SDK。

2026-10-26 核对正常公开流程；不是稳定性承诺或厂家正式合作 API。验证码错误、查无数据、格式改变、403 与超时均不解释为过保。

联想项目状态按原厂服务起止日期、中国标准时间、包含到期当日计算；意外保、电池延保或上门项目不能单独证明硬件在保。发票、部件及地区政策可能改变最终核定。采用明确查询状态仅填入当前核验草稿，不自动提交接待／接单。

## 验证边界

单元测试覆盖 Cookie 与会话保留、篡改／过期／跨账号／跨序号拒绝、华为验证类型不可降级、结果白名单与未知状态、OCR 候选解析。真正 Worker 测试覆盖 fetch 选项、Acer Cookie 和人工答案。浏览器测试使用明确标注的模拟验证码／proof 验证交互与消息隔离，同时使用真正本地 OCR 引擎识别合成的设备标签，并验证复制后跳转固定原厂网址。模拟 proof 不等于实际原厂验证通过。

Android 真机的相机权限、反光标签、OCR 精度及原厂人工验证的完整正向查询仍需现场测试。照片拍摄需要 HTTPS 或可信本地来源。


## 消费者自查渠道核对（2026-10-26）

- Dell 支持首页：https://www.dell.com/support/home/zh-cn 。官方说明 https://www.dell.com/support/contents/zh-cn/article/product-support/self-support-knowledgebase/locate-service-tag/notebook 指引输入服务编号识别产品后查看保修。
- HP：https://support.hp.com/cn-zh/check-warranty 。选择购买国家／地区，必要时补充产品编号。
- MSI：https://account.msi.com/zh-Hans/services/warranty-book 。产品序号＋人工验证码。
- Apple：https://checkcoverage.apple.com/?locale=zh_CN 。序列号＋原厂验证／账号。
- 小米：https://www.mi.com/service/aftersale/front 。该页明确提供商城订单／其他渠道唯一识别码的售后入口。小米笔记本服务说明 https://api.jr.mi.com/insurance/document/phone_accidentIns_id.html?from=local&id=4374987258198360064 指引 App「我的 → 退换/售后」输入唯一识别码。
- 机械革命：https://www.mechrevo.com/cn/policy 明确说明官方小程序绑定设备后可查保修权益。

上述是原厂消费者渠道的路由与步骤验证，不代表替用户完成了所有品牌的实机保修查询。自动化浏览器测试在模拟页面验证复制顺序与固定目的地址，不向原厂提交虚构序号。
