# 项目文件说明与部署

项目已经分为两个独立部分：`frontend/` 是可部署到 Nginx/CDN 的静态前端，`backend/` 是提供 API 和数据库访问的 Node.js 服务。

根目录 `B84CB3B7B9CDA84FD38EC7309D0E4008.jpg` 是 Logo 原始副本，页面实际引用 `frontend/assets/organization-logo.jpg`。

## 前端 `frontend/`

- `frontend/index.html`：共享页面模板，按 `mode=user` 或 `mode=staff` 显示用户端/工作人员端。
- `frontend/user.html`：用户免注册预约入口，自动进入用户模式。
- `frontend/staff.html`：维修人员和管理员登录入口，自动进入工作人员模式。
- `frontend/assets/organization-logo.jpg`：组织 Logo，用于登录页和系统导航品牌标识。
- `frontend/styles.css`：页面样式、响应式布局和图表样式。
- `frontend/app.js`：ES Module 入口。
- `frontend/js/main.js`：模块初始化、页面切换和 API 数据同步。
- `frontend/js/auth.js`：统一账号登录、角色解析和权限继承。
- `frontend/js/booking.js`：预约创建、附件上传、名额校验、按所选校区实时显示当天人数、时段人数和剩余名额。
- `frontend/js/lookup.js`：使用预约编号 + 学号查询、实时计算前面排队人数、查看附件和取消预约。
- `frontend/js/staff.js`：维修后台筛选、抢单、状态修改、维修详情、附件查看和维修记录。
- `frontend/js/stats.js`：管理员统计，包括每日预约/完成、故障分类、校区和工作量。
- `frontend/js/users.js`：工作人员账号创建、学生基础角色升级、管理者权限管理界面。
- `frontend/js/store.js`：前端缓存和后端 API 同步的离线回退。
- `frontend/js/utils.js`：公共 DOM、日期、提示和安全转义工具。

## 后端 `backend/`

- `backend/server.js`：HTTP API 服务、静态文件代理、工作人员认证、免注册预约、队列、统计和用户管理接口。
- `backend/db.js`：数据库兼容入口，保持旧脚本调用方式不变。
- `backend/database/index.js`：数据库模块唯一启动入口，负责 schema、旧 JSON 导入和初始密码处理。
- `backend/database/connection.js`：数据库文件路径、环境变量和 SQLite 连接。
- `backend/database/schema.js`：表结构、索引和版本迁移；以后改表结构集中在这里。
- `backend/database/repository.js`：用户、预约、统计和队列的数据仓库接口；API 层不直接写 SQL。
- `backend/data/attachments/`：预约附件实际文件；生产环境应通过 `ATTACHMENTS_DIR` 指向独立持久化目录并纳入备份。
- `backend/security.js`：scrypt 密码哈希、HMAC JWT、过期和会话版本校验。
- `backend/privacy.js`：AES-256-GCM 联系方式加密和解密。
- `backend/scripts/migrate-pii-key.js`：部署前一次性迁移旧联系方式加密密钥。
- `backend/data/repair.sqlite`：运行后自动生成的 SQLite 数据库，部署时需要持久化此目录。
- `backend/data/appointments.json`、`backend/data/users.json`：首次启动时的旧版演示数据，数据库为空时自动导入。
- `backend/package.json`：后端启动配置，要求 Node.js 22.5 或更高版本（使用内置 `node:sqlite`）。
- `deploy/nginx.conf.example`：前端静态文件和后端 `/api` 反向代理配置模板。
- `deploy/.env.example`：生产环境变量模板，包含 JWT 密钥、数据库路径和初始密码。
- `deploy/pioneer-repair.service`：systemd 守护进程配置。
- `deploy/backup-db.sh`：使用 SQLite 在线备份接口生成数据库备份，同时压缩备份附件目录并清理 30 天前文件。
- `README.md`：当前实现、接口、数据库、部署和安全审计说明。
- `docs/requirements.md`：原始需求、设计记录和历史说明，作为业务背景及后续规划参考；当前实现以根目录 `README.md` 和代码为准。

## 启动开发环境

在项目根目录执行：

```bash
npm start
```

后端会同时代理 `frontend/`，访问：`http://localhost:8000`。

也可以只启动后端：

```bash
npm run start:backend
```

修改端口：

```powershell
$env:PORT=8001
npm start
```

## 主要 API

- `POST /api/auth/login`、`POST /api/auth/logout`：工作人员登录和会话撤销；普通用户无需登录。
- `GET /api/appointments`、`POST /api/appointments`：工作人员查询或访客创建预约。
- `GET /api/appointments/lookup`：使用预约编号 + 学号查询访客预约。
- `POST/GET /api/appointments/:id/attachments`、`GET /api/appointments/:id/attachments/:attachmentId`：上传、列出和查看预约附件；支持 JPG、PNG、WEBP、PDF、TXT，单文件不超过 5 MB。
- `PATCH /api/appointments/:id/status`：访客取消自己的待处理预约，工作人员修改状态、维修人员和维修记录。
- `GET /api/live/summary`：公开实时当天预约数、时段人数和排队位置。
- `GET /api/stats/summary`、`GET /api/stats/fault-types`：统计汇总，支持 `range` 和 `day` 参数；故障分类只统计已完成维修。
- `GET /api/users`、`POST /api/users`、`PATCH /api/users/:account`、`DELETE /api/users/:account`：用户、权限和退休账号管理；admin/root 可删除权限低于自己的账号，DELETE 会移除登录账号但保留历史预约。
- `GET /api/export/appointments.csv`：预约记录 CSV 导出。

## 服务器部署建议

1. 服务器安装 Node.js 22.5+、Nginx 和 `sqlite3` 命令行工具，创建独立的 `pioneer-repair` 系统用户。
2. 复制 `deploy/.env.example` 为 `backend/.env`，生成长度至少 32 位的随机 `JWT_SECRET` 和 64 位十六进制 `PII_ENCRYPTION_KEY`，并设置一次性的 `BOOTSTRAP_PASSWORD`。如果使用仓库外已有的 `repair.sqlite`，请先备份并通过管理界面重置原有账号密码；`BOOTSTRAP_PASSWORD` 只用于首次导入没有密码哈希的账号。
3. 将 `DB_FILE` 指向 `/var/lib/pioneer-repair/repair.sqlite`，将 `ATTACHMENTS_DIR` 指向 `/var/lib/pioneer-repair/attachments`，创建目录并赋予服务用户读写权限。
4. 安装并启用 `deploy/pioneer-repair.service`，使用 `systemctl enable --now pioneer-repair`。
5. 修改 `deploy/nginx.conf.example` 中的域名和证书路径，使用 Nginx 提供 HTTPS 和 `/api` 反向代理。
6. 设置 `FRONTEND_ORIGIN` 为正式 HTTPS 域名；同源部署时前端请求会自动携带 Bearer JWT。
7. 使用 `deploy/backup-db.sh` 配置每日定时备份；脚本会同时备份 SQLite 和附件文件，备份文件不要放在网站目录。

生产版已经包含：scrypt 密码哈希、JWT 会话、登录限流、后端角色权限校验、学生个人预约隔离、预约容量和日期校验、输入长度限制以及安全响应头。演示账号的初始密码来自 `BOOTSTRAP_PASSWORD`，上线后请立即通过管理界面重置。
