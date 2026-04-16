const fs = require('fs');
const path = require('path');

function resolveDesktopVendorDir() {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) {
    return null;
  }
  return path.join(localAppData, 'com.allmusic.app', 'vendor');
}

function listCleanupTargets(vendorDir) {
  if (!fs.existsSync(vendorDir)) {
    return [];
  }

  return fs.readdirSync(vendorDir, { withFileTypes: true })
    .filter((entry) => {
      if (!entry.isDirectory()) {
        return false;
      }
      return /^bundle_/i.test(entry.name) || entry.name === 'runtime' || entry.name === 'scripts';
    })
    .map((entry) => path.join(vendorDir, entry.name));
}

function removeDir(target) {
  fs.rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
}

function main() {
  const vendorDir = resolveDesktopVendorDir();
  if (!vendorDir) {
    console.log('[DesktopCache] LOCALAPPDATA is unavailable, skipping cleanup.');
    return;
  }

  const targets = listCleanupTargets(vendorDir);
  if (targets.length === 0) {
    console.log('[DesktopCache] No stale desktop vendor bundles found.');
    return;
  }

  const failed = [];
  for (const target of targets) {
    try {
      removeDir(target);
      console.log(`[DesktopCache] Removed ${target}`);
    } catch (error) {
      failed.push({ target, message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (failed.length > 0) {
    console.warn('[DesktopCache] Some stale desktop vendor bundles could not be removed.');
    for (const item of failed) {
      console.warn(`[DesktopCache] ${item.target}: ${item.message}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('[DesktopCache] Desktop vendor cache cleaned.');
}

main();
