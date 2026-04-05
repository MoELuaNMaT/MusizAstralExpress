# 混合歌单按加入时间排序实现计划

本计划旨在利用网易云音乐和 QQ 音乐歌曲加入歌单的原始时间戳，实现混合歌单的精确时间线排序功能。

## 📋 实施计划 (Plan)

### 1. 核心思路
统一使用 `addedAt`（毫秒时间戳）作为歌曲在歌单中的加入时间字段。
- **网易云**：从 `playlist.trackIds` 的 `at` 字段提取。
- **QQ 音乐**：从适配器返回的 `join_time` 字段提取。
- **混合逻辑**：在 `LibraryService` 中，若用户选择“按时间排序”，则将双平台歌曲汇总后按 `addedAt` 降序排列。

### 2. 技术变更点
- **数据结构**：更新 `UnifiedSong` 类型，增加 `addedAt?: number`。
- **后端适配器**：修改 Python 适配器以透传 `join_time`。
- **业务逻辑**：修改 `LibraryService` 提取时间戳，并增加排序算法。
- **状态管理**：在 `usePlaylistStore` 中记录用户的排序偏好。
- **UI 组件**：在歌单详情页添加排序切换模式按钮。

---

## ✅ 任务清单 (Todos)

### 第一阶段：后端与基础定义 (Data & Types)
- [ ] **Python 适配器更新**：修改 `scripts/qmusic_adapter_server.py` 中的 `_normalize_song` 函数，添加 `addedAt: raw.get('join_time') * 1000`。
- [ ] **类型定义更新**：在 `src/types/index.ts` 中为 `UnifiedSong` 接口添加 `addedAt?: number` 属性。

### 第二阶段：数据抓取层 (Service Logic)
- [ ] **网易云详情增强**：
  - 修改 `library.service.ts` 中的 `fetchNeteasePlaylistDetail`。
  - 从 `/playlist/detail` 获取 `trackIds` 映射，并将其中的 `at` 注入到歌曲对象中。
- [ ] **QQ 音乐详情增强**：
  - 确保 `mapQQSong` 正确映射来自适配器的 `addedAt` 字段。
- [ ] **混合歌单算法更新**：
  - 在 `LibraryService` 中增加 `sortByAddedAt` 辅助函数。
  - 修改 `fetchMergedLikedPlaylistDetail`，根据传入的排序模式决定使用 `interleaveSongs` 还是 `sortByAddedAt`。

### 第三阶段：状态与控制 (State Management)
- [ ] **Store 更新**：
  - 在 `src/stores/playlist.store.ts` 中增加 `mergedSortMode: 'interleave' | 'addedAt'` 状态及其控制方法。

### 第四阶段：UI 交互 (User Interface)
- [ ] **排序切换按钮**：
  - 在歌单头部工具栏添加切换按钮（智能混合 vs 最近加入）。
- [ ] **功能验证**：
  - 验证切换模式后，混合歌单的列表渲染顺序是否实时更新。
