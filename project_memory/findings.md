# 发现记录（初始化）

## 2026-04-05
- Git 工作区处于脏状态：大量已修改与未跟踪文件。
- 当前分支：`feat/mobile-android-bootstrap`（相对远端 ahead 2）。
- 本地 `main`：相对远端 ahead 15。
- 风险：在未明确“要合并哪些提交/文件”前直接 push 到 `main`，可能把临时或未验证内容带入主分支。

## 2026-04-05（分支合并执行）
- 已将 `feat/mobile-android-bootstrap` 通过 merge commit 合并到本地 `main`。
- 合并提交：`81d109b`。
- 冲突文件：`src/services/auth.service.ts`、`src/stores/auth.store.ts`，已按“保留 main 鉴权修复 + 接入新配置路径”原则解决。
- 推送状态：`git push origin main` 两次超时（网络连接 GitHub 443 超时），当前本地 `main` 相对 `origin/main` ahead 17。
- 代码检查：`npm run build` 通过（tsc + vite）。
- 审查风险：仓库已纳入大量 `.tmp/`、`dist-portable/`、`artifacts/` 大文件，存在仓库膨胀与泄露调试信息风险。

## 2026-04-05（清理提交）
- 已从 Git 跟踪中清理 `.tmp/`、`dist-portable/`、`artifacts/`、`.codex_sdk_list.txt`（仅移除索引，不删除本地文件）。
- 已在 `.gitignore` 增加对应忽略规则，避免二进制与调试文件再次入库。
- 已移除 `src/services/auth.service.ts` 中二维码登录调试 `console.log`。
- 清理后跟踪文件数：`296`（清理前 `933`）。
- 构建验证：`npm run build` 通过。
