/**
 * Kill listeners on local dev service ports to avoid EADDRINUSE/WinError 10048.
 *
 * Usage:
 *   npm run ports:clean
 *   DRY_RUN=1 npm run ports:clean
 */

const { killPortListeners } = require('./port-utils.cjs');

const NETEASE_PORT = Number(process.env.NETEASE_API_PORT || 3000);
const QQ_PORT = Number(process.env.QQ_API_PORT || 3001);
const WEB_PORT = Number(process.env.VITE_PORT || 1420);
const ports = [NETEASE_PORT, QQ_PORT, WEB_PORT];

const dryRun = process.env.DRY_RUN === '1';
console.log(`[Ports] Checking listeners on: ${ports.join(', ')}`);

const result = killPortListeners(ports, {
  excludePid: process.pid,
  dryRun,
});

if (result.total === 0) {
  console.log('[Ports] No conflicting listeners found.');
  process.exit(0);
}

for (const item of result.killed) {
  const processSuffix = item.processName ? ` (${item.processName})` : '';
  if (item.dryRun) {
    console.log(`[Ports] DRY_RUN would kill PID ${item.pid}${processSuffix} at ${item.localAddress}.`);
  } else {
    console.log(`[Ports] Killed PID ${item.pid}${processSuffix} at ${item.localAddress}.`);
  }
}

if (result.failed.length > 0) {
  for (const item of result.failed) {
    const processSuffix = item.processName ? ` (${item.processName})` : '';
    console.error(
      `[Ports] Failed to kill PID ${item.pid}${processSuffix} at ${item.localAddress}: ${item.error}`
    );
  }
  process.exit(1);
}

console.log(dryRun ? '[Ports] DRY_RUN complete.' : '[Ports] Done.');
