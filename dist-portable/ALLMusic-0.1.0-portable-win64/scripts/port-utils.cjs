const { spawnSync } = require('child_process');

function parsePort(address) {
  if (!address) {
    return null;
  }
  const match = address.match(/:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function normalizeState(state) {
  return String(state || '').toUpperCase();
}

function getProcessName(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return '';
  }

  if (process.platform === 'win32') {
    const result = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    });
    if (result.status !== 0 || !result.stdout) {
      return '';
    }
    const line = result.stdout.trim().split(/\r?\n/)[0] || '';
    if (!line || /No tasks are running/i.test(line)) {
      return '';
    }
    const first = line.split('","')[0] || '';
    return first.replace(/^"/, '').trim();
  }

  const ps = spawnSync('ps', ['-p', String(pid), '-o', 'comm='], {
    encoding: 'utf8',
    windowsHide: true,
  });
  return ps.status === 0 ? ps.stdout.trim() : '';
}

function listPortListeners(port) {
  const targetPort = Number(port);
  if (!Number.isInteger(targetPort) || targetPort <= 0) {
    return [];
  }

  const netstat = spawnSync('netstat', ['-ano'], {
    encoding: 'utf8',
    windowsHide: true,
  });

  if (netstat.status !== 0 || !netstat.stdout) {
    return [];
  }

  const lines = netstat.stdout.split(/\r?\n/);
  const listeners = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || (!line.startsWith('TCP') && !line.startsWith('UDP'))) {
      continue;
    }

    const parts = line.split(/\s+/);
    if (parts.length < 4) {
      continue;
    }

    const protocol = parts[0];
    const localAddress = parts[1];
    const state = protocol === 'UDP' ? 'LISTENING' : parts[3];
    const pidToken = protocol === 'UDP' ? parts[3] : parts[4];
    const localPort = parsePort(localAddress);
    const pid = Number.parseInt(pidToken, 10);

    if (localPort !== targetPort) {
      continue;
    }

    if (protocol !== 'UDP' && !normalizeState(state).startsWith('LISTEN')) {
      continue;
    }

    listeners.push({
      pid: Number.isInteger(pid) ? pid : -1,
      processName: Number.isInteger(pid) ? getProcessName(pid) : '',
      localAddress,
      protocol,
      state: normalizeState(state),
    });
  }

  const deduped = new Map();
  for (const item of listeners) {
    const key = `${item.pid}-${item.localAddress}-${item.protocol}`;
    if (!deduped.has(key)) {
      deduped.set(key, item);
    }
  }
  return Array.from(deduped.values());
}

function ensurePortAvailable({ port, host = 'localhost', serviceName = 'Service' }) {
  const listeners = listPortListeners(port);
  if (listeners.length === 0) {
    return true;
  }

  console.error(`[${serviceName}] Port ${port} is already in use, cannot start on http://${host}:${port}.`);
  for (const item of listeners) {
    const processSuffix = item.processName ? ` (${item.processName})` : '';
    console.error(
      `[${serviceName}] - ${item.protocol} ${item.localAddress} | PID ${item.pid}${processSuffix}`
    );
  }
  console.error(`[${serviceName}] Tip: stop conflicting process or run "npm run ports:clean".`);
  return false;
}

function killPortListeners(ports, options = {}) {
  const excludePid = Number(options.excludePid || 0);
  const dryRun = options.dryRun === true;
  const details = new Map();

  for (const port of ports) {
    for (const listener of listPortListeners(port)) {
      if (!details.has(listener.pid)) {
        details.set(listener.pid, listener);
      }
    }
  }

  const targets = Array.from(details.values()).filter((item) => item.pid > 0 && item.pid !== excludePid);
  const killed = [];
  const failed = [];

  for (const target of targets) {
    if (dryRun) {
      killed.push({
        ...target,
        dryRun: true,
      });
      continue;
    }

    try {
      if (process.platform === 'win32') {
        const taskkill = spawnSync('taskkill', ['/PID', String(target.pid), '/T', '/F'], {
          encoding: 'utf8',
          windowsHide: true,
        });
        if (taskkill.status !== 0) {
          throw new Error(taskkill.stderr || taskkill.stdout || 'taskkill failed');
        }
      } else {
        process.kill(target.pid, 'SIGTERM');
      }
      killed.push(target);
    } catch (error) {
      failed.push({
        ...target,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { killed, failed, total: targets.length };
}

module.exports = {
  ensurePortAvailable,
  killPortListeners,
  listPortListeners,
};
