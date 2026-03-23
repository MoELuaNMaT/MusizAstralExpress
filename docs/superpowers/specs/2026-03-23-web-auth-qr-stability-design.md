# Web 扫码登录稳定性修复设计

日期：2026-03-23

## 背景
Web 模式下登录/校验存在不稳定：浏览器禁止手动设置 `Cookie` 请求头；`Set-Cookie` 直接复用会生成非法 Cookie 串；本地持久化使用 `btoa/atob` 在非 ASCII 场景下可能抛错，导致刷新后丢失登录。Tauri 端已可用且需保持行为不变。

## 目标与成功标准
- Web 模式扫码登录稳定可用（网易云 + QQ）。
- Web 模式刷新页面后登录状态仍保持。
- Tauri 行为保持不变（不改现有流程与持久化行为）。

## 非目标
- 不新增手机号/邮箱/手动 Cookie 登录方式。
- 不引入 Service Worker/代理层等复杂方案。
- 不调整已有 UI 或业务流程。

## 约束与原则
- 遵循最小改动与 fail-fast。
- Web 模式不依赖 `Cookie` 请求头。
- 仅在 Web 模式启用新的 Cookie 解析与持久化逻辑。

## 设计概述
### 运行时分流
在 `auth.service.ts` 内依据 `canUseTauriInvoke()` 分流：
- **Tauri 路径**：保持现状（Cookie 头/当前逻辑）。
- **Web 路径**：
  - 网易云：统一使用 `?cookie=` 查询参数。
  - QQ：统一使用 `Authorization`/`token` 头（Bearer）。

### Set-Cookie 解析（仅 Web）
新增轻量解析方法：仅提取 `name=value`，忽略属性（`Path`/`Max-Age`/`SameSite` 等），拼成可复用 Cookie 串。仅在 Web 模式使用，避免改变 Tauri 行为。

### 刷新持久化
`auth.store.ts` 改为 UTF-8 安全编码（使用 `TextEncoder` + base64 或 `encodeURIComponent` 方案），保证 `localStorage` 存取不因非 ASCII Cookie 抛错。

## 关键数据流（Web）
1. 扫码登录成功 → 从响应体或解析后的 Cookie 串得到凭证。
2. 写入 auth store → 通过安全编码持久化。
3. 刷新页面 → 读取持久化 Cookie → 进行 `verifyLogin` 校验。

## 错误处理
- Web 模式解析不到有效 Cookie：直接失败并提示“登录凭证获取失败”。
- 校验失败：提示“本地 API 未启动或凭证失效”。
- 持久化失败：显式错误，提示重新登录。

## 测试策略（最小集）
1. Web 模式扫码登录成功后刷新页面，登录状态保持。
2. Web 模式 `verifyLogin` 返回稳定结果（网易云、QQ 各一次）。
3. Tauri 模式回归一次登录流程（行为不变）。

## 影响范围
- `src/services/auth.service.ts`：增加 Web/Tauri 分流与 Cookie 解析。
- `src/stores/auth.store.ts`：调整本地持久化编码方式（仅 Web 影响）。

## 风险与回滚
- 风险：Web 模式下某些 API 返回格式不统一，Cookie 解析可能不足。
- 回滚：撤销 Web 分流与解析函数，恢复原逻辑。

## 变更清单（计划）
- 新增：Web 模式 Cookie 解析辅助函数（可能内置于 `auth.service.ts`）。
- 修改：`auth.service.ts` 请求构建逻辑（Web 分流）。
- 修改：`auth.store.ts` 本地持久化编码。
