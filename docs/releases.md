# 按需发布

在默认分支 `dev` 的 Actions → **Request production release** → **Run workflow** 发起，或发送 `/release prepare`。仅 maintain/admin 可用；已有发布 PR 时复用。

- PR 创建两小时后自动合并，无需审批。新 dev 提交会更新变更和贡献者，时间不重置。
- 最新 dev 的 `checks`、`browser`、`test`、`migrate-preview`、`release` 必须通过，且无冲突；否则等待重试。PR 中跳过的检查不计入。
- 关闭 PR 或移除 `auto-release` 可取消，重新打开或加标签不会恢复。再次发布需先关闭旧 PR。
- `/release status` 查看状态；维护者可用 `/release publish` 提前合并，仍需通过检查。

## 部署与 Tag

生产流程：main push → Production D1 迁移 → Pages → HTTP Smoke → Annotated Tag。失败、Preview 和功能分支不打正式 Tag，不创建 GitHub Release。

Tag 格式为 `release-YYYYMMDD-<12位SHA>`，日期取部署提交的 committer date（北京时间）。重跑不重复创建；已有 Tag 指向其他提交时报错。Tag Job 失败可单独重跑。

## 上线配置

复用现有 Piper App；main 人工审查规则需单独配置 PR-only bypass，其他保护及 dev 规则保留。入口只需 `contents: read`，Tag Job 使用 `contents: write`。保留 production Environment 的 main 分支限制，不自动删除 dev。

完整权限、Ruleset 配置及上线顺序见 [Piper Release 操作说明](https://github.com/NEUP-Net-Depart/piper/blob/main/docs/releases.md)。本地改动尚未应用到线上配置。

验证：

```sh
node --test tests/release.test.ts tests/release-tag.test.ts
npx eslint scripts/ci-release.ts scripts/release-tag.ts tests/release-tag.test.ts --max-warnings 0
```
