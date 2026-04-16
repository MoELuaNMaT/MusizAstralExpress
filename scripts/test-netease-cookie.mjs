/**
 * 网易云 cookie & API 诊断脚本
 *
 * 用法：
 *   node scripts/test-netease-cookie.mjs
 *
 * 从 localStorage 中读取网易云 cookie，依次测试：
 *   1. 打印清洗前后的 cookie 内容（所有 name=value 对）
 *   2. 调用 /user/account 验证认证状态
 *   3. 调用 /likelist 验证喜欢列表
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ── 从 Tauri localStorage 或 app data 读取 cookie ──────────────────────
// Tauri v1 在以下位置存储 webview 数据：
//   Windows: %APPDATA%/<bundle-identifier>/
// 尝试读取 localStorage 中的 auth 数据

const SET_COOKIE_ATTRS = new Set([
  'max-age', 'expires', 'path', 'domain', 'httponly', 'secure',
  'samesite', 'comment', 'version', 'priority', 'partitioned',
]);

function cleanCookieString(raw) {
  return raw
    .split(/;\s*/)
    .map((part) => part.trim())
    .filter((part) => {
      if (!part) return false;
      if (!part.includes('=')) return !SET_COOKIE_ATTRS.has(part.toLowerCase());
      const name = part.split('=')[0].trim().toLowerCase();
      return !SET_COOKIE_ATTRS.has(name);
    })
    .join('; ');
}

function parseCookiePairs(cookieStr) {
  const pairs = {};
  cookieStr.split(/;\s*/).forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx < 1) return;
    const name = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (!SET_COOKIE_ATTRS.has(name.toLowerCase())) {
      pairs[name] = value;
    }
  });
  return pairs;
}

// ── 尝试从用户输入获取 cookie ──────────────────────────────────────────
// 用户可以从浏览器 DevTools > Application > Local Storage 复制 cookie
// 或者从日志中的 cookiePreview 拼接

console.log('=== 网易云 Cookie & API 诊断 ===\n');

// 尝试从 stdin 读取 cookie
const args = process.argv.slice(2);
let cookie = '';

if (args.length > 0 && args[0] === '--cookie') {
  cookie = args.slice(1).join(' ');
} else {
  // 尝试从项目的 Tauri 数据目录读取
  const appDataDir = process.env.APPDATA || '';
  const possiblePaths = [
    join(appDataDir, 'com.allmusic.app', 'LocalStorage', 'leveldb'),
  ];

  console.log('提示：请从浏览器 DevTools Console 中运行以下命令获取 cookie：');
  console.log('  JSON.parse(localStorage.getItem("auth-storage")).state.cookies.netease');
  console.log('\n然后运行：');
  console.log('  node scripts/test-netease-cookie.mjs --cookie "你的cookie字符串"');
  console.log('\n或者直接粘贴 cookie 字符串：');

  // 从 stdin 读取
  const chunks = [];
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => chunks.push(chunk));
  process.stdin.on('end', async () => {
    cookie = chunks.join('').trim();
    if (cookie) {
      await runDiagnostics(cookie);
    }
  });

  // 如果有 stdin 且是 TTY，等待用户输入
  if (process.stdin.isTTY) {
    console.log('(等待粘贴后按 Ctrl+D 或 Ctrl+C 退出)\n');
    // 设置超时
    setTimeout(() => {
      if (!cookie) {
        console.log('超时，退出。');
        process.exit(0);
      }
    }, 60000);
  }
  process.stdin.resume();
}

if (cookie) {
  runDiagnostics(cookie);
}

async function runDiagnostics(rawCookie) {
  console.log('\n── 1. Cookie 基本信息 ──────────────────────────');
  console.log(`原始长度: ${rawCookie.length} 字符`);

  const cleaned = cleanCookieString(rawCookie);
  console.log(`清洗后长度: ${cleaned.length} 字符`);

  const pairs = parseCookiePairs(cleaned);
  const pairNames = Object.keys(pairs);
  console.log(`\nCookie 名称列表 (${pairNames.length} 个):`);
  pairNames.forEach((name) => {
    const value = pairs[name];
    const preview = value.length > 40 ? `${value.slice(0, 40)}...` : value;
    console.log(`  ${name} = ${preview}`);
  });

  const hasMusicU = 'MUSIC_U' in pairs;
  const hasMusicA = 'MUSIC_A' in pairs;
  const hasCsrf = '__csrf' in pairs;
  console.log(`\n关键字段:`);
  console.log(`  MUSIC_U: ${hasMusicU ? '✓ 存在' : '✗ 缺失'}`);
  console.log(`  MUSIC_A: ${hasMusicA ? '✓ 存在' : '✗ 缺失'}`);
  console.log(`  __csrf:  ${hasCsrf ? '✓ 存在' : '✗ 缺失'}`);

  // ── 测试 API ─────────────────────────────────────────────
  const baseUrl = 'http://localhost:3000';

  console.log('\n── 2. 测试 /user/account (完整 cookie) ──────');
  try {
    const url = `${baseUrl}/user/account?timestamp=${Date.now()}`;
    const resp = await fetch(url, {
      headers: { Cookie: cleaned },
    });
    const data = await resp.json();
    console.log(`  状态: ${resp.status}`);
    console.log(`  code: ${data.code}`);
    console.log(`  profile.userId: ${data.profile?.userId ?? 'undefined'}`);
    console.log(`  account.id: ${data.account?.id ?? 'undefined'}`);
    console.log(`  account.anonimousUser: ${data.account?.anonimousUser ?? 'undefined'}`);
    if (data.profile && Object.keys(data.profile).length > 0) {
      console.log(`  profile keys: ${Object.keys(data.profile).join(', ')}`);
      console.log(`  nickname: ${data.profile.nickname ?? 'N/A'}`);
    } else {
      console.log(`  profile: {} (空)`);
    }
  } catch (err) {
    console.log(`  错误: ${err.message}`);
  }

  // 测试仅用 MUSIC_U
  if (hasMusicU) {
    console.log('\n── 3. 测试 /user/account (仅 MUSIC_U) ───────');
    try {
      const url = `${baseUrl}/user/account?timestamp=${Date.now()}`;
      const resp = await fetch(url, {
        headers: { Cookie: `MUSIC_U=${pairs.MUSIC_U}` },
      });
      const data = await resp.json();
      console.log(`  状态: ${resp.status}`);
      console.log(`  code: ${data.code}`);
      console.log(`  profile.userId: ${data.profile?.userId ?? 'undefined'}`);
      console.log(`  account.anonimousUser: ${data.account?.anonimousUser ?? 'undefined'}`);
      if (data.profile && Object.keys(data.profile).length > 0) {
        console.log(`  ✓ 仅 MUSIC_U 即可认证成功！`);
      } else {
        console.log(`  ✗ MUSIC_U 认证失败，token 可能已失效`);
      }
    } catch (err) {
      console.log(`  错误: ${err.message}`);
    }
  }

  // 测试 /likelist
  const userId = pairs.MUSIC_U ? 'from_account' : 'unknown';
  console.log('\n── 4. 测试 /login/status ─────────────────────');
  try {
    const url = `${baseUrl}/login/status?timestamp=${Date.now()}`;
    const resp = await fetch(url, {
      headers: { Cookie: cleaned },
    });
    const data = await resp.json();
    console.log(`  code: ${data.data?.code ?? data.code}`);
    console.log(`  profile.userId: ${data.data?.profile?.userId ?? 'undefined'}`);
    console.log(`  account.anonimousUser: ${data.data?.account?.anonimousUser ?? 'undefined'}`);
  } catch (err) {
    console.log(`  错误: ${err.message}`);
  }

  console.log('\n── 诊断完成 ──────────────────────────────────');
  process.exit(0);
}
