# ALLMusic UI/UX 重构交接说明文档 (V8/V9)

## 0. 项目背景与目标
本项目旨在为 ALLMusic 提供两套极具视觉冲击力且差异化明显的 UI 主题。重构需保持现有网易云/QQ 音乐双平台聚合功能不变，通过切换 CSS 变量或条件渲染组件来实现主题切换。

*   **当前逻辑入口：** `src/pages/Home.tsx`, `src/pages/Login.tsx`, `src/App.tsx`
*   **核心状态：** `useAuthStore` (登录), `usePlayerStore` (播放状态), `useAudioPlayer` (播放控制)
*   **设计资源：** 参考 `design/v8-full/` 和 `design/v9-details/` 下的 HTML/CSS 实现。

---

## 1. 主题 A：Claymorphism (云端拟态)
**视觉核心：** 柔软、解压、3D 充气感、马卡龙色彩。

### 1.1 视觉规范 (Visual Specs)
*   **色彩体系：**
    *   背景色: `#f0f3ff`
    *   主色调: `#6366f1` (Indigo) / `#ec4899` (Pink)
    *   文本色: `#475569` (Slate-600)
*   **核心阴影 (The "Clay" Magic):**
    *   外阴影: `16px 16px 32px #d1d9e6, -16px -16px 32px #ffffff`
    *   内阴影: `inset 4px 4px 8px rgba(255,255,255,0.6), inset -4px -4px 8px rgba(0,0,0,0.05)`
*   **字体：** `Nunito`, sans-serif (800/900 Weight 用于标题)。

### 1.2 关键组件重构建议
*   **Sidebar:** 采用 40% 不透明度的白色背景，配合 `backdrop-filter: blur(20px)`。
*   **SongRow:** 悬停时从扁平状态通过 `transform: translateY(-2px)` 和增加外阴影转变为“浮起”状态。
*   **Immersive Detail:** 封面图需配合 `animation: rotate-breath 20s linear infinite` 实现呼吸旋转感。

---

## 2. 主题 B：Fallout Skeuomorphism (辐射拟物)
**视觉核心：** 废土生存、战前工业终端、磷光显示、CRT 质感。

### 2.1 视觉规范 (Visual Specs)
*   **色彩体系：**
    *   背景色: `#0c120c` (深绿黑)
    *   主显示色: `#18ff62` (磷光绿)
    *   边框色: `#2a3a2a` (军绿色金属)
*   **特殊效果：**
    *   **CRT Overlay:** 必须在顶层添加扫描线 (Scanlines) 和微弱的闪烁 (Flicker) 动画（参考 `fallout-detail.html` 的 CSS）。
    *   **磷光发光:** 所有文本和图标需带 `text-shadow: 0 0 10px var(--pip-green)`。
*   **字体：** `VT323` (Monospace)。

### 2.2 关键组件重构建议
*   **Terminal Layout:** 所有容器使用 `border: 4px solid #333` 并带有内部阴影。
*   **Interactive Controls:** 按钮设计为 `[[ 战术括号 ]]` 样式。进度条采用方块堆叠感，而非平滑线条。
*   **Lyrics:** 以系统日志流 (Log Stream) 形式呈现，每行前缀时间戳，模拟数据解密过程。

---

## 3. 功能对接说明 (Logic Mapping)

Codex 在接入时应注意以下数据映射：

1.  **平台标识 (Platform Identity):**
    *   网易云: Clay 模式使用红色圆点；Fallout 模式使用 `NODE:NETEASE` 文本。
    *   QQ 音乐: Clay 模式使用绿色圆点；Fallout 模式使用 `NODE:QQ_MUSIC` 文本。
2.  **播放控制回调:**
    *   `▶` 按钮统一调用 `usePlayerStore.togglePlay()` 或 `handlePlaySong()`。
    *   进度条拖动通过 `useAudioPlayer.seekTo()` 实现。
3.  **沉浸式切换:**
    *   在 `Home.tsx` 中新增 `isImmersive` 状态。当用户点击底部播放栏封面时，全屏覆盖显示 `ImmersiveDetail` 组件。
4.  **主题切换逻辑:**
    *   在 `App.tsx` 或全局 Store 中添加 `themeMode: 'clay' | 'fallout'`。
    *   通过给 `document.body` 添加对应的类名（如 `.theme-clay` 或 `.theme-fallout`）来分发 CSS 变量。

---

## 4. 交付文件清单 (File Manifest)

请 Codex 重点参考以下已生成的文件获取代码：

*   **Claymorphism:**
    *   主界面/列表: `design/v8-full/claymorphism-full.html`
    *   沉浸详情: `design/v9-details/claymorphism-detail.html`
*   **Fallout Skeuo:**
    *   主界面/列表: `design/v8-full/fallout-skeuo-full.html`
    *   沉浸详情: `design/v9-details/fallout-detail.html`

## 5. Codex 执行建议 (Action Plan)

1.  **第一步 (CSS Variables):** 在 `src/index.css` 中根据两种风格定义两套根变量。
2.  **第二步 (Component Refactor):** 优先重构 `PlayerBar` 和 `SongListRow`，因为它们是交互频次最高的部分。
3.  **第三步 (View Switching):** 实现从 `Home.tsx` 的列表视图平滑过渡到 `ImmersiveDetail` 的动画效果。
4.  **第四步 (Assets):** 确保引入 `Nunito` 和 `VT323` 字体。

---
