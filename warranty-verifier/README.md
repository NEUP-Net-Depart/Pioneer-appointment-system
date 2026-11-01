# 独立的原厂人工验证站点

该目录仅承载华为官方人工滑块 SDK，不接收序列号、预约信息、后台登录令牌或原厂 Cookie。验证完成后只将原厂 proof 通过 postMessage 返回发起查询的页面；最终仍由后台向华为核验 proof。初始化错误不会被当作验证成功。

必须部署到与预约系统不同的 origin，例如预约系统 `https://repair.example.org`、验证站点 `https://verify.example.org`。不要把这个目录作为预约系统同源的 `/staff/` 子页面使用。

现有 GitHub Actions 发布流程及 `npm run deploy` / `deploy:preview` 会先发布本目录，再发布工作台，无需另行部署或手改 `_headers`。只使用一个独立 Pages 项目 `pioneer-appointment-system-warranty`：`main` 为 Production，其余分支使用 Pages 原生 Preview 和分支别名。首次发布自动创建该项目并将生产分支设为 `main`；复用对应环境现有的 Cloudflare 账号与 Pages API token。验证项目只上传 HTML、JS、CSS 和生成的安全响应头，不携带预约 API、D1、R2 或运行期密钥。

发布脚本从分支别名计算 `WARRANTY_CAPTCHA_ORIGIN`，将相同值用于前端构建和生成的 Functions Wrangler 配置。仅工作人员页面的 `frame-src` 允许该来源；原厂脚本仍只运行在独立站点。Production 验证页的 `frame-ancestors` 允许现有 `SITE_URL` 和工作台的 Production Pages 域名；Preview 允许当前工作台分支及该工作台项目的 Preview 域名（含不可变部署地址），不允许 Production 域名。源 `_headers` 默认禁止嵌入，发布时自动生成各环境策略。

现有 token 需要对应账号的 Cloudflare Pages Edit 权限，才能创建和发布这个验证项目；若原 token 的账号权限不足，需管理员一次性调整权限。无需增加 secret、手工设置后端 Origin、绑定自定义域名或为各环境创建项目。已有同名项目的生产分支也会通过 API 自动设为 `main`。

单独执行 `npm run build` 时，可用 `WARRANTY_CAPTCHA_ORIGIN` 指定本地验证来源。缺失配置会生成 `frame-src 'none'` 并停用华为人工验证；后端未配置或与构建值不一致时，前端明确提示停用，不展示会被 CSP 拦截的查询按钮。

`npm run preview:field` 自动启动不同端口的本地验证站点、设置精确 frame-ancestors 与预约系统的 frame-src，停止预览时一并关闭。正式发布不使用本地地址。

元件使用官方 SDK 直接验证，没有自动解题、默认通过或降级绕过。人工验证成功不代表保修数据解析已经通过真机比对，须以组织有权查询的设备继续验证。
