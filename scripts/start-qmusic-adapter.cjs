/**
 * Start local QQ adapter service backed by qqmusic-api-python.
 *
 * It provisions a dedicated Python venv in .vendor/qq-adapter-venv,
 * installs required packages, then starts uvicorn for scripts/qmusic_adapter_server.py.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const { ensurePortAvailable } = require('./port-utils.cjs');

const ROOT = path.resolve(__dirname, '..');
const PYTHON_CMD = process.env.QQ_ADAPTER_PYTHON || 'python';
const HOST = process.env.QQ_API_HOST || 'localhost';
const PORT = String(process.env.QQ_API_PORT || 3001);
const SKIP_INSTALL = process.env.QQ_ADAPTER_SKIP_INSTALL === '1';

const VENV_DIR = path.resolve(ROOT, process.env.QQ_ADAPTER_VENV_DIR || '.vendor/qq-adapter-venv');
const isWin = process.platform === 'win32';
const PYTHON_EXE = isWin ? path.join(VENV_DIR, 'Scripts', 'python.exe') : path.join(VENV_DIR, 'bin', 'python');
const SERVER_FILE = path.join(ROOT, 'scripts', 'qmusic_adapter_server.py');
const INSTALL_MARKER = path.join(VENV_DIR, '.deps.sha256');
const DEP_SPEC = [
  'fastapi==0.109.2',
  'uvicorn==0.27.1',
  'qqmusic-api-python==0.3.4',
].join('\n');

function runOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    ...options,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`);
  }
}

function ensureCommandAvailable(command, args = ['--version']) {
  const check = spawnSync(command, args, { stdio: 'ignore', shell: false });
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

function ensureDependencies() {
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
  runOrThrow(PYTHON_EXE, ['-m', 'pip', 'install', '--upgrade', 'pip'], { cwd: ROOT });
  runOrThrow(PYTHON_EXE, ['-m', 'pip', 'install', ...DEP_SPEC.split('\n')], { cwd: ROOT });
  fs.writeFileSync(INSTALL_MARKER, `${nextHash}\n`, 'utf8');
}

function startServer() {
  if (!fs.existsSync(SERVER_FILE)) {
    throw new Error(`Server file not found: ${SERVER_FILE}`);
  }

  console.log(`[QQ Adapter] Starting at http://${HOST}:${PORT}`);
  const child = spawn(
    PYTHON_EXE,
    ['-m', 'uvicorn', 'qmusic_adapter_server:app', '--host', HOST, '--port', PORT, '--app-dir', path.join(ROOT, 'scripts')],
    {
      cwd: ROOT,
      stdio: 'inherit',
      shell: false,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
      },
    }
  );

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

function main() {
  if (!ensurePortAvailable({ port: PORT, host: HOST, serviceName: 'QQ Adapter' })) {
    process.exit(1);
  }

  ensureCommandAvailable(PYTHON_CMD);
  ensureVirtualenv();
  ensureDependencies();
  startServer();
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[QQ Adapter] Failed: ${message}`);
  process.exit(1);
}
