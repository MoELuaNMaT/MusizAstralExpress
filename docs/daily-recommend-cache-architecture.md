# 每日推荐歌单智能缓存（方案 A）架构与实施说明

## 1. 后端/数据层架构设计

### 数据结构

- 存储介质：`localStorage`
- 主存储 Key：`allmusic_daily_recommend_cache_v1`
- 值结构：
  - `Record<string, DailyRecommendCacheData>`
  - `DailyRecommendCacheData`：
    - `songs: UnifiedSong[]`
    - `warnings: string[]`
    - `cacheDate: string`（`YYYY-MM-DD`，本地时区）
    - `updatedAt: number`（毫秒时间戳）

### 缓存 Key 设计

- 复合 Key：`${scopeFingerprint}:${dateKey}`
- `scopeFingerprint` 由以下字段构成并进行哈希：
  - `neteaseUserId`
  - `qqUserId`
  - `hash(neteaseCookie)`
  - `hash(qqCookie)`
- 设计目标：
  - 避免跨账号缓存串用
  - 同一账号当日缓存可直接命中
  - 日期切换后天然失效

### API 接口（Hook 层调用约定）

- `readDailyRecommendCache(scope, dateKey?) => DailyRecommendCacheData | null`
- `writeDailyRecommendCache(scope, { songs, warnings }, dateKey?) => void`
- `clearStaleDailyRecommendCache(dateKey?) => void`
- `getLocalDateKey(date?) => string`
- `loadDailyRecommendations(options?: { forceRefresh?: boolean })`
  - `forceRefresh = false`：缓存优先
  - `forceRefresh = true`：跳过缓存，强制网络拉取并回写缓存

## 2. 详细实施步骤

### 文件清单

- 新增：`src/lib/db/daily-recommend-cache.ts`
- 修改：`src/hooks/useHomeData.ts`
- 修改：`src/hooks/useHomeHandlers.ts`

### 代码改动点

1. 新增每日推荐缓存模块
   - 复用现有 `playlist-detail-cache` 风格：`localStorage + updatedAt + 容错读写`
   - 增加按日期清理逻辑（仅保留当天缓存）

2. 改造 `loadDailyRecommendations`
   - 增加 `forceRefresh` 参数
   - 默认缓存优先：命中即返回，不触发网络请求
   - 未命中或强刷：走网络并回写缓存

3. 保持手动刷新语义
   - `handleRefreshDaily` 改为 `loadDailyRecommendations({ forceRefresh: true })`
   - 全局刷新 `handleRefresh` 触发 `refreshCurrentView({ includeDailyForceRefresh: true })`

4. 增加跨日自动刷新
   - 在 `useHomeData` 内新增日期轮询 effect（每 60 秒）
   - 检测日期变化后：
     - 清理旧日期缓存
     - 触发 `loadDailyRecommendations({ forceRefresh: true })`

## 3. 测试策略

### 单元测试（建议）

- `daily-recommend-cache.ts`
  - 读写正常路径
  - 非法 JSON 容错
  - `cacheDate` 不一致时失效
  - `scope` 变化导致 Key 变化
  - 超限淘汰与仅保留当天策略

### 集成测试（建议）

- `useHomeData`：
  - 启动首次加载写缓存
  - 同日二次加载命中缓存且不发起网络请求
  - `forceRefresh` 必走网络
  - 跨日检测后自动刷新
  - 手动刷新功能不退化

### 回归测试（建议）

- 播放器播放队列与每日推荐列表联动
- 点赞状态覆盖（`patchSongLikeInHomeState`）不受缓存引入影响
- 本地 API ready 事件触发时行为正常

## 4. 回滚方案

1. 回滚入口：撤销 `useHomeData.ts` 与 `useHomeHandlers.ts` 对缓存模块的调用。
2. 保留策略：可保留 `daily-recommend-cache.ts` 文件但不再引用，不影响运行时。
3. 数据清理：必要时执行 `clearAllDailyRecommendCache()` 或手动删除 `allmusic_daily_recommend_cache_v1`。
4. 风险隔离：回滚后逻辑恢复为"每次网络请求"，不影响现有播放器与手动刷新链路。
