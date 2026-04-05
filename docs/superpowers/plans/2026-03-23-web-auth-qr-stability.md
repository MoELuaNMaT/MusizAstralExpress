# Web 扫码登录稳定性修复 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Web 模式扫码登录与校验稳定，并保证刷新后仍保持登录，同时不改变 Tauri 端现有行为。

**Architecture:** 在 `auth.service.ts` 内做 Web/Tauri 分流：Web 模式不再依赖 `Cookie` 请求头，网易云走 `cookie` 查询参数、QQ 走 `Authorization/token`。仅 Web 解析 `Set-Cookie` 为可复用 Cookie 串。`auth.store.ts` 改为 UTF‑8 安全的本地持久化编码，保证刷新后状态可恢复。

**Tech Stack:** Tauri 2.x, React 19, Vite, TypeScript

---

## File Structure / Responsibilities
- `src/services/auth.service.ts`
  - 登录/校验请求构建与凭证保存逻辑；新增 Web/Tauri 分流、Set‑Cookie 解析。
- `src/stores/auth.store.ts`
  - Web 本地凭证持久化；改为 UTF‑8 安全 base64 编码。

---

### Task 1: Web 模式的 NetEase 请求分流与 Cookie 传参

**Files:**
- Modify: `src/services/auth.service.ts`

- [ ] **Step 1: 添加 Web/Tauri 运行时判断与 cookie 注入 helper**

```ts
import { canUseTauriInvoke } from '@/lib/runtime';

private isTauriRuntime(): boolean {
  return canUseTauriInvoke();
}

private appendNeteaseCookie(endpoint: string, cookie?: string | null): string {
  if (this.isTauriRuntime() || !cookie?.trim()) {
    return endpoint;
  }
  const separator = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${separator}cookie=${encodeURIComponent(cookie.trim())}`;
}
```

- [ ] **Step 2: 调整 NetEase `request`，Web 模式不写 Cookie 头**

```ts
const resolvedEndpoint = this.appendNeteaseCookie(endpoint, this.sessionCookie);
const response = await fetch(`${neteaseApiBase}${resolvedEndpoint}`, {
  ...options,
  headers: {
    'Content-Type': 'application/json',
    ...(this.isTauriRuntime() && this.sessionCookie ? { Cookie: this.sessionCookie } : {}),
    ...options.headers as Record<string, string>,
  },
});
```

- [ ] **Step 3: 在 `verifyLogin` / `renewLogin` / `getUserInfo` / `logout` 使用 helper**

```ts
const endpoint = this.appendNeteaseCookie('/login/status', cookie);
const response = await fetch(`${this.getNeteaseApiBase()}${endpoint}`, {
  headers: this.isTauriRuntime() ? { Cookie: cookie } : undefined,
  cache: 'no-store',
});
```

- [ ] **Step 4: 手工校验（Web）**

Run: `npm run dev`
Expected: 扫码登录完成后，能够成功调用登录校验接口（无“无法连接/凭证失效”误报）。

- [ ] **Step 5: Commit**

```bash
git add src/services/auth.service.ts
git commit -m "fix(auth): route netease cookie via query in web"
```

---

### Task 2: Web 模式的 QQ 认证头与 Set‑Cookie 解析

**Files:**
- Modify: `src/services/auth.service.ts`

- [ ] **Step 1: 添加 Set‑Cookie 解析 helper（仅 Web 使用）**

```ts
private normalizeSetCookieHeader(header: string): string {
  // Split Set-Cookie safely, keeping expires commas intact.
  const parts: string[] = [];
  let current = '';
  let inExpires = false;
  for (let i = 0; i < header.length; i += 1) {
    const ch = header[i];
    const slice = header.slice(i).toLowerCase();
    if (!inExpires && slice.startsWith('expires=')) {
      inExpires = true;
    }
    if (inExpires && ch === ';') {
      inExpires = false;
    }
    if (ch === ',' && !inExpires) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current);

  const cookies = parts
    .map((part) => part.split(';')[0].trim())
    .filter((part) => part.includes('='));

  return cookies.join('; ');
}
```

- [ ] **Step 2: QQ 请求头在 Web 改用 Authorization/token**

```ts
const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  ...options.headers as Record<string, string>,
};

if (this.qqSessionCookie) {
  if (this.isTauriRuntime()) {
    headers.Cookie = this.qqSessionCookie;
  } else {
    const bearer = `Bearer ${this.qqSessionCookie}`;
    headers.Authorization = bearer;
    headers.token = bearer;
  }
}
```

- [ ] **Step 3: Web 模式解析 Set‑Cookie**

```ts
if (setCookieHeader) {
  this.qqSessionCookie = this.isTauriRuntime()
    ? setCookieHeader
    : this.normalizeSetCookieHeader(setCookieHeader);
}
```

- [ ] **Step 4: 手工校验（Web）**

Run: `npm run dev`
Expected: QQ 扫码登录成功后，可正确校验登录状态。

- [ ] **Step 5: Commit**

```bash
git add src/services/auth.service.ts
git commit -m "fix(auth): use bearer header for qq in web"
```

---

### Task 3: Web 登录持久化编码（UTF‑8 安全）

**Files:**
- Modify: `src/stores/auth.store.ts`

- [ ] **Step 1: 增加 UTF‑8 base64 编解码 helper**

```ts
function encodeUtf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary);
}

function decodeBase64ToUtf8(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
```

- [ ] **Step 2: 替换 `btoa/atob` 调用**

```ts
json = xorObfuscate(decodeBase64ToUtf8(raw), OBFUSCATION_KEY);
...
localStorage.setItem(AUTH_FALLBACK_STORAGE_KEY, encodeUtf8ToBase64(xorObfuscate(json, OBFUSCATION_KEY)));
```

- [ ] **Step 3: 兼容旧格式回退**

保留原有 try/catch 回退到 plain JSON，避免旧数据无法读取。

- [ ] **Step 4: 手工校验（Web）**

Run: `npm run dev`
Expected: 扫码登录后刷新页面仍保持登录状态，无 localStorage 解码错误。

- [ ] **Step 5: Commit**

```bash
git add src/stores/auth.store.ts
git commit -m "fix(auth): utf8-safe auth storage encoding"
```

---

### Task 4: 最小回归验证

**Files:**
- None (manual)

- [ ] **Step 1: Web 模式扫码登录 + 刷新验证**

Run: `npm run dev`
Expected: 登录成功 → 刷新后仍保持登录；`verifyLogin` 返回稳定。

- [ ] **Step 2: Tauri 模式回归一次**

Run: `npm run tauri:dev`
Expected: 行为与当前一致（登录/校验/播放不受影响）。

- [ ] **Step 3: 记录结果**

在变更说明中写明是否执行了本地回归。

---

## Notes
- Web 模式不依赖 `Cookie` 请求头（浏览器限制）。
- 所有改动遵循最小改动与 fail‑fast。
