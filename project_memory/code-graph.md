# 代码依赖图（初始化）

- `src/`：React 前端应用（页面、组件、hooks、stores）
- `src/services/`：业务服务层（鉴权、媒体库、播放器）
- `src/lib/`：基础能力（运行时、API、工具）
- `src-tauri/`：Tauri Rust 后端与平台集成
- `scripts/`：开发与服务编排脚本（API/端口/移动端）
- `public/` 与 `design/`：静态资源与视觉方案

## 2026-04-09（启动与登录依赖图更新）
- `src-tauri/src/services.rs` 负责发出 `local-api-progress`，其中 `netease_ready` / `qq_ready` 表示单服务端口已就绪，`ready` 表示两个本地服务都已通过当前启动检查。
- `src/hooks/useAppEventListeners.ts` 消费 `local-api-progress` 并维护 `localApiProgress`；只有收到共享 `ready` 事件时才会分发 `LOCAL_API_READY_EVENT` 与关闭启动遮罩。
- `src/App.tsx` 根据 `localApiProgress.serviceState` 推导 `localApiReady`，再传入 `src/pages/Login.tsx` 作为登录入口总开关。
- `src/services/auth.service.ts` 中网易云二维码登录链路为：`neteaseCreateQRCode` -> `neteaseCheckQRCode` -> `fetchNeteaseLoggedInUser` -> `/login/status` / `/user/account`。

## 2026-04-09（扫码登录与全局失效检测）
- `src/pages/Login.tsx` 现在只负责网易云/QQ 两个平台的二维码登录入口与本地二维码轮询，不再承载账号密码或 Cookie 登录分支。
- `src/bridge/api-implementation.ts` / `src/types/bridge.types.ts` 只继续向外暴露二维码登录与登录校验接口，旧主题无法再经由桥接层触发手机号或 Cookie 登录。
- `src/App.tsx` 成为全局登录有效性巡检入口：读取 `useAuthStore` 中的 `users + cookies`，调用 `authService.verifyLogin()`，并在失效时触发 `allmusic:auth-invalidated` 事件。
- `public/v4-glam/script.js` 通过监听父窗口 `postMessage` 的 `allmusic:auth-invalidated` 事件，将旧主题立即切回登录页并提示“请重新扫码登录”。

## 2026-04-09（复古车机播放器依赖图）
- `src/components/player/player-bar.tsx` 已收敛为复古车机展示层：直接读取 `usePlayerStore` 的 `currentSong / queue / currentTime / duration / volume / isMuted / error`。
- `src/components/player/player-bar.tsx` 通过 `useAudioPlayer()` 保持音频 side effects、生效 seek 与重试逻辑，不再自行处理歌词、队列或详情层状态。
- `src/index.css` 中新增的 `am-retro-player__*` 样式成为当前 React 主界面播放器的唯一视觉实现；`design/player.html` 只作为视觉参考，不直接参与运行时。
- `src/components/player/player-bar.tsx` 现已重新接入 `libraryService.loadSongLyrics()`：以 `currentSong + cookies` 拉取歌词，解析时间轴后仅映射到 VFD 两行滚动歌词，不恢复旧的歌词详情层。
- `src/components/player/player-bar.tsx` 现直接消费 `useSongLikeAction()`、`useSongLikeStore.resolveLiked()` 与 `usePlayerStore.setPlayMode()/toggleMute()`，把“喜欢 / 静音 / 4 种播放模式”收口到播放器中部功能键区。
- `src/components/player/player-bar.tsx` 新增本地 `lyricDisplayMode` 状态，并在 `DeckTransportControls -> DeckLyricModeKnob -> VfdLyricWindow` 之间贯通，用于控制 VFD 歌词区显示原文 / 中文 / 双语三种模式。
- `src/components/player/player-bar.tsx` 现在会分别解析 `lyricText` 与 `translatedLyricText`；双语档不再复用“当前句 + 下一句”逻辑，而是按当前播放时间同时取原文和翻译当前句。
- `src/stores/local-api-status.store.ts` 现在承接 `src/App.tsx` 同步下来的 `localApiProgress.serviceState`；`src/components/player/player-bar.tsx` 结合 `useAuthStore.users/cookies` 与该 store，在右下角渲染 QQ / 网易云连接拨动开关。

## 2026-04-10（设计稿导出依赖）
- `design/player_2.html` 是从运行时播放器导出的静态整理页：复用了 `src/components/player/player-bar.tsx` 的版面分段和交互语义，也复用了 `src/index.css` 中复古车机播放器的核心视觉规则。
- 后续如果继续调整复古车机播放器，应优先修改 React 运行时代码，再按需同步 `design/player_2.html`，避免设计稿重新漂移回旧 `design/player.html`。

## 2026-04-10（player_4 新 UI 运行时依赖）
- `src/App.tsx` 对 current UI 的渲染入口现在固定为 `src/components/retro/retro-shell.tsx`；本地 API 启动遮罩、桥接音频、登录失效巡检仍保留在 App 层。
- `src/components/retro/retro-shell.tsx` 内部维护三态视图：`deck` 通过 `src/components/player/player-bar.tsx` 展示当前播放；`library` 通过 `src/components/retro/retro-library-view.tsx` 承接歌单/搜索/每日/历史；`qrAuthOverlay` 通过 `src/components/retro/retro-auth-overlay.tsx` 承接平台扫码登录。
- `src/components/retro/retro-library-view.tsx` 直接消费 `src/hooks/useHomeData.ts` 和 `src/hooks/useHomeHandlers.ts` 暴露的现有数据/动作，不新增独立数据源；列表播放继续写回 `src/stores/player.store.ts`。
- `src/components/player/player-bar.tsx` 现在额外向 shell 暴露两个交互口：`onOpenLibrary` 用于 `EJECT` 切到资料库视图，`onTogglePlatform` 用于触发 QQ / NCM 拨杆的登录或登出。
- `src/components/retro/retro-auth-overlay.tsx` -> `src/services/auth.service.ts` -> `src/stores/auth.store.ts` 构成当前 UI 内扫码链路；扫码成功后的用户状态更新会反向驱动 `useHomeData` 的歌单/推荐加载。

## 2026-04-10（player_4 真正 1:1 运行时依赖）
- current UI 的真实展示链已经收敛为：`src/App.tsx` -> `src/components/retro/retro-shell.tsx` -> `src/components/retro/player4.css`。`design/player_4.html` 不直接运行，但其 DOM 分段与样式语言被逐段映射进上述两处。
- `src/components/retro/retro-shell.tsx` 现在直接承载三块运行时视图：`deck-view`、`playlist-view`、`osc-overlay`；旧 `src/components/retro/retro-library-view.tsx` 与 `src/components/retro/retro-auth-overlay.tsx` 已删除，不再保留并行渲染骨架。
- `deck-view` 读取 `src/stores/player.store.ts` 与 `src/hooks/useAudioPlayer.ts` 的真实播放器状态，并在 UI 层输出 `player_4` 的磁带仓、VFD、模式键、音量盘、表头进度条与平台摇臂开关。
- `playlist-view` 通过 `src/hooks/useHomeData.ts` 和 `src/hooks/useHomeHandlers.ts` 获取 6 盒磁带对应的数据与动作：
  - `mixed / qq-liked / netease-liked` 来自 `UnifiedPlaylist` + `playlistDetailSongs`
  - `daily` 来自 `dailySongs`
  - `search` 来自 `searchResults / searchHistory / searchSuggestions`
  - `history` 来自 `playerHistory`
- `osc-overlay` 由 `src/components/retro/retro-shell.tsx` 内部的 `Player4AuthOverlay` 承接，向下直接调用 `src/services/auth.service.ts`，成功后通过 `src/stores/auth.store.ts` 回写用户，再驱动 `useHomeData` 刷新资料源。
- `returnToDeckWithInsert()` 现在是 `playlist-view -> deck-view` 的统一返回通路；`Insert Deck` 按钮与“点歌即回 deck”都共用这条状态机和插带动画。
- `Player4AuthOverlay` 与 `useHomeData.loadPlaylists()/loadDailyRecommendations()` 现在形成一条显式同步链：登录成功后仍停留在 `sync` 波形态，待歌单和日推两个任务各自完成后点亮对应 LED，最后才进入 `success` 并关闭。
- `loadPlaylists()` / `loadDailyRecommendations()` 现在都会向上返回 `success` 标记，因此 `retro-shell` 不再靠固定延时判断扫码成功，而是根据真实资料同步结果驱动示波器状态机。
- `src/hooks/useAudioPlayer.ts` 现在除了驱动共享播放，还在单例音频元素上挂接了 `AnalyserNode`；`src/components/retro/retro-shell.tsx` 通过 `useAudioSpectrum()` 读取真实频谱柱状数据。
- `src/components/retro/retro-shell.tsx` 内部保留了两套频谱来源：`simulatedSpectrumLevels` 是旧循环动画，`useAudioSpectrum()` 是真实频谱；最终显示由 `spectrumMode`（`REAL / SIM`）切换决定。
- 歌词自动回落逻辑也收口在 `src/components/retro/retro-shell.tsx`：`libraryService.loadSongLyrics()` 返回后，shell 会根据原文/翻译可用性决定是否自动切换 `lyricDisplayMode`。
- `src/hooks/useAudioPlayer.ts` 的真实频谱链路现已固定为：共享 `HTMLAudioElement` 正常播放到系统输出；`useAudioSpectrum()` 通过 `captureStream() -> MediaStreamAudioSourceNode -> AnalyserNode` 旁路读取频谱数据，不再改写主播放链。
- `src/hooks/useAudioPlayer.ts` 现在按“当前 `audio.src` + `MediaStream.id`”双条件重建共享采样源：只要歌曲 URL 变化，即使浏览器复用了同一个 `MediaStream`，也会重新创建 `MediaStreamAudioSourceNode`，避免频谱继续挂在上一首。
- `src/hooks/useAudioPlayer.ts` 的 `useAudioSpectrum()` 现已向上返回 `bars[]`，每项包含 `level / peakLevel / tone`，而不是旧的纯 `levels[]`；REAL 频谱的分带、包络、峰值保持都在这个 hook 内完成。
- `src/hooks/useAudioPlayer.ts` 当前在 `bars[]` 生成前还会维护每频带的 `adaptiveFloor / adaptiveCeiling / previousNormalized`：先做本频带自适应归一化，再做低频顶部压缩和正向变化增强，最后才进入 attack/release 与 peak hold。
- `src/hooks/useAudioPlayer.ts` 现又补了一层 `remapSpectrumDisplayLevel()`：在生成最终段高前把底部低值区压缩、中段扩展、顶部保留少量冲顶区，直接改变“12 段里哪一段最敏感”。
- `src/hooks/useAudioPlayer.ts` 当前 release / gain / headroom / remap 已按“更高动态对比”重新调参：主体回落放慢到 `420ms`，而增益和映射更倾向把高潮推入上半区。
- `src/hooks/useAudioPlayer.ts` 的频谱核心现已进一步拆成三条内部子路径：`absoluteEnergy`（绝对响度）、`buildPcenValue()`（PCEN 式自动增益）和 `fluxEnergy`（相邻帧变化强度）。三者先混合成 `emphasized`，再进入动态窗口、display remap、attack/release 与 peak hold。
- `useAudioSpectrum()` 内部现在还维护 `pcenSmoothingRef / previousEnergyRef / fluxLevelsRef` 三组频带状态：前者记录每带近期平均能量，中者记录上一帧原始能量，后者给变化量单独做一层快起慢落包络。
- `src/hooks/useAudioPlayer.ts` 现在还负责判定 REAL 频谱是否可用：若 `captureStream()` 命中跨域安全限制，则把当前曲源标记为“不支持 REAL”，`src/components/retro/retro-shell.tsx` 会自动把右上角频谱模式退回 `SIM`。
- `src/services/player.service.ts` 对 QQ 曲源的播放地址已改为 `QQ_API_BASE_URL/song/stream?target=...` 本地代理流；`scripts/qmusic_adapter_server.py` 负责把这个本地端点透传到上游真实音频 URL，并把 `Range` 与音频响应头原样回送给前端。
- `src/components/retro/retro-shell.tsx` 的频谱区已改为消费 `SpectrumBar[]`，并把 `REAL / SIM` 统一渲染为 20 根分段柱体 + 峰值帽；柱体段还会根据与柱头的距离动态调整亮度/饱和度，形成亮头暗尾拖尾效果。`src/components/retro/player4.css` 则负责非均匀列宽、暗底荧光和 cap glow 样式。
- `src-tauri/src/desktop.rs` 的 Windows 缩略图链路现已收敛为“只更新 toolbar 按钮并转发按钮点击事件”；封面位图更新与 `WM_DWMSENDICONICTHUMBNAIL` 渲染链已移除，不再参与当前播放器运行时。

## 2026-04-11（歌单区叠放磁带依赖图）
- `src/components/retro/retro-shell.tsx` 的库视图状态当前拆成两层：顶层 `activeTape = liked-stack / daily-stack / search / history`，组内再分别维护 `likedSource` 与 `dailySource`，由它们共同派生当前标题、主题色、磁带前后层级和列表数据源。
- 喜欢组的数据仍来自 `src/hooks/useHomeData.ts` 暴露的 `playlists + playlistDetailSongs`，只是入口从三个独立磁带合并成一个叠放磁带；每日组继续复用 `useHomeData` 的 `dailySourceTab / activeDailySongs`，由 shell 同步本地 `dailySource` 到既有数据层。
- `src/components/retro/player4.css` 现在负责两类磁带样式：单盒磁带（搜索/历史）和叠放磁带（喜欢/每日）。叠放层级通过 `tape-stack-card + --stack-index` 控制，不额外引入新的业务组件。
- `src/hooks/useHomeHandlers.ts` 的 `handleScrollableWheel()` 现接受虚拟列表测得的 `itemHeight`，并结合 `WeakMap<HTMLElement, carry>` 做高精度滚动累计；`src/components/retro/retro-shell.tsx` 的 `VirtualTrackList` 负责把当前列表的行高传进去。
- `src/services/library.service.ts` 的网易云 liked 详情链路现在是：`resolveNeteaseUserId()` -> `resolveNeteaseLikedPlaylistId()` -> `resolveNeteaseLikedOrderedIds()` -> `fetchNeteaseSongsByIds()`；若仍需回退，则 `/playlist/track/all` / `/playlist/detail` 统一使用重新解析后的 liked playlist id。

## 2026-04-13（桌面开发启动链路）
- `src-tauri/tauri.conf.json` 的 `build.beforeDevCommand` 会在桌面开发时拉起 `npm run dev`，随后由 `build.devUrl` 轮询 `http://localhost:1420` 判断前端是否 ready。
- `vite.config.ts` 的 `server.host/port/strictPort` 因此属于桌面开发链路的一部分，而不只是普通 Web 开发配置；只要 host 绑定不稳定，Tauri 就会一直停在 `Waiting for your frontend dev server`。
