# ALLMusic 跨平台（Windows & Android）执行计划

## 0. 执行进度（2026-02-24）
- ✅ 已完成：登录页中文乱码修复（`src/pages/Login.tsx`），并更新项目状态文档（`README.md`）。
- ✅ 已执行：`npm run build`、`npm run smoke:services`、`npm run ios:plan`。
- ✅ 已完成：Android 环境补齐（JDK 17、Platform Tools、SDK API 33、Build Tools 33.0.2、NDK 26.3），`npm run android:check` 已通过。
- ✅ 已完成：`npm run android:init` 成功，已生成 `src-tauri/gen/android`。
- ✅ 已完成：`AndroidManifest.xml` 已补充 `FOREGROUND_SERVICE`、`WAKE_LOCK` 权限。
- ✅ 已完成：`tauri android build -v --target aarch64` 成功，已生成 APK/AAB 产物。
- ✅ 已完成：为 `src-tauri/gen/android` 增加镜像仓库（阿里云）以提升 Maven 依赖下载稳定性。
- ✅ 已完成：P1 API 适配主干（`runtime isMobile` + 平台配置中心 + 动态 BaseUrl 读取）并通过 `npm run build` / `npm run smoke:services`。
- ✅ 已完成：P1 视觉改造首批（Safe Area + 44x44 触控目标 + `tailwind` mobile 断点 + `is-mobile` 全局类）。
- ✅ 已记录并修复：`smoke:services` 冷启动“进程未回收导致超时”问题（`scripts/smoke-services.cjs`，2026-02-24）；同时记录 QQ 搜索接口偶发 500，后续做稳定性增强。
- ✅ 已完成：Android 模拟器已联通（`emulator-5554`），`adb devices` 可稳定识别设备。
- ✅ 已解决阻塞：Windows 非 ASCII 用户目录导致 Android linker 失败；通过独立 ASCII Rust 环境 + SDK ASCII 路径注入规避（`scripts/run-android-tauri.cjs`）。
- ✅ 已完成：`npm run android:tauri:build:debug` 成功产出 debug APK/AAB，并通过 `adb install -r` + `adb shell monkey -p com.allmusic.app 1` 完成端上启动验证。
- ✅ 已完成：2.3 状态持久化适配验证（Android 端 `tauri-plugin-store` 可读可写可跨重启持久化，见 `AUTH_STORE_PROBE` 日志）。
- ✅ 已完成：端上基础交互验收（底部 Tab 在模拟器上可切换“整合歌单 / 每日推荐”）。
- ✅ 已修复：移动端顶部搜索浮层窄宽挤压问题（Header 改为移动端两行布局，搜索浮层文本恢复正常横排）。
- ✅ 已记录并修复提示：Android 模拟器“本地 API 未启动/端口不可达”根因是宿主机 `3000/3001` 未监听；已在服务层补充可执行指引（先运行 `npm run dev:services` 或 `npm run android:dev`，并确认 `10.0.2.2:3000/3001` 可达）。
- ✅ 已完成（4.1 代码侧第一阶段）：接入 Web MediaSession（元数据、播放/暂停、上一首/下一首、拖动进度）作为增强能力。
- ⚠️ 已验证阻塞：当前 Android 模拟器（Android 13 / WebView Chrome 109）`navigator.mediaSession` 不可用，Web 方案在端上无法生效。
- ✅ 已完成（4.1 原生方案首版）：新增 Android `AllMusicPlaybackService`（MediaSession + 通知栏三键控制）并通过 JS Bridge 同步播放状态。
- ✅ 已完成（4.2 基础版）：播放服务以前台服务形态运行，App 退到后台后服务与通知仍保活。
- ⚠️ 待补充验收：通知栏按钮在模拟器命令行难以稳定触发，需补一轮“手点通知栏按钮”的端上验收录像/截图。
- ⚠️ 待补充：播放详情沉浸层（3.3 第二子项）仍需在可播放歌曲场景下做端上验收。
- ⏭️ 下一步：补齐 4.1 通知栏按钮手工验收证据，并推进 4.3 物理返回键策略；同时补齐播放详情沉浸层端上验收。

## 1. 核心目标
- **多端共存**: 维护单一代码库（Single Codebase），同时产出 Windows (.exe) 和 Android (.apk) 安装包。
- **环境自适应**: 根据运行平台自动切换 API 策略（本地 Sidecar vs 远程 Proxy）。
- **体验对齐**: 确保安卓端具备与 PC 端一致的歌单管理、播放控制及账号同步能力。

---

## 2. 详细执行阶段 (Roadmap)

### 第一阶段：安卓基础环境与初始化 (P0 - 阻塞项)
- [x] **1.1 环境检查**: 已运行 `npm run android:check`（2026-02-23），当前结果：通过。
- [x] **1.2 项目初始化**: 已运行 `npm run android:init`，成功生成 `src-tauri/gen/android` 目录。
- [x] **1.3 权限声明**: 已在 `AndroidManifest.xml` 中补充 `INTERNET`, `FOREGROUND_SERVICE`, `WAKE_LOCK` 权限。
- [x] **1.4 基础打包测试**: `tauri android build -v --target aarch64` 已通过并产出安装包；`app-universal-debug.apk` 已在模拟器安装并可启动（2026-02-24）。

### 第二阶段：API 适配层重构 (P1 - 核心逻辑)
- [x] **2.1 环境检测逻辑**: 已在 `src/lib/runtime.ts` 中实现 `isMobile()` 检测逻辑（含 iPad 桌面 UA 兜底）。
- [x] **2.2 动态 BaseUrl**: 已新增 `src/config/platform.config.ts`，统一支持按环境从 `config` / `env` / localStorage override 解析 `baseUrl`。
    - *PC*: `http://localhost:3000` (网易) / `http://localhost:5000` (QQ)。
    - *Android*: `https://api-proxy.yourdomain.com` (需搭建)。
- [x] **2.3 状态持久化适配**: 已通过 `probe_auth_store` 命令验证 Android 下 `tauri-plugin-store` 路径与持久化能力（`/data/user/0/com.allmusic.app/auth_store.json`，跨重启 `previous_probe_found=true`）。

### 第三阶段：UI 响应式与触控优化 (P1 - 视觉)
- [x] **3.1 Safe Area 适配**: 已在 `index.css` 增加 `safe-area-inset-*` 适配，防止 UI 被挖孔屏/手势条遮挡。
- [x] **3.2 触摸目标优化**: 已引入 `am-touch-target` 与按钮最小尺寸约束，关键交互按钮 Hit Area 至少 44x44px。
- [x] **3.3 布局切换**: 
    - 已完成手机端底部 Tab 导航（整合歌单 / 每日推荐）。
    - 已完成移动端播放详情沉浸式全屏（打开详情时隐藏底部播放栏）。
    - 已完成模拟器端验收：底部 Tab 切换正常；搜索浮层在移动端正常显示。
    - 待补充验收：播放详情沉浸层需在“成功播放歌曲”场景下确认。

### 第四阶段：安卓原生特性接入 (P2 - 进阶)
- [ ] **4.1 媒体会话 (MediaSession)**: 集成 `tauri-plugin-notification` 或 Rust 自定义插件，实现安卓下拉通知栏控制音乐。
    - ✅ 已接入 Web MediaSession：播放器状态/元数据/ActionHandler 已与现有 `usePlayerStore` 对齐。
    - ⚠️ 端上阻塞：Android 13 模拟器 WebView 基线（Chrome 109）不支持 `navigator.mediaSession` / `MediaMetadata`。
    - ✅ 已补齐原生能力（首版）：`AllMusicPlaybackService` + `androidx.media` + 前台通知通道已打通。
    - ⏳ 待补充验收：通知栏按钮“手工点击”链路确认。
- [ ] **4.2 后台播放保活**: 实现简单的 `Foreground Service` 逻辑，防止 App 挂起后音频中断。
    - ✅ 已实现基础保活：播放状态同步到前台服务后，切后台服务仍存活（`dumpsys activity services` 可见）。
    - ⏳ 待做稳定性压测：长时后台播放（>10 分钟）与系统回收场景。
- [ ] **4.3 物理返回键**: 拦截 Android Back 键，实现“双击退出”或“返回上级目录”逻辑。

---

## 3. 具体待办清单 (Immediate Todos)

### 基础设施 (Infrastructure)
- [x] 执行 `npm run android:check` 并修复环境变量报错。
- [x] 创建 `src/config/platform.config.ts` 管理多端 API 地址。
- [x] 新增 `scripts/run-android-tauri.cjs` 并在 `package.json` 注入 `android:tauri:*` 脚本，统一设置 ASCII Rust/Temp/SDK 环境，规避中文路径构建失败。

### API & 数据 (Data)
- [x] 在 API 入口层注入环境判断（`src/lib/api/endpoints.ts` -> `platform.config`；服务层改为动态读取）。
- [ ] 寻找或搭建一个轻量级的网易云 API 远程代理（用于安卓测试）。

### 交互 & UI (Interface)
- [x] 检查 `tailwind.config.js`，增加 `mobile` 断点。
- [x] 在 `src/App.tsx` 中注入全局 `is-mobile` 的 CSS Class。
- [x] 新增移动端底部 Tab 导航与播放详情全屏沉浸模式（待端上验收）。
- [x] 修复移动端顶部搜索浮层在窄宽下文本纵向挤压问题（模拟器端已复现并验证通过）。

---

## 4. 架构风险预警
1. **API 封禁**: 远程代理服务器如果请求过快，可能导致网易云/QQ 账号被封禁。
2. **内存占用**: 安卓 Webview 在低端机上可能会有性能瓶颈，需优化图片懒加载。
3. **Sidecar 缺失**: 必须明确：Android 版**不能**直接运行 `scripts/qmusic_adapter_server.py`，所有 Python 逻辑需在云端运行。
4. **Windows 路径编码风险**: 若 Rust/NDK/Temp 使用非 ASCII 路径，Android 链接阶段可能失败；需固定走 ASCII 路径脚本。
5. **WebView 能力差异**: 部分安卓 WebView 版本不支持 MediaSession，通知栏媒体控制必须准备原生兜底方案。
6. **生成目录维护风险**: `src-tauri/gen/android` 下的原生改动在重新 `android:init` 时可能被覆盖，需补一份迁移清单。

## 2026-02-24 收口验收补充（本次）

### 4.1 MediaSession / 通知栏控制链路
- [x] 已完成端上闭环验证（通过 MediaSession 回调触发 Web 播放状态变更）。
- [x] 已验证动作：
  - `KEYCODE_MEDIA_NEXT (87)` 后，`window.__ALLMUSIC_BRIDGE__.getPlayerState().currentIndex` 从 `0 -> 1`。
  - `KEYCODE_MEDIA_PREVIOUS (88)` 后，`currentIndex` 从 `1 -> 0`。
  - `KEYCODE_MEDIA_PAUSE (127)` / `KEYCODE_MEDIA_PLAY (126)` 后，`isPlaying` 在 `true/false` 间切换。
- [x] 已验证通知与会话存在：
  - `dumpsys notification --noredact` 可见 `id=16301`、`allmusic_playback_channel`、三枚动作（上一首/暂停/下一首）。
  - `cmd media_session list-sessions` 可见 `ALLMusicPlaybackSession`（`com.allmusic.app`）。

### 4.2 后台保活稳定性
- [x] 已完成 10+ 分钟后台保活验证（`610s`）。
- [x] 验证结论：
  - `dumpsys activity services com.allmusic.app` 仍显示 `AllMusicPlaybackService` 且 `isForeground=true foregroundId=16301`。
  - `dumpsys notification --noredact` 仍有 `id=16301` 活跃通知。
  - `cmd media_session list-sessions` 仍有 `ALLMusicPlaybackSession`。

### 4.3 物理返回键策略
- [x] 已实现原生返回键收口（`MainActivity`）：
  - 先向前端派发可取消事件 `allmusic:android-back-press`（用于关闭页面内浮层）。
  - 若前端未消费且 `window.history.length > 1`，执行 `history.back()`。
  - 否则进入“双击退出”策略（2 秒窗口）。
- [x] 前端已接入事件消费：
  - `src/pages/Home.tsx`：返回键优先关闭搜索下拉层。
  - `src/components/player/player-bar.tsx`：返回键优先关闭播放详情层/队列层。
- [x] 端上验收：
  - 第一次 `Back`：`mCurrentFocus` 保持 `com.allmusic.app/.MainActivity`。
  - 第二次 `Back`（2 秒内）：`mCurrentFocus` 切回 `com.google.android.apps.nexuslauncher/.NexusLauncherActivity`。
