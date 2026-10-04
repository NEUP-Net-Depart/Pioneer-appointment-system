# 文件导航

- `frontend/user/index.html`、`main.js`、`booking.js`、`lookup.js`：用户独立前端。
- `frontend/staff/index.html`、`main.js`、`auth.js`、`staff.js`、`stats.js`、`users.js`：工作人员独立前端。
- `shared/`：API、导航、附件、状态、上海时间和共享样式。
- `functions/api/[[path]].js`：统一 `/api/*` Pages Functions 入口。
- `src/app.js`：同源策略、请求分发、统一错误响应。
- `src/context.js`：显式注入 request-scoped D1 session、R2、Secrets。
- `src/routes/`：auth、appointments、attachments、users、stats/export HTTP 适配。
- `src/services/`：身份、权限、预约/状态/排队、账号、R2 补偿、统计及 CSV。
- `src/db/`：D1 参数化 SQL、筛选/聚合、原子写入、revision、持久化限流。
- `src/lib/`：scrypt、JWT、AES-256-GCM、请求/附件校验、响应和 CSV 编码。
- `migrations/0001_initial.sql`：用户、预约、附件、限流表及唯一索引、容量触发器。
- `migrations/0002_query_indexes.sql`：查询索引与替代索引的清理。
- `migrations/0003_attachment_storage.sql`：180 天过期回填、附件容量和持久化对象记录、原子计数触发器。
- `wrangler.jsonc`、`.dev.vars.example`：Pages、D1、R2、密钥配置。
- `scripts/`：构建、初始化、部署、lint/架构审计、语法/编译检查、隔离 migration 验证和 HTTP 自检。
- `scripts/cleanup-attachments.mjs`、`cloudflare-d1.mjs`：按环境进行附件清理，默认 dry-run；复用 D1 仓库，经 Wrangler 删除 R2 对象。
- `tests/`、`.github/workflows/check.yml`：前端结构与 workerd/D1/R2 自动化回归。
- `.github/workflows/cleanup-attachments.yml`：每周一北京时间 03:17 清理附件，支持手动执行与环境选择。
- `public/`：Pages 路由、安全响应头、404。
- `README.md`：完整部署顺序、外部 DNS、Secrets、Preview、API 和运维说明。
- `docs/requirements.md`：业务背景和后续规划。

唯一公开构建目录为 `dist/`；不要发布仓库根目录。所有请求经 Pages Functions 进入业务服务。
