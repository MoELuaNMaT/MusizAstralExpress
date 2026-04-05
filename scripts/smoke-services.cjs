#!/usr/bin/env node

/**
 * Minimal smoke runner for local services.
 *
 * Coverage:
 * 1) Login status endpoint (NetEase)
 * 2) Playlist endpoint contract (NetEase)
 * 3) Search endpoint contract (QQ adapter)
 */

const { spawn, spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NETEASE_BASE = process.env.NETEASE_API_BASE || 'http://127.0.0.1:3000';
const QQ_BASE = process.env.QQ_API_BASE || 'http://127.0.0.1:3001';
const NETEASE_SMOKE_UID = process.env.NETEASE_SMOKE_UID || '32953014';
const SHOULD_START = process.env.SMOKE_SKIP_START !== '1';
const ALLOW_QQ_INSTALL = process.env.SMOKE_ALLOW_QQ_INSTALL === '1';
const READY_TIMEOUT_MS = Number(process.env.SMOKE_READY_TIMEOUT_MS || 120000);
const RETRY_DELAY_MS = 800;

if (typeof fetch !== 'function') {
  console.error('[Smoke] Node.js 18+ is required (global fetch is missing).');
  process.exit(1);
}

const children = [];
let isStoppingChildren = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createLogger(prefix, stream) {
  return (chunk) => {
    const text = chunk.toString();
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      stream.write(`[${prefix}] ${line}\n`);
    }
  };
}

function runNpmScript(scriptName, extraEnv = {}) {
  const command = process.platform === 'win32' ? (process.env.comspec || 'cmd.exe') : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm run ${scriptName}`]
    : ['run', scriptName];

  const child = spawn(command, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      ...extraEnv,
    },
    shell: false,
    windowsHide: true,
  });

  child.stdout.on('data', createLogger(scriptName, process.stdout));
  child.stderr.on('data', createLogger(`${scriptName}:err`, process.stderr));
  child.on('exit', (code) => {
    if (code !== 0 && !isStoppingChildren) {
      process.stderr.write(`[${scriptName}] exited with code ${code}\n`);
    }
  });

  children.push({ scriptName, child });
  return child;
}

async function waitForEndpoint(url, validate) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < READY_TIMEOUT_MS) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const body = await response.json().catch(() => null);
      if (validate(response, body)) {
        return;
      }
    } catch {
      // ignore and retry
    }
    await sleep(RETRY_DELAY_MS);
  }

  throw new Error(`Timeout waiting for endpoint: ${url}`);
}

async function runTest(name, fn) {
  try {
    await fn();
    return { name, ok: true };
  } catch (error) {
    return {
      name,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchJson(url, init) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
  });

  const body = await response.json().catch(() => null);
  if (!response.ok && !body) {
    throw new Error(`HTTP ${response.status} without JSON payload`);
  }
  return { response, body };
}

function ensureObject(value, label) {
  if (!value || typeof value !== 'object') {
    throw new Error(`${label} is not a JSON object`);
  }
}

async function checkEndpointOnce(url, validate) {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    const body = await response.json().catch(() => null);
    return validate(response, body);
  } catch {
    return false;
  }
}

async function areServicesReady() {
  const neteaseReady = await checkEndpointOnce(`${NETEASE_BASE}/login/status`, (response, body) => {
    return response.ok && body && typeof body === 'object';
  });

  const qqReady = await checkEndpointOnce(`${QQ_BASE}/health`, (response, body) => {
    return response.ok && body && typeof body === 'object';
  });

  return neteaseReady && qqReady;
}

async function ensureServicesReady() {
  await waitForEndpoint(`${NETEASE_BASE}/login/status`, (response, body) => {
    return response.ok && body && typeof body === 'object';
  });

  await waitForEndpoint(`${QQ_BASE}/health`, (response, body) => {
    return response.ok && body && typeof body === 'object';
  });
}

function killChildTree(child, force = false) {
  if (!child || child.exitCode !== null || !child.pid) {
    return;
  }

  try {
    if (process.platform === 'win32') {
      const args = ['/PID', String(child.pid), '/T'];
      if (force) {
        args.push('/F');
      }
      spawnSync('taskkill', args, { stdio: 'ignore', windowsHide: true });
      return;
    }

    child.kill(force ? 'SIGKILL' : 'SIGTERM');
  } catch {
    // ignore
  }
}

function waitChildClose(child, timeoutMs = 5000) {
  if (!child || child.exitCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(false);
      }
    }, timeoutMs);

    const onClose = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(true);
      }
    };

    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('close', onClose);
    };

    child.once('close', onClose);
  });
}

async function stopChildren() {
  if (children.length === 0) return;
  isStoppingChildren = true;

  for (const { child } of children) {
    killChildTree(child, false);
  }

  await sleep(1200);

  for (const { child } of children) {
    killChildTree(child, true);
  }

  await Promise.all(children.map(({ child }) => waitChildClose(child)));
}

async function main() {
  const qqEnv = ALLOW_QQ_INSTALL ? {} : { QQ_ADAPTER_SKIP_INSTALL: '1' };

  if (SHOULD_START) {
    const readyBeforeStart = await areServicesReady();

    if (readyBeforeStart) {
      console.log('[Smoke] Services are already running. Skip spawning new processes.');
    } else {
      console.log('[Smoke] Starting local services...');
      runNpmScript('api:netease');
      runNpmScript('api:qq', qqEnv);

      await ensureServicesReady();
      console.log('[Smoke] Services are ready.');
    }
  }

  const tests = [];

  tests.push(
    await runTest('Login status endpoint (/login/status)', async () => {
      const { response, body } = await fetchJson(`${NETEASE_BASE}/login/status`);
      if (!response.ok) {
        throw new Error(`Unexpected HTTP status: ${response.status}`);
      }
      ensureObject(body, '/login/status response');

      const hasCode = typeof body.code === 'number';
      const hasLoginStatusPayload = 'account' in body || 'profile' in body || 'data' in body;

      if (!hasCode && !hasLoginStatusPayload) {
        throw new Error('Response does not expose expected login status fields');
      }
    }),
  );

  tests.push(
    await runTest('Playlist endpoint contract (/user/playlist)', async () => {
      const url = `${NETEASE_BASE}/user/playlist?uid=${encodeURIComponent(NETEASE_SMOKE_UID)}&timestamp=${Date.now()}`;
      const { response, body } = await fetchJson(url);
      if (!response.ok) {
        throw new Error(`Unexpected HTTP status: ${response.status}`);
      }
      ensureObject(body, '/user/playlist response');
      const hasCode = typeof body.code === 'number';
      const hasPlaylist = Array.isArray(body.playlist);
      if (!hasCode && !hasPlaylist) {
        throw new Error('Response does not contain `code` or `playlist` field');
      }
    }),
  );

  tests.push(
    await runTest('Search endpoint contract (/search/songs)', async () => {
      const params = new URLSearchParams({ keyword: 'jay', page: '1', size: '5' });
      const { response, body } = await fetchJson(`${QQ_BASE}/search/songs?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Unexpected HTTP status: ${response.status}`);
      }
      ensureObject(body, '/search/songs response');
      if (typeof body.code !== 'number') {
        throw new Error('Missing numeric field `code` in /search/songs response');
      }
      if (body.code === 0 && (!body.data || !Array.isArray(body.data.songs))) {
        throw new Error('Successful response must contain `data.songs` array');
      }
    }),
  );

  const passed = tests.filter((item) => item.ok).length;
  const failed = tests.length - passed;

  console.log('\n[Smoke] Result summary');
  for (const item of tests) {
    if (item.ok) {
      console.log(`  PASS - ${item.name}`);
    } else {
      console.log(`  FAIL - ${item.name}`);
      console.log(`         ${item.error}`);
    }
  }

  console.log(`\n[Smoke] ${passed}/${tests.length} passed.`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

async function run() {
  try {
    await main();
  } catch (error) {
    console.error('[Smoke] Fatal:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    await stopChildren();
  }
}

run();
