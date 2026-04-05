#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REQUIRED_ANDROID_TARGETS = [
  'aarch64-linux-android',
  'armv7-linux-androideabi',
  'i686-linux-android',
  'x86_64-linux-android',
];

const WINDOWS_STABLE_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc';

function isWindows() {
  return process.platform === 'win32';
}

function isAscii(value) {
  return /^[\x00-\x7F]*$/.test(value);
}

function ensureDirectory(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function commandResult(command, args, env, options = {}) {
  const result = spawnSync(command, args, {
    env,
    shell: isWindows(),
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
  });

  if (result.error) {
    throw result.error;
  }

  return result;
}

function ensureRustToolchain(env) {
  const toolchainList = commandResult('rustup', ['toolchain', 'list'], env, { capture: true });
  if (toolchainList.status !== 0 || !toolchainList.stdout.includes(WINDOWS_STABLE_TOOLCHAIN)) {
    console.log('[android-env] Installing Rust stable toolchain into ASCII path...');
    const installResult = commandResult(
      'rustup',
      ['toolchain', 'install', 'stable', '--profile', 'minimal'],
      env,
    );
    if (installResult.status !== 0) {
      process.exit(installResult.status ?? 1);
    }
  }

  const installedTargets = commandResult(
    'rustup',
    ['target', 'list', '--installed'],
    env,
    { capture: true },
  );
  if (installedTargets.status !== 0) {
    process.exit(installedTargets.status ?? 1);
  }

  const currentTargets = new Set(
    installedTargets.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );

  const missingTargets = REQUIRED_ANDROID_TARGETS.filter((target) => !currentTargets.has(target));
  if (missingTargets.length > 0) {
    console.log(`[android-env] Installing missing Rust Android targets: ${missingTargets.join(', ')}`);
    const targetAddResult = commandResult(
      'rustup',
      ['target', 'add', ...missingTargets, '--toolchain', WINDOWS_STABLE_TOOLCHAIN],
      env,
    );
    if (targetAddResult.status !== 0) {
      process.exit(targetAddResult.status ?? 1);
    }
  }
}

function resolveAndroidSdkPath(env) {
  const sdkCandidates = [
    env.ALLMUSIC_ANDROID_SDK,
    'C:\\AndroidSdk',
    env.ANDROID_SDK_ROOT,
    env.ANDROID_HOME,
    path.join(os.homedir(), 'AppData', 'Local', 'Android', 'Sdk'),
  ].filter(Boolean);

  const existing = sdkCandidates.filter((candidate) => fs.existsSync(candidate));
  if (existing.length === 0) {
    return undefined;
  }

  const asciiPath = existing.find((candidate) => isAscii(candidate));
  return asciiPath || existing[0];
}

function buildAndroidEnv() {
  const env = { ...process.env };
  if (!isWindows()) {
    return env;
  }

  const asciiToolchainRoot = env.ALLMUSIC_ASCII_TOOLCHAIN_ROOT || 'C:\\RustAscii';
  const rustupHome = env.RUSTUP_HOME || path.join(asciiToolchainRoot, 'rustup');
  const cargoHome = env.CARGO_HOME || path.join(asciiToolchainRoot, 'cargo');
  const tempDir = env.ALLMUSIC_TEMP_DIR || 'C:\\TempRust';

  [rustupHome, cargoHome, tempDir].forEach(ensureDirectory);

  env.RUSTUP_HOME = rustupHome;
  env.CARGO_HOME = cargoHome;
  env.RUSTUP_TOOLCHAIN = env.RUSTUP_TOOLCHAIN || WINDOWS_STABLE_TOOLCHAIN;
  env.TEMP = tempDir;
  env.TMP = tempDir;

  const androidSdkPath = resolveAndroidSdkPath(env);
  if (!androidSdkPath) {
    console.error('[android-env] Android SDK not found. Please set ANDROID_HOME or ANDROID_SDK_ROOT.');
    process.exit(1);
  }

  env.ANDROID_HOME = androidSdkPath;
  env.ANDROID_SDK_ROOT = androidSdkPath;

  if (!isAscii(androidSdkPath)) {
    console.warn(`[android-env] Warning: Android SDK path contains non-ASCII characters: ${androidSdkPath}`);
    console.warn('[android-env] Recommendation: create an ASCII alias like C:\\AndroidSdk and set ANDROID_HOME.');
  }

  const prependPaths = [
    path.join(cargoHome, 'bin'),
    path.join(androidSdkPath, 'platform-tools'),
    path.join(androidSdkPath, 'emulator'),
    path.join(androidSdkPath, 'cmdline-tools', 'latest', 'bin'),
  ].filter((candidate) => fs.existsSync(candidate));

  const existingPaths = (env.PATH || '').split(path.delimiter).filter(Boolean);
  env.PATH = [...prependPaths, ...existingPaths.filter((item) => !prependPaths.includes(item))].join(path.delimiter);

  return env;
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: node scripts/run-android-tauri.cjs <tauri-android-args...>');
    process.exit(1);
  }

  const env = buildAndroidEnv();

  if (isWindows()) {
    ensureRustToolchain(env);
    console.log(`[android-env] RUSTUP_HOME=${env.RUSTUP_HOME}`);
    console.log(`[android-env] CARGO_HOME=${env.CARGO_HOME}`);
    console.log(`[android-env] TEMP=${env.TEMP}`);
    console.log(`[android-env] ANDROID_HOME=${env.ANDROID_HOME}`);
  }

  const result = commandResult('npx', ['tauri', 'android', ...args], env);
  process.exit(result.status ?? 1);
}

main();
