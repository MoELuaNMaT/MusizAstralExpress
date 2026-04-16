# ALLMusic

一个基于 **Tauri + React + TypeScript** 的桌面应用，用于聚合网易云音乐与 QQ 音乐账号，提供统一的登录、歌单浏览、搜索与收藏操作。

## 当前状态（2026-04-17）

- 前端构建可通过：`npm run build`（2026-04-17 已验证）
- 桌面端 Rust 侧检查可通过：`cargo check --manifest-path src-tauri/Cargo.toml`（2026-04-17 已验证）
- 桌面端默认主界面为 `player_4 / RetroShell`，主链路围绕“登录、我喜欢、日推、播放、歌词”维护
- `npm run tauri:dev` 现在会先清理桌面端旧缓存包体，再启动 Tauri；调试态优先使用工作区源码，不再误命中历史 `vendor` bundle
- 网易云“我喜欢”链路已恢复，QQ 日推当前走“QQ Mac 首页 -> 今日私享歌单 -> 30 首歌曲”的真实日推语义
- QQ 播放已恢复直接消费后端返回的 CDN 地址，不再默认走本地代理流
- 桌面端本地存储使用 Tauri Store（`auth_store.json`）
- 安装版 / 便携包依赖 `src-tauri/vendor.zip` 随包运行时；调试态与发布态的运行时来源已明确分离
- Android / iOS 相关脚本仍保留，但本轮未做重新验证
- 默认本地端口：
  - 前端：`1420`
  - 网易 API：`3000`
  - QQ 适配服务：`3001`

## 环境要求

- Node.js 18+
- npm 9+
- Python 3.10+（用于 QQ 本地适配服务）
- Rust 工具链（仅在运行 Tauri 桌面端时需要）
- Node.js + Python 运行时（桌面端会自动拉起本地 API 服务）
- JDK 17+ + Android SDK（仅在运行 Android 端时需要）
- macOS + Xcode（仅在推进 iOS 端时需要）

## 快速开始

浏览器联调：

```bash
npm install
npm run dev:all
```

桌面端调试：

```bash
npm install
npm run tauri:dev
```

启动后访问：

- 前端：<http://localhost:1420>
- 网易 API：<http://localhost:3000>
- QQ 适配服务：<http://localhost:3001/health>
- QQ 个性化日推接口：<http://localhost:3001/recommend/daily?limit=30>
- QQ 歌词接口：<http://localhost:3001/song/lyric?mid=00265JxS3JzUtw>

## 常用命令

- `npm run dev`：仅启动前端
- `npm run api:netease`：仅启动网易 API
- `npm run api:qq`：仅启动 QQ 适配服务（Python + FastAPI）
- `npm run ports:clean`：清理 3000/3001 端口占用进程（用于处理端口冲突）
- `npm run desktop:cache:clean`：清理桌面端 `%LOCALAPPDATA%/com.allmusic.app/vendor` 下的旧 bundle / runtime 缓存
- `npm run dev:services`：仅启动网易 API + QQ 适配服务（不启动前端）
- `npm run dev:services:clean`：先清理端口再启动双 API
- `npm run dev:all`：启动网易 API + QQ 适配服务 + 前端
- `npm run tauri:dev`：启动桌面端调试；会先清理旧桌面 bundle 缓存，再按当前工作区代码拉起本地 API
- `npm run tauri:dev:legacy`：显式并发拉起网易 API、QQ API 和 Tauri，便于排查服务启动问题
- `npm run build`：TypeScript 检查并打包前端
- `npm run build:vendor`：构建安装版 / 便携包使用的 `src-tauri/vendor.zip`
- `npm run android:check`：检查 Android 必需环境变量与命令
- `npm run android:init`：初始化 Android 工程（需先通过环境检查）
- `npm run android:dev`：启动安卓调试（含双 API）
- `npm run android:build`：构建安卓包（含双 API）
- `npm run ios:plan`：查看 iOS 端后续接入步骤

## 移动端开发（初始接入）

- Android：已完成命令与配置预置，详见 `docs/mobile/README.md`
- iOS：已预留 `src-tauri/tauri.ios.conf.json`，等 macOS 环境就绪后可直接初始化

## 最小 Smoke 测试

> 说明：用于快速验证“登录状态读取、歌单接口、搜索接口”三条链路是否可达。

```bash
npm run smoke:services
```

可选环境变量：

- `SMOKE_SKIP_START=1`：跳过启动服务（用于你已手动启动 API 的场景）
- `SMOKE_ALLOW_QQ_INSTALL=1`：允许 QQ 适配脚本安装/升级 Python 依赖

脚本会自动：

1. 启动网易 API 与 QQ 适配服务
2. 检查登录状态接口（`/login/status`）
3. 检查歌单接口（`/user/playlist`）
4. 检查搜索接口（`/search/songs`）
5. 输出通过/失败结果并自动停止子进程

## 目录说明（核心）

- `src/pages`：页面层（`Login.tsx`、`Home.tsx`）
- `src/services`：业务与 API 聚合逻辑（当前主入口）
- `src/stores`：Zustand 状态管理
- `src/components/retro`：当前桌面主 UI（`player_4 / RetroShell`）
- `src-tauri`：桌面端 Rust 代码与 Tauri 配置
- `scripts`：本地 API 启动、缓存清理、vendor 打包与诊断脚本

## 常见问题

1. **3000 端口被占用**
   - 启动脚本会直接报错并提示占用 PID。
   - 执行 `npm run ports:clean` 自动清理，或手动结束占用进程后重试。

2. **3001 端口不可用 / QQ 适配服务启动失败**
   - 确认 Python 可用：`python --version`
   - 若首次安装依赖较慢，可重试 `npm run api:qq`
   - 若提示端口占用，先执行 `npm run ports:clean`

3. **1420 端口冲突**
   - Vite 配置了 `strictPort: true`，必须释放 1420 端口。

4. **登录后状态丢失**
   - 桌面端使用 Tauri Store 持久化；浏览器模式使用 localStorage 回退存储。

5. **网易云“我喜欢”歌单顺序与官方不一致**
   - 当前策略（2026-02-12）：桌面端首次会抓取网易云网页歌单顺序并缓存，后续通过增量合并（新增歌曲自动置顶）维持稳定排序。
   - 回退行为：若网页顺序抓取失败，则回退到 API 结果（仍支持“最新优先 / 最早优先 / API 原序”切换）。

6. **桌面端提示“本地 API 启动失败”**
   - 先确认 `node -v`、`python --version` 可用。
   - 在项目根目录执行 `npm install` 以确保 `node_modules` 完整。
   - 首次启动 QQ 适配器会自动安装 Python 依赖，耗时可能较长（应用会显示启动进度与日志）。

7. **为什么 `npm run tauri:dev` 有时像是在跑旧代码？**
   - 当前版本已默认修复这类问题：`tauri:dev` 会先执行 `desktop:cache:clean`，清掉桌面端旧 `vendor` 缓存。
   - 调试态本地 API 现在优先使用工作区 `scripts/` 和当前源码，不再优先使用随包 `vendor.zip`。
   - 如果你刚切过分支或改过本地 API，优先重新执行一次 `npm run tauri:dev`，不要直接复用旧桌面进程。

8. **发布包和调试态为什么行为不同？**
   - 调试态目标是“始终运行工作区最新代码”。
   - 安装版 / 便携包目标是“脱离开发环境独立运行”，因此会使用 `src-tauri/vendor.zip` 内的随包 Node / QQ 适配器运行时。
   - 如果你修改了本地 API 或运行时脚本，并且要同步到发布包，需要重新执行 `npm run build:vendor`。

## 安全说明

- 当前 `src-tauri/tauri.conf.json` 中 `csp` 为 `null`，便于本地开发联调。
- 发布前建议收紧 CSP，并对外部资源域名做白名单控制。
