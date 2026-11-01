# 独立的原厂人工验证站点

该目录仅承载华为官方人工滑块 SDK，不接收序列号、预约信息、后台登录令牌或原厂 Cookie。验证完成后只将原厂 proof 通过 postMessage 返回发起查询的页面；最终仍由后台向华为核验 proof。初始化错误不会被当作验证成功。

必须部署到与预约系统不同的 origin，例如预约系统 `https://repair.example.org`、验证站点 `https://verify.example.org`。不要把这个目录作为预约系统同源的 `/staff/` 子页面使用。

部署方式：将本目录作为独立静态站点的发布目录（无需构建）。在其 `_headers` 的 Content-Security-Policy 末尾增加 `frame-ancestors https://repair.example.org`，替换为实际预约系统来源。保留列出的 SDK／图片／请求来源白名单。

在预约系统的**构建环境和后端运行环境**都设置：

```
WARRANTY_CAPTCHA_ORIGIN=https://verify.example.org
```

随后重新构建预约系统。构建脚本只为工作人员页面加入该验证来源的 frame-src；原厂脚本仍留在独立站点，不加入预约系统的 script-src。后端缺少此配置时不会启用华为人工验证。

`npm run preview:field` 自动启动不同端口的本地验证站点、设置精确 frame-ancestors 与预约系统的 frame-src，停止预览时一并关闭。正式发布不使用本地地址。

元件使用官方 SDK 直接验证，没有自动解题、默认通过或降级绕过。人工验证成功不代表保修数据解析已经通过真机比对，须以组织有权查询的设备继续验证。
