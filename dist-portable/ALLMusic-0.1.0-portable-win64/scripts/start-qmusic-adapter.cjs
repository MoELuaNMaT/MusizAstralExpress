/**
 * Start local QQ adapter service backed by qqmusic-api-python.
 *
 * It provisions a dedicated Python venv in .vendor/qq-adapter-venv,
 * installs required packages, then starts uvicorn for scripts/qmusic_adapter_server.py.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { spawn, spawnSync } = require('child_process');
const { ensurePortAvailable } = require('./port-utils.cjs');

const ROOT = path.resolve(__dirname, '..');
const PYTHON_CMD = process.env.QQ_ADAPTER_PYTHON || 'python';
const HOST = process.env.QQ_API_HOST || 'localhost';
const PORT = String(process.env.QQ_API_PORT || 3001);
const SKIP_INSTALL = process.env.QQ_ADAPTER_SKIP_INSTALL === '1';
const isWin = process.platform === 'win32';

function resolveVenvDir() {
  const envValue = process.env.QQ_ADAPTER_VENV_DIR;
  if (envValue && envValue.trim()) {
    return path.resolve(ROOT, envValue.trim());
  }

  if (isWin) {
    // 可分享包经常放在受限目录，默认改用用户目录避免 EPERM。
    const baseDir = process.env.LOCALAPPDATA
      || process.env.APPDATA
      || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(baseDir, 'ALLMusic', '.vendor', 'qq-adapter-venv');
  }

  return path.resolve(ROOT, '.vendor/qq-adapter-venv');
}

const VENV_DIR = resolveVenvDir();
const PYTHON_EXE = isWin ? path.join(VENV_DIR, 'Scripts', 'python.exe') : path.join(VENV_DIR, 'bin', 'python');
const PYTHONW_EXE = isWin ? path.join(VENV_DIR, 'Scripts', 'pythonw.exe') : PYTHON_EXE;
const PIP_INDEX_URL = process.env.QQ_ADAPTER_PIP_INDEX_URL || 'https://pypi.tuna.tsinghua.edu.cn/simple';
const PIP_TRUSTED_HOST = process.env.QQ_ADAPTER_PIP_TRUSTED_HOST || 'pypi.tuna.tsinghua.edu.cn';
const PIP_OFFICIAL_INDEX_URL = process.env.QQ_ADAPTER_PIP_OFFICIAL_INDEX_URL || 'https://pypi.org/simple';
const SERVER_FILE = path.join(ROOT, 'scripts', 'qmusic_adapter_server.py');
const INSTALL_MARKER = path.join(VENV_DIR, '.deps.sha256');
const DEP_SPEC = [
  'fastapi==0.109.2',
  'uvicorn==0.27.1',
  'qqmusic-api-python==0.3.4',
].join('\n');

function runOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'pipe',
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    windowsHide: true,
    ...options,
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`);
  }
}

function ensureCommandAvailable(command, args = ['--version']) {
  const check = spawnSync(command, args, {
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
  });
  if (check.error || check.status !== 0) {
    throw new Error(`Missing required command: ${command}`);
  }
}

function ensureVirtualenv() {
  if (fs.existsSync(PYTHON_EXE)) {
    return;
  }

  fs.mkdirSync(path.dirname(VENV_DIR), { recursive: true });
  console.log('[QQ Adapter] Creating Python virtualenv...');
  runOrThrow(PYTHON_CMD, ['-m', 'venv', VENV_DIR], { cwd: ROOT });
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function normalizeIndexUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function buildPipSourceCandidates() {
  const candidates = [
    {
      label: 'mirror',
      indexUrl: normalizeIndexUrl(PIP_INDEX_URL),
      trustedHost: PIP_TRUSTED_HOST || undefined,
    },
    {
      label: 'official',
      indexUrl: normalizeIndexUrl(PIP_OFFICIAL_INDEX_URL),
      trustedHost: undefined,
    },
  ];

  const deduped = [];
  const seen = new Set();
  for (const item of candidates) {
    if (!item.indexUrl || seen.has(item.indexUrl)) {
      continue;
    }
    seen.add(item.indexUrl);
    deduped.push(item);
  }
  return deduped;
}

function measureHttpsLatencyMs(targetUrl, timeoutMs = 2200) {
  return new Promise((resolve) => {
    let resolved = false;
    const complete = (latency) => {
      if (resolved) {
        return;
      }
      resolved = true;
      resolve(latency);
    };

    let startAt = Date.now();
    try {
      const urlObj = new URL(targetUrl);
      const request = https.request({
        protocol: urlObj.protocol,
        hostname: urlObj.hostname,
        port: urlObj.port || 443,
        path: '/simple/pip/',
        method: 'HEAD',
        timeout: timeoutMs,
      }, (response) => {
        response.resume();
        complete(Date.now() - startAt);
      });

      request.on('timeout', () => {
        request.destroy();
        complete(null);
      });
      request.on('error', () => complete(null));
      request.end();
    } catch {
      complete(null);
    }
  });
}

function buildPipIndexArgs(source) {
  const args = ['-i', source.indexUrl];
  if (source.trustedHost) {
    args.push('--trusted-host', source.trustedHost);
  }
  return args;
}

async function pickPipInstallSourcesByLatency() {
  const candidates = buildPipSourceCandidates();
  const measured = await Promise.all(candidates.map(async (candidate) => {
    const latencyMs = await measureHttpsLatencyMs(candidate.indexUrl);
    return { ...candidate, latencyMs };
  }));

  measured.sort((left, right) => {
    const leftOk = Number.isFinite(left.latencyMs);
    const rightOk = Number.isFinite(right.latencyMs);
    if (leftOk && rightOk) {
      return left.latencyMs - right.latencyMs;
    }
    if (leftOk && !rightOk) {
      return -1;
    }
    if (!leftOk && rightOk) {
      return 1;
    }
    return 0;
  });
  return measured;
}

async function ensureDependencies() {
  if (SKIP_INSTALL) {
    console.log('[QQ Adapter] Skipping dependency install (QQ_ADAPTER_SKIP_INSTALL=1).');
    return;
  }

  const nextHash = sha256(DEP_SPEC);
  const installedHash = fs.existsSync(INSTALL_MARKER)
    ? fs.readFileSync(INSTALL_MARKER, 'utf8').trim()
    : '';

  if (nextHash === installedHash) {
    console.log('[QQ Adapter] Dependencies already up-to-date.');
    return;
  }

  console.log('[QQ Adapter] Installing Python dependencies...');
  const sources = await pickPipInstallSourcesByLatency();
  let installError = null;
  for (let index = 0; index < sources.length; index += 1) {
    const source = sources[index];
    const latencyTag = Number.isFinite(source.latencyMs) ? `~${source.latencyMs}ms` : 'unreachable';
    if (index > 0) {
      console.warn(`[QQ Adapter] Retry pip install with ${source.label} (${source.indexUrl}, ${latencyTag})...`);
    } else {
      console.log(`[QQ Adapter] Preferred pip source: ${source.label} (${source.indexUrl}, ${latencyTag})`);
    }

    try {
      const sourceArgs = buildPipIndexArgs(source);
      runOrThrow(
        PYTHON_EXE,
        ['-m', 'pip', 'install', '--upgrade', 'pip', ...sourceArgs],
        { cwd: ROOT },
      );
      runOrThrow(
        PYTHON_EXE,
        ['-m', 'pip', 'install', ...DEP_SPEC.split('\n'), ...sourceArgs],
        { cwd: ROOT },
      );
      installError = null;
      break;
    } catch (error) {
      installError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[QQ Adapter] pip install failed via ${source.label}: ${message}`);
    }
  }

  if (installError) {
    throw installError;
  }
  fs.writeFileSync(INSTALL_MARKER, `${nextHash}\n`, 'utf8');
}

function startServer() {
  if (!fs.existsSync(SERVER_FILE)) {
    throw new Error(`Server file not found: ${SERVER_FILE}`);
  }

  console.log(`[QQ Adapter] Starting at http://${HOST}:${PORT}`);
  const runtimeForServer = isWin && fs.existsSync(PYTHONW_EXE) ? PYTHONW_EXE : PYTHON_EXE;
  const child = spawn(
    runtimeForServer,
    ['-m', 'uvicorn', 'qmusic_adapter_server:app', '--host', HOST, '--port', PORT, '--app-dir', path.join(ROOT, 'scripts')],
    {
      cwd: ROOT,
      stdio: isWin ? ['ignore', 'ignore', 'ignore'] : ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
      },
    }
  );

  if (!isWin && child.stdout) {
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
    });
  }
  if (!isWin && child.stderr) {
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
    });
  }

  const shutdown = () => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGBREAK', shutdown);
  process.on('exit', shutdown);

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

async function main() {
  if (!ensurePortAvailable({ port: PORT, host: HOST, serviceName: 'QQ Adapter' })) {
    process.exit(1);
  }

  console.log(`[QQ Adapter] Venv dir: ${VENV_DIR}`);
  ensureCommandAvailable(PYTHON_CMD);
  ensureVirtualenv();
  await ensureDependencies();
  startServer();
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[QQ Adapter] Failed: ${message}`);
  process.exit(1);
});
