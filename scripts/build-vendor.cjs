/**
 * build-vendor.cjs
 * 将 scripts/ + NeteaseCloudMusicApi 生产依赖 + 随包运行时打包为 src-tauri/vendor.zip。
 * Windows 安装包/便携包优先使用随包 Node.js 与 QQ 适配器二进制，避免首次启动依赖系统 Node/Python。
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VENDOR_TMP = path.join(ROOT, '.vendor-tmp');
const ZIP_OUTPUT = path.join(ROOT, 'src-tauri', 'vendor.zip');
const PY_BUILD_ROOT = path.join(VENDOR_TMP, '.py-build');
const PY_BUILD_VENV = process.platform === 'win32'
  ? path.join(PY_BUILD_ROOT, 'Scripts', 'python.exe')
  : path.join(PY_BUILD_ROOT, 'bin', 'python');
const QQ_ADAPTER_DIST = path.join(PY_BUILD_ROOT, 'dist');
const QQ_ADAPTER_BUILD = path.join(PY_BUILD_ROOT, 'build');
const QQ_ADAPTER_SPEC = path.join(PY_BUILD_ROOT, 'spec');
const QQ_ADAPTER_NAME = process.platform === 'win32' ? 'ALLMusicQQAdapter.exe' : 'ALLMusicQQAdapter';
const QQ_LAUNCHER = path.join(VENDOR_TMP, 'qmusic_adapter_launcher.py');

// 清理旧的构建产物
if (fs.existsSync(VENDOR_TMP)) {
  fs.rmSync(VENDOR_TMP, { recursive: true, force: true });
}
if (fs.existsSync(ZIP_OUTPUT)) {
  fs.unlinkSync(ZIP_OUTPUT);
}
fs.mkdirSync(VENDOR_TMP, { recursive: true });

// 生成精简 package.json（仅包含 NeteaseCloudMusicApi 运行时依赖）
const mainPkg = require(path.join(ROOT, 'package.json'));
const vendorPkg = {
  name: 'allmusic-vendor',
  private: true,
  dependencies: {
    NeteaseCloudMusicApi: mainPkg.dependencies.NeteaseCloudMusicApi,
  },
};
fs.writeFileSync(
  path.join(VENDOR_TMP, 'package.json'),
  JSON.stringify(vendorPkg, null, 2),
  'utf8'
);

function runOrThrow(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with code ${result.status}`);
  }
}

function resolvePythonCommand() {
  const candidates = process.platform === 'win32'
    ? [['python', ['--version']], ['py', ['-3', '--version']]]
    : [['python3', ['--version']], ['python', ['--version']]];

  for (const [command, args] of candidates) {
    const result = spawnSync(command, args, {
      stdio: 'ignore',
      shell: false,
      windowsHide: true,
    });
    if (!result.error && result.status === 0) {
      return { command, needsPyLauncher3: command === 'py' };
    }
  }
  throw new Error('Python 3 is required to build bundled QQ adapter runtime.');
}

function writeQQLauncher() {
  const launcher = String.raw`import os
import sys
from pathlib import Path

import uvicorn

ROOT = Path(__file__).resolve().parent
BASE_DIR = Path(getattr(sys, "_MEIPASS", ROOT))
SCRIPTS_DIR = BASE_DIR / "scripts"
if SCRIPTS_DIR.exists():
    sys.path.insert(0, str(SCRIPTS_DIR))

from qmusic_adapter_server import app

if __name__ == "__main__":
    host = os.environ.get("QQ_API_HOST", "127.0.0.1")
    port = int(os.environ.get("QQ_API_PORT", "3001"))
    uvicorn.run(app, host=host, port=port, log_level="info")
`;
  fs.writeFileSync(QQ_LAUNCHER, launcher, 'utf8');
}

function bundleNodeRuntime() {
  const runtimeNodeDir = path.join(VENDOR_TMP, 'runtime', 'node');
  fs.mkdirSync(runtimeNodeDir, { recursive: true });
  const nodeTarget = path.join(runtimeNodeDir, process.platform === 'win32' ? 'node.exe' : 'node');
  fs.copyFileSync(process.execPath, nodeTarget);
}

function buildQQAdapterRuntime() {
  const python = resolvePythonCommand();
  fs.mkdirSync(PY_BUILD_ROOT, { recursive: true });

  const venvArgs = python.needsPyLauncher3
    ? ['-3', '-m', 'venv', PY_BUILD_ROOT]
    : ['-m', 'venv', PY_BUILD_ROOT];
  if (!fs.existsSync(PY_BUILD_VENV)) {
    console.log('[build-vendor] Creating Python build venv...');
    runOrThrow(python.command, venvArgs, { cwd: ROOT });
  }

  console.log('[build-vendor] Installing QQ adapter build dependencies...');
  runOrThrow(PY_BUILD_VENV, ['-m', 'pip', 'install', '--upgrade', 'pip'], { cwd: ROOT });
  runOrThrow(
    PY_BUILD_VENV,
    [
      '-m', 'pip', 'install',
      'pyinstaller==6.16.0',
      'fastapi==0.109.2',
      'uvicorn==0.27.1',
      'qqmusic-api-python==0.4.1',
    ],
    { cwd: ROOT },
  );

  writeQQLauncher();
  fs.rmSync(QQ_ADAPTER_DIST, { recursive: true, force: true });
  fs.rmSync(QQ_ADAPTER_BUILD, { recursive: true, force: true });
  fs.rmSync(QQ_ADAPTER_SPEC, { recursive: true, force: true });
  fs.mkdirSync(QQ_ADAPTER_SPEC, { recursive: true });

  console.log('[build-vendor] Building bundled QQ adapter runtime...');
  runOrThrow(
    PY_BUILD_VENV,
    [
      '-m', 'PyInstaller',
      '--noconfirm',
      '--clean',
      '--onedir',
      '--name', 'ALLMusicQQAdapter',
      '--paths', path.join(VENDOR_TMP, 'scripts'),
      '--hidden-import', 'qmusic_adapter_server',
      '--add-data', `${path.join(VENDOR_TMP, 'scripts', 'qmusic_adapter_server.py')}${process.platform === 'win32' ? ';' : ':'}scripts`,
      '--distpath', QQ_ADAPTER_DIST,
      '--workpath', QQ_ADAPTER_BUILD,
      '--specpath', QQ_ADAPTER_SPEC,
      QQ_LAUNCHER,
    ],
    { cwd: VENDOR_TMP },
  );

  const builtDir = path.join(QQ_ADAPTER_DIST, 'ALLMusicQQAdapter');
  const builtExe = path.join(builtDir, QQ_ADAPTER_NAME);
  if (!fs.existsSync(builtExe)) {
    throw new Error(`Bundled QQ adapter executable not found: ${builtExe}`);
  }

  const runtimeQQDir = path.join(VENDOR_TMP, 'runtime', 'qq-adapter');
  fs.rmSync(runtimeQQDir, { recursive: true, force: true });
  fs.mkdirSync(runtimeQQDir, { recursive: true });
  for (const entry of fs.readdirSync(builtDir)) {
    fs.cpSync(path.join(builtDir, entry), path.join(runtimeQQDir, entry), { recursive: true });
  }
}

// 安装生产依赖（跳过 postinstall 脚本避免触发不必要的构建）
console.log('[build-vendor] Installing production dependencies...');
execSync('npm install --production --ignore-scripts', {
  cwd: VENDOR_TMP,
  stdio: 'inherit',
  env: { ...process.env },
});

// 复制 scripts 目录（排除 __pycache__ 和 .pyc）
console.log('[build-vendor] Copying scripts...');
const scriptsSrc = path.join(ROOT, 'scripts');
const scriptsDest = path.join(VENDOR_TMP, 'scripts');
fs.cpSync(scriptsSrc, scriptsDest, {
  recursive: true,
  filter: (src) => {
    const base = path.basename(src);
    return base !== '__pycache__' && !src.endsWith('.pyc');
  },
});

console.log('[build-vendor] Bundling runtime dependencies...');
bundleNodeRuntime();
buildQQAdapterRuntime();

// 打包为 zip
fs.rmSync(PY_BUILD_ROOT, { recursive: true, force: true });
if (fs.existsSync(QQ_LAUNCHER)) {
  fs.unlinkSync(QQ_LAUNCHER);
}

console.log('[build-vendor] Creating vendor.zip...');
const tmpZip = VENDOR_TMP.replace(/\//g, '\\');
const zipOut = ZIP_OUTPUT.replace(/\//g, '\\');
execSync(
  `powershell -NoProfile -Command "Compress-Archive -Path '${tmpZip}\\*' -DestinationPath '${zipOut}' -Force"`,
  { stdio: 'inherit' }
);

// 清理临时目录
fs.rmSync(VENDOR_TMP, { recursive: true, force: true });

const sizeMB = (fs.statSync(ZIP_OUTPUT).size / (1024 * 1024)).toFixed(1);
console.log(`[build-vendor] Done! vendor.zip: ${sizeMB} MB`);
