# 先锋硬件部维修预约系统

面向南湖、浑南校区的免费维修预约系统，提供学生预约与查询、工作人员扫码签到与维修记录、管理员账号及预约管理。

原生 HTML/CSS/JavaScript 前端，Cloudflare Pages Functions API，D1 数据库与私有 R2 附件存储。入口为学生端 `/`、工作人员端 `/staff/` 和同源 `/api/*`。

## 本地开发

需要 Node.js 22+：

```bash
npm ci
npx playwright install chromium webkit
npm run setup:local
npm run dev
```

访问 [学生端](http://127.0.0.1:8788/) 或 [工作人员端](http://127.0.0.1:8788/staff/)。本地配置和管理员密码在 `.dev.vars`，数据在 `.wrangler/`；初始化不覆盖已有密码。

| 命令 | 用途 |
|---|---|
| `npm run verify` | 代码、架构、单元/集成、迁移与浏览器检查 |
| `npm run preview:local` | 使用独立本地数据库和附件存储的预览 |
| `npm run preview:booking-layout` | 8790 端口布局预览，模拟数据、禁用提交 |
| `npm run test:booking-layout` | 预约布局回归 |

页面位于 `frontend/`，公共配置与校验位于 `shared/`；API 按 `functions/api/` → `src/routes/` → `src/services/` → `src/db/` 分层。

## 文档

- [业务规则与权限](docs/requirements.md)
- [数据模型](docs/data-model.md)
- [部署与运维（含 Staff Staging）](docs/operations.md)
