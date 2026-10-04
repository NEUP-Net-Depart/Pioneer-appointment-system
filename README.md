# 先锋硬件部免费维修预约系统

这是先锋网络中心硬件部的免费维修预约系统。项目采用静态前端、Node.js API 和 SQLite 数据库的分层结构：访客无需注册即可提交预约，维修人员接单并更新维修状态，管理者负责预约、人员和统计，最高权限者负责角色授权。

本服务不收费，配件和耗材由机主自行准备。

## 当前实现范围

已实现的核心流程：

1. 访客免注册预约，使用预约编号 + 学号查询和取消自己的预约；用户端提供独立的精简预约入口。
2. 完整维修单字段、容量检查、重复预约检查和电子协议记录。
3. 实时查看当天、校区、时段人数和自己的排队位置。
4. 维修人员抢单、状态更新和维修记录。
5. 管理者导出 CSV、查看每日统计、故障分类和人员工作量。
6. 工作人员账号使用学号；基础角色仍可由管理者创建，管理者可将其提升为维修人员，最高权限者可以授予管理者权限。
7. 预约单可上传 JPG、PNG、WEBP、PDF、TXT 附件，单个文件不超过 5 MB。
8. 删除下位账号：从用户表移除登录账号，历史预约和统计数据保留。
9. SQLite 数据库模块与 API 层分离，可通过仓库接口迁移到其他数据库。

排班、工具管理、操作日志、通知、评价和知识库仍属于后续扩展，不在当前 API 中伪装为已完成功能。

## 项目结构

```text
预约系统/
├─ frontend/                         # 静态前端，可由 Nginx/CDN 提供
│  ├─ index.html                     # 共享模板，按 user/staff 模式显示对应页面
│  ├─ user.html                      # 用户精简预约入口
│  ├─ staff.html                     # 维修人员/管理员工作台入口
│  ├─ app.js                         # ES Module 兼容入口
│  ├─ styles.css                     # 响应式和科技风界面
│  ├─ assets/organization-logo.jpg   # 组织 Logo
│  └─ js/
│     ├─ main.js                     # 模块初始化、页面切换、登录后刷新
│     ├─ auth.js                     # 登录、会话恢复、退出和角色菜单
│     ├─ booking.js                  # 预约表单、附件上传、日期/容量提示和实时人数
│     ├─ lookup.js                   # 我的预约、排队位置、附件查看和取消预约
│     ├─ staff.js                    # 维修工作台、抢单、状态、附件和维修记录
│     ├─ stats.js                    # 每日、故障、校区、维修人员统计
│     ├─ users.js                    # 人员启停用、密码重置、学生晋升、权限
│     ├─ store.js                    # API 同步、本地缓存和预约更新
│     └─ utils.js                    # DOM、提示、转义和带 token 的请求
├─ backend/
│  ├─ server.js                      # HTTP API 和静态文件代理，不直接执行 SQL
│  ├─ security.js                    # scrypt 密码哈希和 HMAC-SHA256 JWT
│  ├─ privacy.js                     # AES-256-GCM 联系方式加密/解密
│  ├─ database/
│  │  ├─ index.js                    # 数据库模块启动入口和旧数据导入
│  │  ├─ connection.js               # DB_FILE、目录和 SQLite 连接
│  │  ├─ schema.js                   # 表结构、索引和 schema 迁移
│  │  └─ repository.js               # 所有 SQL、字段映射和数据接口
│  ├─ db.js                          # 旧脚本兼容入口，新代码使用 ./database
│  ├─ scripts/migrate-pii-key.js     # 部署前迁移旧联系方式密钥
│  ├─ data/
│  │  ├─ repair.sqlite               # 运行数据库，必须持久化
│  │  ├─ users.json                  # 空数据库首次启动时的旧数据导入源
│  │  ├─ appointments.json           # 空数据库首次启动时的旧数据导入源
│  │  └─ attachments/                # 预约附件文件，生产环境应持久化并备份
│  ├─ package.json                   # 后端启动脚本
│  └─ .env                           # 生产配置，不提交到仓库
├─ deploy/
│  ├─ .env.example                   # 生产环境变量模板
│  ├─ nginx.conf.example             # HTTPS、静态文件和 /api 反向代理
│  ├─ pioneer-repair.service         # systemd 服务
│  └─ backup-db.sh                   # SQLite 与附件备份和 30 天清理
├─ package.json                      # 根目录启动脚本
├─ B84CB3B7B9CDA84FD38EC7309D0E4008.jpg # Logo 原始副本（实际页面使用 frontend/assets/organization-logo.jpg）
├─ PROJECT_FILES.md                  # 文件快速索引
├─ docs/requirements.md              # 原始需求、设计记录和历史说明
└─ README.md                         # 当前实现、接口和部署说明
```

## 分层边界

```text
浏览器 -> backend/server.js -> backend/database/index.js
                                      ├─ connection.js
                                      ├─ schema.js
                                      └─ repository.js -> repair.sqlite
```

`server.js` 只使用 `listUsers`、`createAppointment`、`updateUser` 等仓库接口，不创建 SQLite 连接、不读写数据库文件、不拼接业务 SQL。数据库相关修改集中在 `backend/database/`：

- 修改文件路径或换数据库驱动：改 `connection.js`。
- 增加字段、索引或迁移：改 `schema.js`。
- 修改查询、事务和字段映射：改 `repository.js`。
- API 路由只负责认证、输入校验、权限和 HTTP 响应。

预约创建在数据库事务中执行重复预约、容量和编号检查，并使用唯一索引避免并发请求超卖。`DB_FILE` 可以指向代码目录外的持久化文件，因此升级 backend 不会覆盖数据。

预约容量为每个校区、每个服务时段 20 人；前端和后端使用同一容量配置。

## 账号体系和权限

权限从低到高为：`student` → `technician` → `admin` → `superadmin`。

| 能力 | student | technician | admin | superadmin |
|---|---:|---:|---:|---:|
| 注册/登录 | 免注册预约；仅作为基础工作人员角色 | 工作人员账号登录 | 工作人员账号登录 | 仅内置 `root001`、`root002` |
| 提交预约 | 直接提交 | 是 | 是 | 是 |
| 查看预约 | 预约编号 + 学号 | 工作列表 | 全部 | 全部 |
| 抢单和维修记录 | 否 | 自己接单 | 全部 | 全部 |
| 导出和统计 | 否 | 否 | 是 | 是 |
| 管理维修人员 | 否 | 否 | 低于自己的账号 | 全部低级账号 |
| 学生晋升维修人员 | 否 | 否 | 是 | 是 |
| 授予 admin | 否 | 否 | 否 | 是 |
| 删除下位账号 | 否 | 否 | 低于自己的账号 | 低于自己的账号 |

`root001` 和 `root002` 是受保护的 `superadmin`，不能停用、删除、重置或降级。所有服务端权限都重新校验，前端隐藏菜单不构成安全边界。管理员本质上也是维修人员，但维修人员不能处理其他维修人员已接单的预约。

开发数据库中如果仍有早期的 `admin001`、`admin002`、`tech001`、`tech002`，它们属于历史演示账号；管理员新建的工作人员账号已强制使用数字学号。上线前请按实际学号完成迁移，或在全新数据库中由 root 创建正式账号。

删除账号会从 `users` 表移除登录记录，但不会删除预约表中的历史预约、维修记录或统计数据。

## 数据库结构

### `schema_migrations`

保存已应用的 schema 版本和时间。

### `users`

| 字段 | 作用 |
|---|---|
| `account` | 账号主键；除两个 root 外统一为 6-20 位数字学号 |
| `name` | 姓名/显示名 |
| `role` | `student`、`technician`、`admin`、`superadmin` |
| `campus` | 南湖、浑南或两校区 |
| `active` | 是否允许登录 |
| `protected` | 是否为 root 保护账号 |
| `password_hash` | scrypt 哈希，不保存明文密码 |
| `token_version` | 会话撤销版本，密码重置/退出时递增 |
| `created_at` | 创建日期 |

### `appointments`

保存学生、设备、故障、校区、日期、时段、协议、状态、接单人和维修记录。联系方式 `phone`、`social` 使用 AES-256-GCM 加密；服务启动时会自动把旧的明文联系方式迁移为密文，接口读取时解密。

关键索引：

- `idx_appointments_queue`：日期、校区、时段、创建时间，用于排队。
- `idx_appointments_fault`：故障类型，用于统计。
- `idx_active_student_slot`：同一学生同一日期时段只能有一个未取消预约。

状态值：`pending`、`awaiting_claim`、`claimed`、`in_progress`、`completed`、`cancelled`、`no_show`、`no_repair`。故障分类只统计 `completed`。

### `appointment_attachments`

保存预约附件的元数据，实际文件保存于 `ATTACHMENTS_DIR` 指向的目录。

| 字段 | 作用 |
|---|---|
| `id` | 附件唯一标识 |
| `appointment_id` | 所属预约编号 |
| `filename` | 用户上传时的文件名 |
| `mime_type` | 文件 MIME 类型 |
| `size` | 文件大小，字节 |
| `storage_path` | 服务端实际存储路径，不通过接口返回 |
| `created_at` | 上传时间 |

附件表只保存元数据，数据库备份不能替代附件文件备份。

## API 接口

除公开接口外，均使用：

```http
Authorization: Bearer <JWT>
```

### 认证

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| `GET` | `/api/health` | 公开 | 健康检查 |
| `POST` | `/api/auth/login` | 公开 | 统一账号密码登录，返回角色、权限和 JWT |
| `GET` | `/api/auth/me` | 已登录 | 验证当前会话和账号信息 |
| `POST` | `/api/auth/logout` | 已登录 | 递增会话版本，使当前 JWT 失效 |

### 预约和队列

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| `GET` | `/api/appointments` | 工作人员登录 | 维修人员/管理员返回工作列表 |
| `POST` | `/api/appointments` | 公开 | 免注册创建预约；服务日为周一至周四，日期为今天起 3 天内 |
| `GET` | `/api/appointments/lookup?appointmentId=...&studentId=...` | 公开 | 使用预约编号 + 学号查询单条预约 |
| `PATCH` | `/api/appointments/:id/status` | 查询凭证或工作人员 | 访客可取消自己的待处理预约；工作人员可接单、更新状态和维修记录 |
| `POST` | `/api/appointments/:id/attachments` | 对应访客或维修人员 | 上传 JPG、PNG、WEBP、PDF、TXT 附件；单文件不超过 5 MB |
| `GET` | `/api/appointments/:id/attachments?studentId=...` | 对应访客或工作人员 | 获取预约附件元数据 |
| `GET` | `/api/appointments/:id/attachments/:attachmentId` | 对应访客或工作人员 | 查看/下载附件内容 |
| `GET` | `/api/live/summary` | 公开 | 按选择的校区返回当天预约量、时段量、剩余名额、前方人数和当前名次 |

预约字段规则：手机号选填，QQ/微信必填，期望日期必填，故障描述选填；其余设备、身份、校区、时段和协议字段按接口校验。后端还会校验手机号格式（填写时）、字段长度、学号格式、重复预约、容量、维修人员是否启用以及状态跳转。维修人员只能从待接单状态抢单，并只能修改自己接单的预约。

### 管理和统计

| 方法 | 路径 | 权限 | 用途 |
|---|---|---|---|
| `GET` | `/api/stats/summary?range=7&day=YYYY-MM-DD` | `admin+` | 每日预约、完成率、爽约率、校区和维修人员 |
| `GET` | `/api/stats/fault-types?range=7&day=YYYY-MM-DD` | `admin+` | 已完成预约的故障分类 |
| `GET` | `/api/users` | `admin+` | 用户列表，不返回密码哈希 |
| `POST` | `/api/users` | `admin+` | 创建工作人员基础账号；账号为学号，创建后再通过权限操作升级 |
| `PATCH` | `/api/users/:account` | 管理低级账号 | 启停用、重置密码、学生晋升、角色调整 |
| `DELETE` | `/api/users/:account` | `admin+` | 删除权限低于自己的账号，保留历史预约和统计数据 |
| `GET` | `/api/export/appointments.csv` | `admin+` | 导出 CSV，已处理公式注入 |

常见响应：未登录/会话撤销为 `401`，权限不足为 `403`，参数错误为 `400`，重复预约或容量已满为 `409`，不存在的资源为 `404`。

## 前端功能对应

用户入口 `/user.html` 使用精简布局：顶部仅显示融入背景的组织 Logo 和服务提示，下面依次显示实时排队/名额信息和预约表单。工作人员入口 `/staff.html` 保留登录、维修工作台、统计和账号管理功能。

| 文件 | 功能 |
|---|---|
| `user.html` | 用户预约入口，跳转到用户模式 |
| `staff.html` | 工作人员登录和工作台入口，跳转到工作人员模式 |
| `auth.js` | 用户/工作人员模式切换、工作人员登录、JWT 会话恢复和退出 |
| `booking.js` | 预约表单、协议、附件上传、实时名额和队列人数，每 10 秒更新 |
| `lookup.js` | 预约编号 + 学号查询、排队位置、附件查看和取消预约 |
| `staff.js` | 筛选预约、抢单、状态更新、维修记录、附件查看和 CSV 导出 |
| `stats.js` | 7 天、30 天、全部和指定日期统计图表 |
| `users.js` | 启用/停用、密码重置、学生晋升、管理者授权和下位账号删除 |
| `store.js` | API 同步；服务端失败时不会把失败修改写入本地缓存 |
| `utils.js` | HTML 转义、请求 token、提示和公共 DOM 工具 |

## 本地启动

要求 Node.js `22.5+`（使用内置 `node:sqlite`）。

```bash
npm start
```

访问 `http://localhost:8000`。用户预约入口为 `http://localhost:8000/user.html`，工作人员入口为 `http://localhost:8000/staff.html`。后端会代理 `frontend/`，因此本地不需要单独启动静态文件服务器。只启动后端可用：

```bash
npm run start:backend
```

可通过环境变量覆盖端口或数据库路径：

```powershell
$env:PORT=8001
$env:DB_FILE='D:\data\pioneer-repair.sqlite'
npm start
```

## 生产部署

1. 安装 Node.js 22.5+、Nginx 和 `sqlite3` 命令行工具，并创建 `pioneer-repair` 系统用户。
2. 将项目部署到 `/opt/pioneer-repair-booking`。
3. 复制 `deploy/.env.example` 为 `backend/.env`。
4. 设置随机的 `JWT_SECRET`（至少 32 个字符）和 64 位十六进制 `PII_ENCRYPTION_KEY`。
5. 设置一次性的 `BOOTSTRAP_PASSWORD`，仅用于没有密码哈希的旧账号。
6. 将 `DB_FILE` 指向 `/var/lib/pioneer-repair/repair.sqlite`，将 `ATTACHMENTS_DIR` 指向持久化附件目录（例如 `/var/lib/pioneer-repair/attachments`），并赋予服务用户对数据库和附件目录读写权限；服务时间按 `Asia/Shanghai` 计算。
7. 安装 `deploy/pioneer-repair.service`，执行 `systemctl enable --now pioneer-repair`。
8. 修改 `deploy/nginx.conf.example` 的域名和证书路径，Nginx 提供 HTTPS，并将 `/api/` 反向代理到 `127.0.0.1:8000`。
9. 使用 `deploy/backup-db.sh` 配置每日备份，备份文件不要放在网站目录；同时备份 `ATTACHMENTS_DIR`，SQLite 备份只包含附件元数据，不包含实际文件。

如果要保留当前开发数据库，先在原机器停掉服务并做备份，再把数据库复制到服务器的持久化目录。当前开发数据库的联系方式使用代码中的开发默认密钥；生产不能继续使用它。迁移步骤如下：

```bash
# 在旧数据库副本上执行，先准备新生产密钥
export DB_FILE=/var/lib/pioneer-repair/repair.sqlite
export OLD_PII_ENCRYPTION_KEY="$(node -e "process.stdout.write(require('crypto').createHash('sha256').update('development-only-pioneer-pii-key').digest('hex'))")"
export PII_ENCRYPTION_KEY="$(openssl rand -hex 32)"
npm run migrate:pii-key
```

迁移成功后，把同一个 `PII_ENCRYPTION_KEY` 写入 `backend/.env`，再启动 systemd。迁移前必须保留 SQLite 备份；不要在迁移后删除旧密钥和旧备份，直到确认线上联系方式可正常读取。

生产环境必须设置：

| 变量 | 说明 |
|---|---|
| `NODE_ENV` | `production`，启用强制密钥检查 |
| `PORT` | API 端口，默认 `8000` |
| `HOST` | 监听地址，生产默认 `127.0.0.1`，由 Nginx 对外提供 HTTPS |
| `JWT_SECRET` | JWT 签名密钥，至少 32 字符 |
| `PII_ENCRYPTION_KEY` | AES-256-GCM 密钥，64 位十六进制 |
| `BOOTSTRAP_PASSWORD` | 缺失密码哈希账号的初始密码 |
| `FRONTEND_ORIGIN` | 跨域部署时允许的前端来源；同源 Nginx 部署可留空 |
| `DB_FILE` | 持久化 SQLite 文件路径 |
| `ATTACHMENTS_DIR` | 附件持久化目录，默认 `backend/data/attachments` |

不要提交 `.env`、SQLite 数据库、WAL 文件和备份。修改 schema 前先备份数据库。

## 安全检查结果

- 生产环境强制检查 JWT 和 PII 密钥。
- 密码使用 scrypt，联系方式使用 AES-256-GCM。
- JWT 使用 HMAC 签名、过期时间和用户 `token_version`；退出登录/密码重置后旧 token 失效。
- 登录、访客预约、查询和实时人数接口按来源地址限流。
- 所有权限在后端再次校验，学生预约隔离，维修人员接单隔离。
- 使用参数化 SQL、输入长度限制、严格静态路径检查和安全响应头。
- CSV 单元格处理 `= + - @`，避免公式注入。
- 预约使用 SQLite 事务和唯一索引，避免并发重复/超卖。
- `repair.sqlite-wal` 和 `repair.sqlite-shm` 属于数据库的一部分，备份应使用在线备份工具。

当前仍需人工运营配合的事项：生产环境设置强随机密钥、启用 HTTPS、定期备份、定期迁移旧明文联系方式，并限制服务器文件权限。

`PII_ENCRYPTION_KEY` 是联系方式解密所必需的长期密钥，必须放在密码管理器或服务器密钥系统中；更换前需要先完成数据迁移，否则旧联系方式无法解密。

## 验证命令

```powershell
# 检查所有 JS 语法
Get-ChildItem backend,frontend -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }

# 健康检查
Invoke-WebRequest http://localhost:8000/api/health

# 查看数据库表和迁移版本
node -e "const db=require('./backend/database'); console.log(db.db.prepare('SELECT * FROM schema_migrations').all())"
```

当前开发服务地址：`http://localhost:8000`。
