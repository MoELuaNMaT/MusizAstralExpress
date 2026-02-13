#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require('node:child_process');

function hasCommand(command, args = ['--version']) {
  const result = spawnSync(command, args, { stdio: 'ignore', shell: process.platform === 'win32' });
  return result.status === 0;
}

const errors = [];
const warnings = [];

if (!process.env.JAVA_HOME || process.env.JAVA_HOME.trim() === '') {
  errors.push('Missing JAVA_HOME. Install JDK 17+ and set JAVA_HOME.');
}
if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
  errors.push('Missing ANDROID_HOME / ANDROID_SDK_ROOT. Configure Android SDK path.');
}
if (!hasCommand('java')) {
  errors.push('Cannot find java in PATH. Ensure JDK bin is in PATH.');
}
if (!hasCommand('adb')) {
  warnings.push('adb not found. Install Android Platform Tools and add to PATH.');
}

if (errors.length > 0) {
  console.error('\n[android:check] Android environment check failed:');
  errors.forEach((item) => console.error(`- ${item}`));
  if (warnings.length > 0) {
    console.error('\n[android:check] Additional hints:');
    warnings.forEach((item) => console.error(`- ${item}`));
  }
  process.exit(1);
}

console.log('[android:check] Android environment check passed.');
if (warnings.length > 0) {
  warnings.forEach((item) => console.log(`- ${item}`));
}
