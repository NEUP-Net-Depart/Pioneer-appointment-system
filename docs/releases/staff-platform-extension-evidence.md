# 扩展性验收证据模板

| 用例 | 证据入口 | 状态 |
| --- | --- | --- |
| X01～X04 稳定身份、组织、字典、完整授权 | `tests/architecture/staff-platform.test.mjs` | 自动化 |
| X05～X08 会议策略、同日多场、QR/NFC 去重 | `tests/extension/meeting-fixture/` | 夹具 |
| X09～X11 权限时效、补录、原子冲突 | attendance / receipt API | 自动化 |
| X12 模块加载 | `src/modules/registry.js` | 自动化 |
| X13 规则演进 | roster version DTO | 自动化 |
| X14 空库与升级 | `npm run db:verify` | 自动化 |
| X15 统计一致 | reports / CSV 回归 | 发布前 |
| X16～X18 宿主隔离、凭证边界、请求重放 | staff host 与平台服务 | 自动化 |

本分支当前基线与迁移摘要见 `baseline-manifest.json`；发布时在该清单外补充实际实现 SHA、远端迁移结果、测试数据和运行时性能记录。
