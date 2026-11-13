# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目结构

- 双半插件：Host 半 `src/*.ts` 用 tsc 编译到 `dist/`；Client 半 `src/client.js` 是手写的纯 JS（DSH module-loader 格式），tsc 不检查，只由 `scripts/copy-client.mjs` 原样复制。
- 密钥解析、HTTP 抓取、缓存、刷新调度都在 Host 半；浏览器端只读插件自己的 `/minimax-usage/api/status` 和 `/minimax-usage/api/refresh`，不直接访问 MiniMax，也拿不到 Key。
- 零运行时依赖：宿主服务一律通过 `ctx.get("name")` / `ctx.inject(["name"], ...)` 取，不要 import `@deepseek-ai/*`。

## 命令

- `npm test` — vitest，全部用例离线运行（fetch / clock / env 都注入，不需要 Key）。
- 单文件：`npx vitest run tests/refresh.test.ts`；单用例：`npx vitest run -t "关键字"`。
- `npm run build` — `tsc` + `scripts/copy-client.mjs`。`npm run dev` 只 watch tsc，不会重新复制 `client.js`。
- 仓库没有 lint / formatter 配置；保持现有风格：2 空格、双引号、分号、尾逗号、约 100 列，不要引入新工具。
- Node ≥ 20（CI 用 22），开发用 npm（`package-lock.json`）。

## dist/ 必须跟源码一起提交

- `dist/` 在 `.gitignore` 里但已被 git 跟踪：为了让从 GitHub source 安装的用户跳过构建，`prepare` 钩子被刻意移除，安装方直接用仓库里的 `dist/`。
- 所以改完 `src/` 要 `npm run build`，并把 `dist/` 的改动一起提交；新增的 dist 文件被 `.gitignore` 挡住，需要 `git add -f dist/<file>`。

## 硬约束

- `src/index.ts` 的 `apply` 必须保持箭头函数。Cordis 用 `isConstructor(cb)` 分流，普通 `function` / class 会走 class 分支并丢掉返回的 disposer，宿主的计时器永远不释放，DSH 桌面端更新会失败。
- 用户可见文案（UI 文案、错误提示、README、CHANGELOG）用中文；代码注释、标识符、commit subject 用英文。
- `src/client.js` 没有自动化测试；改 UI 后由用户重装插件、重启 DSH 手动验证。

## 环境变量

- 测试不需要 Key。手动跑宿主时用 `MINIMAX_API_KEY`（国际站）/ `MINIMAX_CN_API_KEY`（国内站），优先取 `ctx.credentials`，其次进程环境变量；只查询已配置的区域。

## 分支、提交与发布

- 在 feature 分支（如 `mobile-tap-expand`）上开发，push 到 origin（你的 fork）；不要向上游 `pan17/dsh-minimax-usage` 提 PR。
- 提交信息沿用现有风格：`Area: 简短英文祈使句`（如 `Mobile: hide 7d row ...`），正文写清问题与修复原因，末行 `Files changed: ...`。
- 发版只走 tag：更新 `CHANGELOG.md` 的 `[Unreleased]` 和 `package.json` 的 `version`（必要时 `engines.dsh`）→ 推 `vX.Y.Z` tag → `.github/workflows/release.yml` 依次做 CI 绿灯门槛、GitHub Release、npm publish。推 tag / 发布前必须先获得用户确认；完整清单见 `PUBLISH.md`。
